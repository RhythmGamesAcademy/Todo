/**
 * Discord REST API 連携(Bot Token)。
 * ファイル本体を Discord 専用チャンネルにメッセージとして投稿し、
 * CDN の署名付きURLに相当するメッセージ/添付の識別情報だけを返す。
 */

export interface DiscordUploadResult {
  messageId: string;
  attachmentId: string;
  /** 投稿先チャンネル。Neon 側の discord_channel_id として保存する。 */
  channelId: string;
}

export interface DiscordMessageAttachment {
  id: string;
  url: string;
}

export interface DiscordMessage {
  id: string;
  attachments: DiscordMessageAttachment[];
}

export interface DiscordClient {
  /** 専用チャンネルに1ファイルを投稿する。 */
  uploadMessage(params: {
    filename: string;
    contentType: string;
    file: Blob;
  }): Promise<DiscordUploadResult>;
  /** メッセージを取得する。存在しない場合は null。 */
  fetchMessage(messageId: string): Promise<DiscordMessage | null>;
  /** メッセージを削除する。既に無ければ true(冪等とみなす)。 */
  deleteMessage(messageId: string): Promise<boolean>;
}

/** 429(retry_after)に従って照らし直す最大回数。 */
const MAX_RETRY = 4;
const MAX_RETRY_WAIT_MS = 10_000;

class DiscordApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "DiscordApiError";
  }
}

const API_BASE = "https://discord.com/api/v10";

/** 本番用クライアント。トークンは環境変数からのみ受け、ログには出さない。 */
export class BotDiscordClient implements DiscordClient {
  private readonly headers: { authorization: string };

  constructor(
    botToken: string,
    readonly channelId: string,
  ) {
    // トークンは認証ヘッダの組み立てだけに使う。ログへは出さない。
    this.headers = { authorization: `Bot ${botToken}` };
  }

  private request(path: string, init?: RequestInit): Promise<Response> {
    return fetch(API_BASE + path, {
      ...init,
      headers: { ...init?.headers, ...this.headers },
    });
  }

  async uploadMessage({
    filename,
    contentType,
    file,
  }: {
    filename: string;
    contentType: string;
    file: Blob;
  }): Promise<DiscordUploadResult> {
    const form = new FormData();
    const blob =
      file instanceof Blob ? file : new Blob([file], { type: contentType });
    form.append("files[0]", blob, filename);
    const response = await this.retryOnRateLimit(() =>
      this.request(`/channels/${this.channelId}/messages`, {
        method: "POST",
        body: form,
      }),
    );
    if (!response.ok)
      throw new DiscordApiError(
        response.status,
        `Discord upload failed with status ${response.status}`,
      );
    const data = (await response.json()) as {
      id?: unknown;
      attachments?: Array<{ id?: unknown }>;
    };
    const messageId = typeof data.id === "string" ? data.id : "";
    const attachmentId = data.attachments?.find((a) => typeof a.id === "string")
      ?.id as string | undefined;
    if (!messageId || !attachmentId)
      throw new DiscordApiError(502, "Discord upload response is incomplete");
    return {
      messageId,
      attachmentId: attachmentId as string,
      channelId: this.channelId,
    };
  }

  async fetchMessage(messageId: string): Promise<DiscordMessage | null> {
    const response = await this.request(
      `/channels/${this.channelId}/messages/${messageId}`,
    );
    if (response.status === 404) return null;
    if (!response.ok)
      throw new DiscordApiError(
        response.status,
        `Discord fetch failed with status ${response.status}`,
      );
    const data = (await response.json()) as {
      id?: unknown;
      attachments?: Array<{ id?: unknown; url?: unknown }>;
    };
    return {
      id: typeof data.id === "string" ? data.id : "",
      attachments: (data.attachments ?? [])
        .filter(
          (attachment): attachment is { id: string; url: string } =>
            typeof attachment?.id === "string" &&
            typeof attachment?.url === "string",
        )
        .map((attachment) => ({ id: attachment.id, url: attachment.url })),
    };
  }

  async deleteMessage(messageId: string): Promise<boolean> {
    const response = await this.request(
      `/channels/${this.channelId}/messages/${messageId}`,
      { method: "DELETE" },
    );
    if (response.status === 404) return true;
    if (!response.ok)
      throw new DiscordApiError(
        response.status,
        `Discord delete failed with status ${response.status}`,
      );
    return true;
  }

  /** Discord の 429(retry_after, 秒)に従って待ち、最大 MAX_RETRY 回照らし直す。 */
  private async retryOnRateLimit(
    send: () => Promise<Response>,
  ): Promise<Response> {
    let last: Response | null = null;
    for (let attempt = 0; attempt < MAX_RETRY; attempt += 1) {
      const response = await send();
      if (response.status !== 429) return response;
      last = response;
      const data = (await response.json().catch(() => ({}))) as {
        retry_after?: unknown;
      };
      const seconds =
        typeof data.retry_after === "number" ? data.retry_after : 1;
      const wait =
        Math.min(Math.max(seconds, 0.05), MAX_RETRY_WAIT_MS / 1000) * 1000;
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    return last!;
  }
}

export function discordConfigFromEnv(env: NodeJS.ProcessEnv = process.env): {
  botToken: string;
  channelId: string;
} | null {
  const botToken = env.DISCORD_BOT_TOKEN?.trim() ?? "";
  const channelId = env.DISCORD_CHANNEL_ID?.trim() ?? "";
  if (!botToken || !channelId) return null;
  return { botToken, channelId };
}

/** 環境変数が揃っているときだけ本番クライアントを組み立てる。 */
export function makeDiscordClientFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): DiscordClient | null {
  const config = discordConfigFromEnv(env);
  return config
    ? new BotDiscordClient(config.botToken, config.channelId)
    : null;
}

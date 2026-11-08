import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { Context } from "hono";
import type {
  Attachment,
  Note,
  Priority,
  Status,
  Subtask,
  SubtaskMemo,
  SubtaskStatus,
} from "../../src/model";
import type {
  Activity,
  ActivityKind,
  ApprovalStatus,
  CloudState,
  CloudTodo,
  CloudUser,
  Notification,
  NotificationKind,
  TodoPatch,
} from "../../src/cloud/types";
import {
  ApiException,
  assertText,
  computeActivities,
  extractMentions,
  generateToken,
  parseTags,
  REQUEST_TAG,
  sameIds,
  toPgTextArray,
} from "./domain.js";
import {
  AttachmentValidationError,
  MAX_ATTACHMENTS_PER_TODO,
  isInlineRenderable,
  verifyAttachment,
} from "./attachment.js";
import type { ObjectStorage } from "./object-storage.js";
import type { DbInfo, Sql, SqlCall, Transact } from "./sql.js";
import { rateLimit, clientIp } from "./rate-limit.js";

export interface AppDeps {
  sql: Sql;
  transact: Transact;
  describe?: () => Promise<DbInfo>;
  objectStorage?: ObjectStorage;
}

export const wrongObjectStorageSetup = new ApiException(
  500,
  "object storage is not configured",
);

interface ListRow {
  id: string;
  title: string;
  revision: string | number;
}

interface UserRow {
  id: string;
  name: string;
  created_at: unknown;
  notification_read_at: unknown;
}

const toTextArray = (value: unknown): string[] => {
  if (Array.isArray(value))
    return value.filter((x): x is string => typeof x === "string");
  if (typeof value !== "string") return [];
  // ドライバが text[] をリテラル文字列( {"a","b"} )で返す場合の読み替え。
  if (!value.startsWith("{") || !value.endsWith("}")) return [];
  const inner = value.slice(1, -1);
  if (!inner) return [];
  return inner.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((item) =>
    item
      .trim()
      .replace(/^"(.*)"$/, "$1")
      .replace(/\\(.)/g, "$1"),
  );
};

interface TodoRow {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  due: unknown;
  assignee_ids: unknown;
  tags: unknown;
  approval_status: string | null;
  approval_reason: string | null;
  approval_by: string | null;
  approval_at: unknown;
  created_at: unknown;
  updated_at: unknown;
}

interface TodoRecordRow extends TodoRow {
  deleted_at: unknown;
  created_by: string | null;
}

interface UserRefRow {
  id: string;
  name: string;
}

interface MemoRow {
  id: string;
  todo_id: string;
  user_id: string | null;
  body: string;
  created_at: unknown;
}

interface SubtaskRow {
  id: string;
  todo_id: string;
  title: string;
  status: string;
  priority: string;
  due: unknown;
  created_at: unknown;
  updated_at: unknown;
}

interface SubtaskMemoRow {
  id: string;
  subtask_id: string;
  body: string;
  created_at: unknown;
}

interface AttachmentRow {
  id: string;
  todo_id: string;
  memo_id: string | null;
  filename: string;
  content_type: string;
  size_bytes: string | number;
  created_by: string | null;
  created_at: unknown;
}

const toCloudAttachment = (row: AttachmentRow): Attachment => ({
  id: row.id,
  filename: row.filename,
  contentType: row.content_type,
  sizeBytes: Number(row.size_bytes),
  createdAt: toIso(row.created_at),
  createdBy: row.created_by,
});

interface ActivityRow {
  id: string;
  todo_id: string | null;
  user_id: string | null;
  kind: string;
  field: string | null;
  before: string | null;
  after: string | null;
  created_at: unknown;
}

interface NotificationRow {
  id: string;
  todo_id: string | null;
  actor_id: string | null;
  kind: string;
  body: string | null;
  created_at: unknown;
}

const rowsOf = <T>(result: { rows: unknown[] }): T[] => result.rows as T[];

const toIso = (value: unknown): string =>
  (value instanceof Date ? value : new Date(String(value))).toISOString();
const toIsoOrNull = (value: unknown): string | null =>
  value === null ? null : toIso(value);

const toCloudTodo = (row: TodoRow): CloudTodo => ({
  id: row.id,
  title: row.title,
  description: row.description,
  deadline: row.due === null ? null : toIso(row.due),
  priority: row.priority as Priority,
  status: row.status as Status,
  assigneeIds: toTextArray(row.assignee_ids),
  tags: toTextArray(row.tags),
  approvalStatus: row.approval_status
    ? (row.approval_status as ApprovalStatus)
    : null,
  approvalReason: row.approval_reason,
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at),
  notes: [],
  subtasks: [],
});

const toCloudSubtask = (
  row: SubtaskRow,
  memos: SubtaskMemo[] = [],
): Subtask => ({
  id: row.id,
  title: row.title,
  status: row.status as SubtaskStatus,
  priority: row.priority as Priority,
  deadline: row.due === null ? null : toIso(row.due),
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at),
  memos,
});

const STATUSES: readonly Status[] = ["todo", "doing", "done"];
const SUBTASK_STATUSES: readonly SubtaskStatus[] = ["todo", "done"];
const PRIORITIES: readonly Priority[] = ["high", "medium", "low"];
// 履歴は編集のたびに条数が増え続けるため、GET の応答は最新 N 件に絞る。
// 無制限に返すと履歴が溜まったリストで応答サイズが伸び続け、
// 取得コスト(帯域・ Neon の行スキャン)がリクエストごとに増大する。
const ACTIVITY_LIMIT = 500;
const NOTIFICATION_LIMIT = 100;
// 行数の無制限増大を防ぐ上限(監査 2026-11-08 M-004)。添付の件数・バイト上限と
// 同様に、トークン保持者による書き込み総量を際限なく増やせないようにする。
// ソフト削除済みのTODOは復元で戻せるため、TODO数の計数からは除外する。
export const MAX_TODOS_PER_LIST = 300;
export const MAX_SUBTASKS_PER_TODO = 50;
export const MAX_MEMOS_PER_TODO = 200;
export const MAX_SUBTASK_MEMOS_PER_SUBTASK = 200;
const ISO_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/;
// UUID 以外の文字列を uuid 列と比較すると Postgres が 22P02 で落ちるため、
// 構文だけ先に確認して「存在しない ID」= 404 に寄せる。
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const parseEnum = <T extends string>(
  value: unknown,
  values: readonly T[],
  field: string,
): T => {
  if (
    typeof value !== "string" ||
    !(values as readonly string[]).includes(value)
  )
    throw new ApiException(400, `${field} is invalid`);
  return value as T;
};

const parseDeadline = (value: unknown): string | null => {
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    !ISO_TIMESTAMP.test(value) ||
    Number.isNaN(Date.parse(value))
  )
    throw new ApiException(400, "deadline must be an ISO timestamp or null");
  return new Date(value).toISOString();
};

const parseDescription = (value: unknown): string => {
  if (typeof value !== "string")
    throw new ApiException(400, "description must be a string");
  const text = value.trim();
  if (text.length > 2000)
    throw new ApiException(400, "description must be at most 2000 characters");
  return text;
};

const parseUserId = (value: unknown, field: string): string => {
  if (typeof value !== "string" || !value.trim())
    throw new ApiException(400, `${field} must be a user id`);
  return value;
};

async function readJson(c: Context): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new ApiException(400, "invalid JSON body");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body))
    throw new ApiException(400, "invalid JSON body");
  return body as Record<string, unknown>;
}

async function readOptionalJson(c: Context): Promise<Record<string, unknown>> {
  const text = await c.req.text();
  if (!text.trim()) return {};
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new ApiException(400, "invalid JSON body");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body))
    throw new ApiException(400, "invalid JSON body");
  return body as Record<string, unknown>;
}

export function createApp({
  sql,
  transact,
  describe,
  objectStorage,
}: AppDeps): Hono {
  const app = new Hono();

  // 認証済み呼び出し元の概念が無いため、期限付きトークンを持つ人全員が
  // 書き込める。無制限の行/バイト書き込みを避けるため、リスト作成・参加と
  // アップロード3経路に短期集中の上限を置く(監査 M-003)。上限は緩めにして
  // 正常操作は妨げない。Vercel Firewall(ダッシュボード)が大元の防御。
  const perIp = (scope: string, max: number) =>
    rateLimit({ scope, max, windowMs: 60_000, key: clientIp });
  const perToken = (scope: string, max: number) =>
    rateLimit({
      scope,
      max,
      windowMs: 60_000,
      key: (c) => c.req.param("token") || clientIp(c),
    });
  // リスト作成と参加は未認証(トークン不要)なのでIPで絞る。
  app.use("/api/lists", perIp("list-create", 120));
  app.use("/api/lists/:token/join", perToken("join", 120));
  // アップロードは3経路とも1ファイル=1リクエスト。
  app.use(
    "/api/lists/:token/todos/:todoId/attachments",
    perToken("upload", 120),
  );
  app.use(
    "/api/lists/:token/todos/:todoId/memos/with-attachment",
    perToken("upload", 120),
  );
  app.use(
    "/api/lists/:token/todos/:todoId/memos/:memoId/attachments",
    perToken("upload", 120),
  );
  // 行作成も短期集中の上限を置く(監査 2026-11-08 M-004)。
  app.use("/api/lists/:token/todos", perToken("todo-create", 120));
  app.use(
    "/api/lists/:token/todos/:todoId/subtasks",
    perToken("subtask-create", 120),
  );
  app.use("/api/lists/:token/todos/:id/memos", perToken("memo-create", 120));
  app.use(
    "/api/lists/:token/todos/:todoId/memos/with-attachment",
    perToken("memo-create", 120),
  );
  app.use(
    "/api/lists/:token/todos/:todoId/subtasks/:subtaskId/memos",
    perToken("memo-create", 120),
  );

  const findList = async (token: string): Promise<ListRow | null> => {
    const [list] = rowsOf<ListRow>(
      await sql`SELECT id, title, revision FROM public.lists WHERE token = ${token}`,
    );
    return list ?? null;
  };

  const notFound = (c: Context) => c.json({ error: "not found" }, 404);

  const findUser = async (
    listId: string,
    userId: string,
  ): Promise<UserRefRow | null> => {
    if (!UUID.test(userId)) return null;
    const [user] = rowsOf<UserRefRow>(
      await sql`SELECT id, name FROM public.users WHERE list_id = ${listId} AND id = ${userId}`,
    );
    return user ?? null;
  };

  const requireUser = async (
    listId: string,
    userId: string,
  ): Promise<UserRefRow> => {
    const user = await findUser(listId, userId);
    if (!user) throw new ApiException(404, "user not found");
    return user;
  };

  // API v1 には認証済み呼び出し元の概念がないため、クライアントが任意で
  // userId を送る。リスト内の実ユーザーだけを受け付け、未指定なら NULL。
  const readOptionalUserId = async (
    body: Record<string, unknown>,
    listId: string,
  ): Promise<string | null> => {
    if (body.userId === undefined || body.userId === null) return null;
    const id = parseUserId(body.userId, "userId");
    await requireUser(listId, id);
    return id;
  };

  // 担当者は assigneeIds（ID の配列、順序を保って重複を除く）。
  // 旧クライアントの単数 assigneeId も受け付けて配列に読み替える。
  const parseAssigneeIds = async (
    listId: string,
    body: Record<string, unknown>,
  ): Promise<string[]> => {
    let raw: unknown[] = [];
    if (body.assigneeIds !== undefined || body.assigneeId === undefined) {
      if (!Array.isArray(body.assigneeIds))
        throw new ApiException(400, "assigneeIds must be an array");
      raw = body.assigneeIds;
    } else if (body.assigneeId !== null) {
      raw = [body.assigneeId];
    }
    const ids: string[] = [];
    for (const item of raw) {
      const id = (await requireUser(listId, parseUserId(item, "assigneeIds")))
        .id;
      if (!ids.includes(id)) ids.push(id);
    }
    return ids;
  };

  const readRevision = async (listId: string): Promise<number> => {
    const [row] = rowsOf<{ revision: string | number }>(
      await sql`SELECT revision FROM public.lists WHERE id = ${listId}`,
    );
    if (!row) throw new ApiException(404, "list not found");
    return Number(row.revision);
  };

  const findTodo = async (
    listId: string,
    id: string,
  ): Promise<TodoRecordRow | null> => {
    if (!UUID.test(id)) return null;
    const [todo] = rowsOf<TodoRecordRow>(
      await sql`
        SELECT id, title, description, status, priority, due, assignee_ids,
               tags, approval_status, approval_reason, approval_by, approval_at,
               created_by, created_at, updated_at, deleted_at
        FROM public.todos
        WHERE id = ${id} AND list_id = ${listId}
      `,
    );
    return todo ?? null;
  };

  const findSubtask = async (
    todoId: string,
    id: string,
  ): Promise<SubtaskRow | null> => {
    if (!UUID.test(id)) return null;
    const [subtask] = rowsOf<SubtaskRow>(
      await sql`
        SELECT id, todo_id, title, status, priority, due, created_at, updated_at
        FROM public.subtasks
        WHERE id = ${id} AND todo_id = ${todoId}
      `,
    );
    return subtask ?? null;
  };

  // ---- 添付ファイル(Neon Object Storage) -----------------------------

  const requireObjectStorage = (): ObjectStorage => {
    if (!objectStorage) throw wrongObjectStorageSetup;
    return objectStorage;
  };

  // 不正な multipart 本文は 400 に寄せる。
  const readFormData = async (c: Context): Promise<FormData> => {
    try {
      return await c.req.formData();
    } catch {
      throw new ApiException(400, "invalid multipart body");
    }
  };

  const optionalUserIdFromForm = async (
    form: FormData,
    listId: string,
  ): Promise<string | null> => {
    const value = form.get("userId");
    if (value === null || value === "") return null;
    const id = parseUserId(value, "userId");
    await requireUser(listId, id);
    return id;
  };

  /** form の file フィールドを検証して既知形式に正規化する。 */
  const extractVerifiedFile = async (
    form: FormData,
  ): Promise<{
    filename: string;
    contentType: string;
    file: Blob;
    category: string;
  }> => {
    const value = form.get("file");
    if (!(value instanceof File))
      throw new ApiException(400, "file field is required");
    const verified = await verifyAttachment(value.name, value.type, value);
    return { ...verified, file: value };
  };

  // 検証エラーと API エラーの対応。容量超過だけは 413 で伝える。
  const toApiError = (error: unknown): ApiException => {
    if (!(error instanceof AttachmentValidationError)) throw error;
    if (error.code === "no-file")
      return new ApiException(400, "file field is required");
    if (error.code === "too-large")
      return new ApiException(413, "file size exceeds the 3MiB limit");
    return new ApiException(400, `invalid file: ${error.code}`);
  };

  /** TODO単位とメモ単位を合わせた添付数の上限確認。 */
  const assertAttachmentLimit = async (todoId: string): Promise<void> => {
    const [row] = rowsOf<{ count: number }>(
      await sql`SELECT count(*)::int AS count FROM public.attachments WHERE todo_id = ${todoId}`,
    );
    if ((row?.count ?? 0) >= MAX_ATTACHMENTS_PER_TODO)
      throw new ApiException(400, "attachment limit reached");
  };

  // TODO単位・1リクエスト単位の上限だけでは、TODO数が無制限なので
  // リスト全体の書き込み総量が無制限になる。そこでリストごとに合計
  // バイト数の上限を設け、storage.put の前に必ず確認する(監査 M-003)。
  const MAX_LIST_STORAGE_BYTES = 100 * 1024 * 1024; // 100 MiB

  const assertListStorageBudget = async (
    listId: string,
    incomingBytes: number,
  ): Promise<void> => {
    const [row] = rowsOf<{ total: string | number }>(
      await sql`
        SELECT coalesce(sum(a.size_bytes), 0)::bigint AS total
        FROM public.attachments a
        JOIN public.todos t ON t.id = a.todo_id
        WHERE t.list_id = ${listId}
      `,
    );
    if (Number(row?.total ?? 0) + incomingBytes > MAX_LIST_STORAGE_BYTES)
      throw new ApiException(400, "attachment storage budget exceeded");
  };

  // 行数の上限確認。添付の assertAttachmentLimit と同じく、INSERT の前に
  // count(*) を確かめて超過は 400 に寄せる(監査 2026-11-08 M-004)。
  const assertRowCount = async (
    max: number,
    resource: string,
    countQuery: SqlCall,
  ): Promise<void> => {
    const [row] = rowsOf<{ count: number }>(await countQuery);
    if ((row?.count ?? 0) >= max)
      throw new ApiException(400, `${resource} limit reached`);
  };

  const assertTodoLimit = (listId: string): Promise<void> =>
    assertRowCount(
      MAX_TODOS_PER_LIST,
      "todo",
      sql`SELECT count(*)::int AS count FROM public.todos WHERE list_id = ${listId} AND deleted_at IS NULL`,
    );

  const assertSubtaskLimit = (todoId: string): Promise<void> =>
    assertRowCount(
      MAX_SUBTASKS_PER_TODO,
      "subtask",
      sql`SELECT count(*)::int AS count FROM public.subtasks WHERE todo_id = ${todoId}`,
    );

  const assertMemoLimit = (todoId: string): Promise<void> =>
    assertRowCount(
      MAX_MEMOS_PER_TODO,
      "memo",
      sql`SELECT count(*)::int AS count FROM public.memos WHERE todo_id = ${todoId}`,
    );

  const assertSubtaskMemoLimit = (subtaskId: string): Promise<void> =>
    assertRowCount(
      MAX_SUBTASK_MEMOS_PER_SUBTASK,
      "subtask memo",
      sql`SELECT count(*)::int AS count FROM public.subtask_memos WHERE subtask_id = ${subtaskId}`,
    );

  /** オブジェクトストレージへの保存とNeonへの登録。 */
  const uploadAndRegister = async (params: {
    listId: string;
    todoId: string;
    memoId: string | null;
    userId: string | null;
    filename: string;
    contentType: string;
    file: Blob;
  }): Promise<void> => {
    await assertAttachmentLimit(params.todoId);
    await assertListStorageBudget(params.listId, params.file.size);
    const attachmentId = randomUUID();
    const objectKey = `attachments/${attachmentId}`;
    const storage = requireObjectStorage();
    await storage.put({
      key: objectKey,
      contentType: params.contentType,
      body: params.file,
    });
    try {
      await transact([
        insertAttachment({
          attachmentId,
          todoId: params.todoId,
          memoId: params.memoId,
          userId: params.userId,
          filename: params.filename,
          contentType: params.contentType,
          sizeBytes: params.file.size,
          objectKey,
        }),
      ]);
    } catch (error) {
      await storage.delete(objectKey).catch(() => {});
      throw error;
    }
  };

  const insertAttachment = (params: {
    todoId: string;
    memoId: string | null;
    userId: string | null;
    filename: string;
    contentType: string;
    sizeBytes: number;
    attachmentId: string;
    objectKey?: string;
  }): SqlCall =>
    sql`
      INSERT INTO public.attachments (
        id, todo_id, memo_id,
        object_key,
        filename, content_type, size_bytes, created_by, created_at
      )
      VALUES (
        ${params.attachmentId}, ${params.todoId}, ${params.memoId},
        ${params.objectKey},
        ${params.filename}, ${params.contentType}, ${params.sizeBytes},
        ${params.userId}, clock_timestamp()
      )
    `;

  const findAttachedTodo = async (
    listId: string,
    todoId: string,
  ): Promise<TodoRecordRow | null> => {
    const todo = await findTodo(listId, todoId);
    if (!todo || todo.deleted_at !== null) return null;
    return todo;
  };

  const findMemo = async (
    todoId: string,
    id: string,
  ): Promise<MemoRow | null> => {
    if (!UUID.test(id)) return null;
    const [memo] = rowsOf<MemoRow>(
      await sql`SELECT id, todo_id, user_id, body, created_at FROM public.memos WHERE id = ${id} AND todo_id = ${todoId}`,
    );
    return memo ?? null;
  };

  const findAttachment = async (
    listId: string,
    id: string,
  ): Promise<
    | null
    | (Pick<
        AttachmentRow,
        "id" | "filename" | "content_type" | "created_at"
      > & {
        object_key: string;
        todoId: string;
      })
  > => {
    if (!UUID.test(id)) return null;
    const [row] = rowsOf<{
      id: string;
      filename: string;
      content_type: string;
      created_at: unknown;
      object_key: string;
      todoId: string;
    }>(
      await sql`
        SELECT a.id, a.filename, a.content_type, a.created_at,
               a.object_key, t.id AS "todoId"
        FROM public.attachments a
        JOIN public.todos t ON t.id = a.todo_id
        WHERE a.id = ${id} AND t.list_id = ${listId}
      `,
    );
    return row ?? null;
  };

  const addActivity = (
    listId: string,
    todoId: string | null,
    userId: string | null,
    kind: ActivityKind,
    field: string | null,
    before: string | null,
    after: string | null,
  ): SqlCall =>
    // now() はトランザクション開始時刻で同一になるため、履歴の並び順を保つために
    // 実行時刻の clock_timestamp() を明示する。
    sql`
      INSERT INTO public.activities (id, list_id, todo_id, user_id, kind, field, before, after, created_at)
      VALUES (${randomUUID()}, ${listId}, ${todoId}, ${userId}, ${kind}, ${field}, ${before}, ${after}, clock_timestamp())
    `;

  const addNotification = (
    listId: string,
    todoId: string,
    userId: string,
    actorId: string | null,
    kind: NotificationKind,
    body: string | null,
  ): SqlCall =>
    // 通知は宛先ごとに1行。プレビューに使う本文は kind 側で決めて渡す。
    sql`
      INSERT INTO public.notifications (id, list_id, user_id, actor_id, todo_id, kind, body)
      VALUES (${randomUUID()}, ${listId}, ${userId}, ${actorId}, ${todoId}, ${kind}, ${body})
    `;

  // 承認・否認の通知先は TODO の担当者と作成者。操作者自身には送らない。
  const approvalRecipients = (
    row: TodoRecordRow,
    actorId: string | null,
  ): string[] => {
    const recipients = new Set<string>();
    for (const assigneeId of toTextArray(row.assignee_ids))
      recipients.add(assigneeId);
    if (row.created_by) recipients.add(row.created_by);
    if (actorId) recipients.delete(actorId);
    return [...recipients];
  };

  app.post("/api/lists", async (c) => {
    const body = await readJson(c);
    const title = assertText(body.title, 120, "title");
    const name = assertText(body.name, 120, "name");
    const token = generateToken();
    const listId = randomUUID();
    const userId = randomUUID();
    const activityId = randomUUID();
    await transact([
      sql`INSERT INTO public.lists (id, token, title) VALUES (${listId}, ${token}, ${title})`,
      sql`INSERT INTO public.users (id, list_id, name) VALUES (${userId}, ${listId}, ${name})`,
      sql`
        INSERT INTO public.activities (id, list_id, todo_id, user_id, kind, field, before, after, created_at)
        VALUES (${activityId}, ${listId}, NULL, ${userId}, 'user.joined', NULL, NULL, ${name}, clock_timestamp())
      `,
    ]);
    return c.json({ token }, 201);
  });

  app.patch("/api/lists/:token", async (c) => {
    const list = await findList(c.req.param("token"));
    if (!list) return notFound(c);
    const body = await readJson(c);
    const title = assertText(body.title, 120, "title");
    const userId = await readOptionalUserId(body, list.id);

    await transact([
      sql`UPDATE public.lists SET title = ${title} WHERE id = ${list.id}`,
      addActivity(
        list.id,
        null,
        userId,
        "list.renamed",
        "title",
        list.title,
        title,
      ),
    ]);
    return c.json({ revision: await readRevision(list.id) });
  });

  app.delete("/api/lists/:token", async (c) => {
    const list = await findList(c.req.param("token"));
    if (!list) return notFound(c);
    const storedObjects = rowsOf<{
      object_key: string;
    }>(
      await sql`
        SELECT a.object_key FROM public.attachments a
        JOIN public.todos t ON t.id = a.todo_id
        WHERE t.list_id = ${list.id}
        GROUP BY a.object_key
      `,
    );
    if (storedObjects.length > 0) {
      const remnants: string[] = [];
      for (const object of storedObjects) {
        try {
          await requireObjectStorage().delete(object.object_key);
        } catch (error) {
          console.error(error);
          remnants.push(object.object_key);
        }
      }
      if (remnants.length > 0)
        throw new ApiException(
          502,
          "failed to delete files from object storage; retry list deletion",
        );
    }
    // 子テーブルは FK の ON DELETE CASCADE で物理削除される。
    // 確認 UI はクライアント側の責務なので、ここでは即時削除する。
    await sql`DELETE FROM public.lists WHERE id = ${list.id}`;
    return c.json({}, 200);
  });

  app.get("/api/lists/:token/revision", async (c) => {
    const list = await findList(c.req.param("token"));
    if (!list) return notFound(c);
    return c.json({ revision: Number(list.revision) });
  });

  app.post("/api/lists/:token/join", async (c) => {
    const list = await findList(c.req.param("token"));
    if (!list) return notFound(c);
    const body = await readJson(c);
    const name = assertText(body.name, 120, "name");
    const userId = randomUUID();
    const activityId = randomUUID();
    // 新規ユーザーが作られたときだけ user.joined を記録する。
    // 既存名の再参加では INSERT が競合し、EXISTS が偽になるため履歴も増えない。
    await transact([
      sql`
        INSERT INTO public.users (id, list_id, name)
        VALUES (${userId}, ${list.id}, ${name})
        ON CONFLICT (list_id, name) DO NOTHING
      `,
      sql`
        INSERT INTO public.activities (id, list_id, todo_id, user_id, kind, field, before, after, created_at)
        SELECT ${activityId}, ${list.id}, NULL, ${userId}, 'user.joined', NULL, NULL, ${name}, clock_timestamp()
        WHERE EXISTS (SELECT 1 FROM public.users WHERE id = ${userId})
      `,
    ]);
    const [user] = rowsOf<{ id: string }>(
      await sql`SELECT id FROM public.users WHERE list_id = ${list.id} AND name = ${name}`,
    );
    if (!user) throw new Error("failed to resolve joined user");
    return c.json({ userId: user.id, name });
  });

  app.patch("/api/lists/:token/users/:id", async (c) => {
    const list = await findList(c.req.param("token"));
    if (!list) return notFound(c);
    const user = await findUser(list.id, c.req.param("id"));
    if (!user) return notFound(c);
    const body = await readJson(c);
    const name = assertText(body.name, 120, "name");
    const userId = await readOptionalUserId(body, list.id);

    if (name === user.name) return c.json({ userId: user.id, name });

    const [conflict] = rowsOf<{ id: string }>(
      await sql`SELECT id FROM public.users WHERE list_id = ${list.id} AND name = ${name} AND id <> ${user.id}`,
    );
    if (conflict) throw new ApiException(409, "name already in use");

    await transact([
      sql`UPDATE public.users SET name = ${name} WHERE id = ${user.id} AND list_id = ${list.id}`,
      addActivity(
        list.id,
        null,
        userId,
        "user.renamed",
        "name",
        user.name,
        name,
      ),
    ]);
    return c.json({ userId: user.id, name });
  });

  app.delete("/api/lists/:token/users/:id", async (c) => {
    const list = await findList(c.req.param("token"));
    if (!list) return notFound(c);
    const user = await findUser(list.id, c.req.param("id"));
    if (!user) return notFound(c);
    const body = await readOptionalJson(c);
    const userId = await readOptionalUserId(body, list.id);

    // 履歴の user_id が削除対象を指す場合、users 削除時の FK で NULL になるため
    // activity を先に挿入する。担当中の TODO の assignee_ids は FK が無いため、
    // 配列からも先に除いておく。
    await transact([
      addActivity(list.id, null, userId, "user.removed", null, user.name, null),
      sql`
        UPDATE public.todos SET assignee_ids = array_remove(assignee_ids, ${user.id}::uuid)
        WHERE list_id = ${list.id} AND ${user.id} = ANY(assignee_ids)
      `,
      sql`DELETE FROM public.users WHERE id = ${user.id} AND list_id = ${list.id}`,
    ]);
    return c.json({}, 200);
  });

  app.post("/api/lists/:token/todos", async (c) => {
    const list = await findList(c.req.param("token"));
    if (!list) return notFound(c);
    await assertTodoLimit(list.id);
    const body = await readJson(c);

    const title = assertText(body.title, 120, "title");
    const description =
      body.description === undefined ? "" : parseDescription(body.description);
    const deadline =
      body.deadline === undefined ? null : parseDeadline(body.deadline);
    const status = parseEnum(body.status, STATUSES, "status");
    const priority = parseEnum(body.priority, PRIORITIES, "priority");
    const assigneeIds = await parseAssigneeIds(list.id, body);
    const userId = await readOptionalUserId(body, list.id);
    const tags = parseTags(body.tags);
    // 「申請」タグ付きで作られたTODOは承認待ちとして始まる。
    const approvalStatus = tags.includes(REQUEST_TAG) ? "pending" : null;

    const id = randomUUID();
    const statements = [
      sql`
        INSERT INTO public.todos (id, list_id, title, description, status, priority, due, assignee_ids, tags, approval_status)
        VALUES (${id}, ${list.id}, ${title}, ${description}, ${status}, ${priority}, ${deadline}, ${toPgTextArray(assigneeIds)}::uuid[], ${toPgTextArray(tags)}::text[], ${approvalStatus})
      `,
      addActivity(list.id, id, userId, "todo.created", null, null, title),
    ];
    // 担当者を設定して作った場合だけ、担当者に作成通知を積む。
    if (userId !== null)
      for (const assigneeId of assigneeIds)
        if (assigneeId !== userId)
          statements.push(
            addNotification(
              list.id,
              id,
              assigneeId,
              userId,
              "todo.assigned",
              title,
            ),
          );
    await transact(statements);
    return c.json({ id }, 201);
  });

  app.patch("/api/lists/:token/todos/:id", async (c) => {
    const list = await findList(c.req.param("token"));
    if (!list) return notFound(c);
    const row = await findTodo(list.id, c.req.param("id"));
    if (!row || row.deleted_at !== null) return notFound(c);
    const body = await readJson(c);

    const patch: TodoPatch = {};
    if (body.title !== undefined)
      patch.title = assertText(body.title, 120, "title");
    if (body.description !== undefined)
      patch.description = parseDescription(body.description);
    if (body.deadline !== undefined)
      patch.deadline = parseDeadline(body.deadline);
    if (body.status !== undefined)
      patch.status = parseEnum(body.status, STATUSES, "status");
    if (body.priority !== undefined)
      patch.priority = parseEnum(body.priority, PRIORITIES, "priority");
    if (body.tags !== undefined) patch.tags = parseTags(body.tags);

    const assigneesAfter: string[] | undefined =
      body.assigneeIds !== undefined || body.assigneeId !== undefined
        ? await parseAssigneeIds(list.id, body)
        : undefined;
    if (assigneesAfter !== undefined) patch.assigneeIds = assigneesAfter;
    const userId = await readOptionalUserId(body, list.id);

    const before = toCloudTodo(row);
    const assigneeChanged =
      patch.assigneeIds !== undefined &&
      !sameIds(patch.assigneeIds, before.assigneeIds);
    let assigneeNamesBefore: string[] = [];
    if (assigneeChanged) {
      assigneeNamesBefore = await Promise.all(
        before.assigneeIds.map(
          async (id) => (await findUser(list.id, id))?.name ?? id,
        ),
      );
    }
    const assigneeNamesAfter = assigneeChanged
      ? await Promise.all(
          patch.assigneeIds!.map(
            async (id) => (await findUser(list.id, id))?.name ?? id,
          ),
        )
      : [];
    const changes = computeActivities(
      before,
      patch,
      assigneeNamesAfter,
      assigneeNamesBefore,
    );

    if (changes.length === 0)
      return c.json({ revision: await readRevision(list.id) });

    const has = {
      title: patch.title !== undefined,
      description: patch.description !== undefined,
      deadline: patch.deadline !== undefined,
      status: patch.status !== undefined,
      priority: patch.priority !== undefined,
      assignee: patch.assigneeIds !== undefined,
      tags: patch.tags !== undefined,
    };
    const nextDeadline =
      patch.deadline !== undefined ? patch.deadline : before.deadline;
    const nextAssigneeIds =
      patch.assigneeIds !== undefined ? patch.assigneeIds : before.assigneeIds;
    const nextTags = has.tags ? patch.tags! : before.tags;
    // 申請タグの脱着でのみ承認状態を切り替える。既に pending/approved/rejected
    // のTODOに同タグを残す編集では現在値を保つ(否認済みのまま編集可)。
    const approvalWillOpen =
      has.tags &&
      nextTags.includes(REQUEST_TAG) &&
      !before.tags.includes(REQUEST_TAG);
    const approvalWillClear =
      has.tags &&
      !nextTags.includes(REQUEST_TAG) &&
      before.tags.includes(REQUEST_TAG);

    const statements = [
      sql`
        UPDATE public.todos SET
          title = CASE WHEN ${has.title} THEN ${patch.title ?? before.title} ELSE title END,
          description = CASE WHEN ${has.description} THEN ${patch.description ?? before.description} ELSE description END,
          due = CASE WHEN ${has.deadline} THEN ${nextDeadline}::timestamptz ELSE due END,
          status = CASE WHEN ${has.status} THEN ${patch.status ?? before.status} ELSE status END,
          priority = CASE WHEN ${has.priority} THEN ${patch.priority ?? before.priority} ELSE priority END,
          assignee_ids = CASE WHEN ${has.assignee} THEN ${toPgTextArray(nextAssigneeIds)}::uuid[] ELSE assignee_ids END,
          tags = CASE WHEN ${has.tags} THEN ${toPgTextArray(nextTags)}::text[] ELSE tags END,
          approval_status = CASE WHEN ${approvalWillOpen} THEN 'pending' WHEN ${approvalWillClear} THEN NULL ELSE approval_status END,
          approval_reason = CASE WHEN ${approvalWillOpen || approvalWillClear} THEN NULL ELSE approval_reason END,
          approval_by = CASE WHEN ${approvalWillOpen || approvalWillClear} THEN NULL ELSE approval_by END,
          approval_at = CASE WHEN ${approvalWillOpen || approvalWillClear} THEN NULL ELSE approval_at END,
          updated_at = now()
        WHERE id = ${row.id} AND list_id = ${list.id} AND deleted_at IS NULL
      `,
      ...changes.map((change) =>
        addActivity(
          list.id,
          row.id,
          userId,
          "todo.updated",
          change.field,
          change.before,
          change.after,
        ),
      ),
    ];
    // 新たに追加された担当者に通知する(自分で自分を選んだ場合は除く)。
    if (assigneeChanged && userId !== null)
      for (const assigneeId of patch.assigneeIds!)
        if (!before.assigneeIds.includes(assigneeId) && assigneeId !== userId)
          statements.push(
            addNotification(
              list.id,
              row.id,
              assigneeId,
              userId,
              "todo.assigned",
              (patch.title ?? before.title) as string,
            ),
          );
    await transact(statements);
    return c.json({ revision: await readRevision(list.id) });
  });

  // 承認・否認は申請タグ付きTODO専用。否認は理由の提出を強制する。
  app.post("/api/lists/:token/todos/:id/approve", async (c) => {
    const list = await findList(c.req.param("token"));
    if (!list) return notFound(c);
    const row = await findTodo(list.id, c.req.param("id"));
    if (!row || row.deleted_at !== null) return notFound(c);
    const body = await readOptionalJson(c);
    const userId = await readOptionalUserId(body, list.id);

    if (!toTextArray(row.tags).includes(REQUEST_TAG))
      throw new ApiException(400, "todo is not tagged as a request");
    // 既に承認済みへの再呼び出しは無変更で成功させる(冪等)。
    if (row.approval_status === "approved")
      return c.json({ revision: await readRevision(list.id) });

    await transact([
      sql`
        UPDATE public.todos SET
          approval_status = 'approved',
          approval_reason = NULL,
          approval_by = ${userId}::uuid,
          approval_at = clock_timestamp(),
          updated_at = now()
        WHERE id = ${row.id} AND list_id = ${list.id} AND deleted_at IS NULL
      `,
      addActivity(
        list.id,
        row.id,
        userId,
        "approval.approved",
        "approval",
        row.approval_status,
        "approved",
      ),
      ...approvalRecipients(row, userId).map((recipient) =>
        addNotification(
          list.id,
          row.id,
          recipient,
          userId,
          "approval.approved",
          row.title,
        ),
      ),
    ]);
    return c.json({ revision: await readRevision(list.id) });
  });

  app.post("/api/lists/:token/todos/:id/reject", async (c) => {
    const list = await findList(c.req.param("token"));
    if (!list) return notFound(c);
    const row = await findTodo(list.id, c.req.param("id"));
    if (!row || row.deleted_at !== null) return notFound(c);
    const body = await readJson(c);

    // 理由のない却下は禁じる(400で二重防御)。理由は履歴・通知にも載る。
    if (typeof body.reason !== "string" || !body.reason.trim())
      throw new ApiException(400, "reason is required");
    const reason = assertText(body.reason, 2000, "reason");
    const userId = await readOptionalUserId(body, list.id);

    if (!toTextArray(row.tags).includes(REQUEST_TAG))
      throw new ApiException(400, "todo is not tagged as a request");

    await transact([
      sql`
        UPDATE public.todos SET
          approval_status = 'rejected',
          approval_reason = ${reason},
          approval_by = ${userId}::uuid,
          approval_at = clock_timestamp(),
          updated_at = now()
        WHERE id = ${row.id} AND list_id = ${list.id} AND deleted_at IS NULL
      `,
      addActivity(
        list.id,
        row.id,
        userId,
        "approval.rejected",
        "reason",
        row.approval_reason,
        reason,
      ),
      ...approvalRecipients(row, userId).map((recipient) =>
        addNotification(
          list.id,
          row.id,
          recipient,
          userId,
          "approval.rejected",
          reason,
        ),
      ),
    ]);
    return c.json({ revision: await readRevision(list.id) });
  });

  app.delete("/api/lists/:token/todos/:id", async (c) => {
    const list = await findList(c.req.param("token"));
    if (!list) return notFound(c);
    const row = await findTodo(list.id, c.req.param("id"));
    if (!row) return notFound(c);
    const body = await readOptionalJson(c);
    const userId = await readOptionalUserId(body, list.id);

    if (row.deleted_at !== null)
      return c.json({ revision: await readRevision(list.id) });

    // TODO削除は取り消し可能なソフト削除。親を非表示にすると取得結果から
    // サブタスクも隠れるが、行は保持して restore で復元する。
    // 物理削除はDBのON DELETE CASCADEに任せ、サブタスクとメモも削除する。
    await transact([
      sql`
        UPDATE public.todos SET deleted_at = now()
        WHERE id = ${row.id} AND list_id = ${list.id} AND deleted_at IS NULL
      `,
      addActivity(
        list.id,
        row.id,
        userId,
        "todo.deleted",
        null,
        row.title,
        null,
      ),
    ]);
    return c.json({ revision: await readRevision(list.id) });
  });

  app.post("/api/lists/:token/todos/:id/restore", async (c) => {
    const list = await findList(c.req.param("token"));
    if (!list) return notFound(c);
    const row = await findTodo(list.id, c.req.param("id"));
    if (!row) return notFound(c);
    const body = await readOptionalJson(c);
    const userId = await readOptionalUserId(body, list.id);

    if (row.deleted_at === null)
      return c.json({ revision: await readRevision(list.id) });

    await transact([
      sql`
        UPDATE public.todos SET deleted_at = NULL, updated_at = now()
        WHERE id = ${row.id} AND list_id = ${list.id} AND deleted_at IS NOT NULL
      `,
      addActivity(
        list.id,
        row.id,
        userId,
        "todo.restored",
        null,
        row.title,
        null,
      ),
    ]);
    return c.json({ revision: await readRevision(list.id) });
  });

  app.post("/api/lists/:token/todos/:id/memos", async (c) => {
    const list = await findList(c.req.param("token"));
    if (!list) return notFound(c);
    const row = await findTodo(list.id, c.req.param("id"));
    if (!row || row.deleted_at !== null) return notFound(c);
    await assertMemoLimit(row.id);
    const body = await readJson(c);

    const text = assertText(body.body, 2000, "body");
    const userId = await readOptionalUserId(body, list.id);
    const id = randomUUID();
    // 送信者以外のメンバーを候補に、本文中の @<名前>(完全一致)をメンションとする。
    const mentionCandidates = rowsOf<{ id: string; name: string }>(
      userId === null
        ? await sql`SELECT id, name FROM public.users WHERE list_id = ${list.id}`
        : await sql`SELECT id, name FROM public.users WHERE list_id = ${list.id} AND id <> ${userId}`,
    );
    const mentioned = extractMentions(text, mentionCandidates);
    await transact([
      sql`
        INSERT INTO public.memos (id, todo_id, user_id, body)
        VALUES (${id}, ${row.id}, ${userId}, ${text})
      `,
      ...mentioned.map((mentionedId) =>
        addNotification(list.id, row.id, mentionedId, userId, "mention", text),
      ),
    ]);
    return c.json({ id }, 201);
  });

  // ---- 添付系エンドポイント ------------------------------------------
  // 1リクエストにつき1ファイル。複数ファイルはフロントエンドが逐次送る。

  /** TODO単位のファイル添付。 */
  app.post("/api/lists/:token/todos/:todoId/attachments", async (c) => {
    try {
      const list = await findList(c.req.param("token"));
      if (!list) return notFound(c);
      const todo = await findAttachedTodo(list.id, c.req.param("todoId"));
      if (!todo) return notFound(c);
      const form = await readFormData(c);
      const userId = await optionalUserIdFromForm(form, list.id);
      const verified = await extractVerifiedFile(form);
      await uploadAndRegister({
        listId: list.id,
        todoId: todo.id,
        memoId: null,
        userId,
        filename: verified.filename,
        contentType: verified.contentType,
        file: verified.file,
      });
      return c.json(
        {
          attachment: {
            filename: verified.filename,
            contentType: verified.contentType,
          },
          revision: await readRevision(list.id),
        },
        201,
      );
    } catch (error) {
      throw toApiError(error);
    }
  });

  /** 本文と最初のファイルをまとめて受け取るメモ作成。 */
  app.post(
    "/api/lists/:token/todos/:todoId/memos/with-attachment",
    async (c) => {
      try {
        const list = await findList(c.req.param("token"));
        if (!list) return notFound(c);
        const todo = await findAttachedTodo(list.id, c.req.param("todoId"));
        if (!todo) return notFound(c);
        const form = await readFormData(c);
        const userId = await optionalUserIdFromForm(form, list.id);
        const bodyValue = form.get("body");
        if (bodyValue !== null && typeof bodyValue !== "string")
          throw new ApiException(400, "body must be a string");
        const text = typeof bodyValue === "string" ? bodyValue.trim() : "";
        if (text.length > 2000)
          throw new ApiException(400, "body must be at most 2000 characters");
        const verified = await extractVerifiedFile(form);
        const memoId = randomUUID();
        await assertMemoLimit(todo.id);
        await assertAttachmentLimit(todo.id);
        await assertListStorageBudget(list.id, verified.file.size);
        const attachmentId = randomUUID();
        const objectKey = `attachments/${attachmentId}`;
        // 送信者以外のメンバーを候補に、本文中の @<名前>(完全一致)をメンションとする。
        const mentionCandidates = rowsOf<{ id: string; name: string }>(
          userId === null
            ? await sql`SELECT id, name FROM public.users WHERE list_id = ${list.id}`
            : await sql`SELECT id, name FROM public.users WHERE list_id = ${list.id} AND id <> ${userId}`,
        );
        const mentioned = text ? extractMentions(text, mentionCandidates) : [];
        const storage = requireObjectStorage();
        await storage.put({
          key: objectKey,
          contentType: verified.contentType,
          body: verified.file,
        });
        try {
          await transact([
            sql`
              INSERT INTO public.memos (id, todo_id, user_id, body)
              VALUES (${memoId}, ${todo.id}, ${userId}, ${text})
            `,
            insertAttachment({
              attachmentId,
              todoId: todo.id,
              memoId,
              userId,
              filename: verified.filename,
              contentType: verified.contentType,
              sizeBytes: verified.file.size,
              objectKey,
            }),
            ...mentioned.map((mentionedId) =>
              addNotification(
                list.id,
                todo.id,
                mentionedId,
                userId,
                "mention",
                text,
              ),
            ),
          ]);
        } catch (error) {
          await storage.delete(objectKey).catch(() => {});
          throw error;
        }
        return c.json(
          { id: memoId, revision: await readRevision(list.id) },
          201,
        );
      } catch (error) {
        throw toApiError(error);
      }
    },
  );

  /** 作成済みメモへの追加ファイル。 */
  app.post(
    "/api/lists/:token/todos/:todoId/memos/:memoId/attachments",
    async (c) => {
      try {
        const list = await findList(c.req.param("token"));
        if (!list) return notFound(c);
        const todo = await findAttachedTodo(list.id, c.req.param("todoId"));
        if (!todo) return notFound(c);
        const memo = await findMemo(todo.id, c.req.param("memoId"));
        if (!memo) return notFound(c);
        const form = await readFormData(c);
        const userId = await optionalUserIdFromForm(form, list.id);
        const verified = await extractVerifiedFile(form);
        await uploadAndRegister({
          listId: list.id,
          todoId: todo.id,
          memoId: memo.id,
          userId,
          filename: verified.filename,
          contentType: verified.contentType,
          file: verified.file,
        });
        return c.json({ revision: await readRevision(list.id) }, 201);
      } catch (error) {
        throw toApiError(error);
      }
    },
  );

  /** オブジェクトストレージの署名付きURLを再取得する。 */
  app.get("/api/lists/:token/attachments/:id/url", async (c) => {
    const list = await findList(c.req.param("token"));
    if (!list) return notFound(c);
    const row = await findAttachment(list.id, c.req.param("id"));
    if (!row) return notFound(c);
    const url = await requireObjectStorage().signedUrl({
      key: row.object_key,
      contentType: row.content_type,
      // プレビューできる形式(画像・動画・テキスト)だけ inline。
      // それ以外は保存先の配信元(CSP 外)で解釈されるため
      // Content-Disposition: attachment でダウンロードに強制する(監査 M-001)。
      contentDisposition: isInlineRenderable(row.content_type)
        ? "inline"
        : "attachment",
    });
    return c.json({
      url,
      filename: row.filename,
      contentType: row.content_type,
    });
  });

  /** 添付ファイルの削除。失敗したら行を残して再試行できる。 */
  app.delete("/api/lists/:token/attachments/:id", async (c) => {
    const list = await findList(c.req.param("token"));
    if (!list) return notFound(c);
    const row = await findAttachment(list.id, c.req.param("id"));
    if (!row) return notFound(c);
    try {
      await requireObjectStorage().delete(row.object_key);
    } catch (error) {
      // オブジェクト削除に失敗してもNeonの行情報は消さず、後で再試行する。
      console.error(error);
      throw new ApiException(502, "failed to delete the attachment object");
    }
    await sql`DELETE FROM public.attachments WHERE id = ${row.id}`;
    return c.json({ revision: await readRevision(list.id) });
  });

  app.post("/api/lists/:token/todos/:todoId/subtasks", async (c) => {
    const list = await findList(c.req.param("token"));
    if (!list) return notFound(c);
    const todo = await findTodo(list.id, c.req.param("todoId"));
    if (!todo || todo.deleted_at !== null) return notFound(c);
    await assertSubtaskLimit(todo.id);
    const body = await readJson(c);

    const title = assertText(body.title, 120, "title");
    const deadline =
      body.deadline === undefined ? null : parseDeadline(body.deadline);
    const status = parseEnum(body.status, SUBTASK_STATUSES, "status");
    const priority = parseEnum(body.priority, PRIORITIES, "priority");
    await readOptionalUserId(body, list.id);

    const id = randomUUID();
    await transact([
      sql`
        INSERT INTO public.subtasks (id, todo_id, title, status, priority, due)
        VALUES (${id}, ${todo.id}, ${title}, ${status}, ${priority}, ${deadline})
      `,
    ]);
    return c.json({ id }, 201);
  });

  app.patch(
    "/api/lists/:token/todos/:todoId/subtasks/:subtaskId",
    async (c) => {
      const list = await findList(c.req.param("token"));
      if (!list) return notFound(c);
      const todo = await findTodo(list.id, c.req.param("todoId"));
      if (!todo || todo.deleted_at !== null) return notFound(c);
      const row = await findSubtask(todo.id, c.req.param("subtaskId"));
      if (!row) return notFound(c);
      const body = await readJson(c);

      const title =
        body.title === undefined
          ? row.title
          : assertText(body.title, 120, "title");
      const deadline =
        body.deadline === undefined
          ? toIsoOrNull(row.due)
          : parseDeadline(body.deadline);
      const status =
        body.status === undefined
          ? (row.status as SubtaskStatus)
          : parseEnum(body.status, SUBTASK_STATUSES, "status");
      const priority =
        body.priority === undefined
          ? (row.priority as Priority)
          : parseEnum(body.priority, PRIORITIES, "priority");
      await readOptionalUserId(body, list.id);

      if (
        title === row.title &&
        deadline === toIsoOrNull(row.due) &&
        status === row.status &&
        priority === row.priority
      )
        return c.json({ revision: await readRevision(list.id) });

      await transact([
        sql`
          UPDATE public.subtasks SET
            title = ${title},
            due = ${deadline}::timestamptz,
            status = ${status},
            priority = ${priority},
            updated_at = now()
          WHERE id = ${row.id} AND todo_id = ${todo.id}
        `,
      ]);
      return c.json({ revision: await readRevision(list.id) });
    },
  );

  app.delete(
    "/api/lists/:token/todos/:todoId/subtasks/:subtaskId",
    async (c) => {
      const list = await findList(c.req.param("token"));
      if (!list) return notFound(c);
      const todo = await findTodo(list.id, c.req.param("todoId"));
      if (!todo || todo.deleted_at !== null) return notFound(c);
      const row = await findSubtask(todo.id, c.req.param("subtaskId"));
      if (!row) return notFound(c);
      const body = await readOptionalJson(c);
      await readOptionalUserId(body, list.id);

      await sql`DELETE FROM public.subtasks WHERE id = ${row.id} AND todo_id = ${todo.id}`;
      return c.json({ revision: await readRevision(list.id) });
    },
  );

  app.post(
    "/api/lists/:token/todos/:todoId/subtasks/:subtaskId/memos",
    async (c) => {
      const list = await findList(c.req.param("token"));
      if (!list) return notFound(c);
      const todo = await findTodo(list.id, c.req.param("todoId"));
      if (!todo || todo.deleted_at !== null) return notFound(c);
      const subtask = await findSubtask(todo.id, c.req.param("subtaskId"));
      if (!subtask) return notFound(c);
      await assertSubtaskMemoLimit(subtask.id);
      const body = await readJson(c);

      const text = assertText(body.body, 2000, "body");
      await readOptionalUserId(body, list.id);
      const id = randomUUID();
      await sql`
        INSERT INTO public.subtask_memos (id, subtask_id, body)
        VALUES (${id}, ${subtask.id}, ${text})
      `;
      return c.json({ id }, 201);
    },
  );

  app.post("/api/lists/:token/notifications/read", async (c) => {
    const list = await findList(c.req.param("token"));
    if (!list) return notFound(c);
    const body = await readJson(c);
    if (body.userId === undefined || body.userId === null)
      throw new ApiException(400, "userId is required");
    const userId = parseUserId(body.userId, "userId");
    await requireUser(list.id, userId);

    // users の UPDATE は既存トリガーで revision を進めるため、
    // 他端末のバッジもポーリングで散っていく。
    await sql`
      UPDATE public.users SET notification_read_at = clock_timestamp()
      WHERE id = ${userId} AND list_id = ${list.id}
    `;
    return c.json({ revision: await readRevision(list.id) });
  });

  app.get("/api/lists/:token", async (c) => {
    const list = await findList(c.req.param("token"));
    if (!list) return notFound(c);

    // 通知は宛先ごとに分かれるため、userId が有効なメンバーのときだけ
    // その人の通知を同梱する。指定がなければ通知より前の互換応答とする。
    const requestedUserId = c.req.query("userId");
    const viewer = requestedUserId
      ? await findUser(list.id, requestedUserId)
      : null;
    if (requestedUserId && !viewer)
      throw new ApiException(404, "user not found");

    const [
      usersResult,
      todosResult,
      memosResult,
      subtasksResult,
      subtaskMemosResult,
      attachmentsResult,
      activitiesResult,
      notificationsResult,
    ] = await Promise.all([
      sql`SELECT id, name, created_at, notification_read_at FROM public.users WHERE list_id = ${list.id} ORDER BY created_at, id`,
      sql`SELECT id, title, description, status, priority, due, assignee_ids, tags, approval_status, approval_reason, created_at, updated_at FROM public.todos WHERE list_id = ${list.id} AND deleted_at IS NULL ORDER BY created_at, id`,
      sql`SELECT m.id, m.todo_id, m.user_id, m.body, m.created_at FROM public.memos m JOIN public.todos t ON t.id = m.todo_id WHERE t.list_id = ${list.id} AND t.deleted_at IS NULL ORDER BY m.created_at, m.id`,
      // 親TODOのソフト削除中は、復元までサブタスクも取得結果から隠す。
      sql`SELECT s.id, s.todo_id, s.title, s.status, s.priority, s.due, s.created_at, s.updated_at FROM public.subtasks s JOIN public.todos t ON t.id = s.todo_id WHERE t.list_id = ${list.id} AND t.deleted_at IS NULL ORDER BY s.created_at, s.id`,
      sql`SELECT m.id, m.subtask_id, m.body, m.created_at FROM public.subtask_memos m JOIN public.subtasks s ON s.id = m.subtask_id JOIN public.todos t ON t.id = s.todo_id WHERE t.list_id = ${list.id} AND t.deleted_at IS NULL ORDER BY m.created_at, m.id`,
      // TODO・メモの添付情報は署名付きURLに到らない識別情報だけを返す。
      sql`SELECT a.id, a.todo_id, a.memo_id, a.filename, a.content_type, a.size_bytes, a.created_by, a.created_at
          FROM public.attachments a
          JOIN public.todos t ON t.id = a.todo_id
          WHERE t.list_id = ${list.id} AND t.deleted_at IS NULL
          ORDER BY a.created_at, a.id`,
      // 最新順に取得して上位 ACTIVITY_LIMIT 件に絞り、応答では時系列(昇順)に戻す。
      sql`SELECT id, todo_id, user_id, kind, field, before, after, created_at FROM public.activities WHERE list_id = ${list.id} ORDER BY created_at DESC, id DESC LIMIT ${ACTIVITY_LIMIT}`,
      // 通知は自分宛だけ。userId 未指定のときは NULL との比較で該当ゼロになる。
      sql`SELECT n.id, n.todo_id, n.actor_id, n.kind, n.body, n.created_at
          FROM public.notifications n
          WHERE n.list_id = ${list.id} AND n.user_id = ${viewer?.id ?? null}
          ORDER BY n.created_at DESC, n.id DESC
          LIMIT ${NOTIFICATION_LIMIT}`,
    ]);

    // 添付情報はTODO単位とメモ単位に分けて集める。
    const attachmentsByTodo = new Map<string, Attachment[]>();
    const attachmentsByMemo = new Map<string, Attachment[]>();
    for (const row of rowsOf<AttachmentRow>(attachmentsResult)) {
      const attachment = toCloudAttachment(row);
      const attended = attachmentsByTodo.get(row.todo_id);
      if (attended) attended.push(attachment);
      else attachmentsByTodo.set(row.todo_id, [attachment]);
      if (row.memo_id) {
        const noted = attachmentsByMemo.get(row.memo_id);
        if (noted) noted.push(attachment);
        else attachmentsByMemo.set(row.memo_id, [attachment]);
      }
    }

    const notesByTodo = new Map<string, Note[]>();
    for (const memo of rowsOf<MemoRow>(memosResult)) {
      const note: Note = {
        id: memo.id,
        text: memo.body,
        createdAt: toIso(memo.created_at),
        userId: memo.user_id,
        attachments: attachmentsByMemo.get(memo.id) ?? [],
      };
      const notes = notesByTodo.get(memo.todo_id);
      if (notes) notes.push(note);
      else notesByTodo.set(memo.todo_id, [note]);
    }

    const subtaskMemosBySubtask = new Map<string, SubtaskMemo[]>();
    for (const memo of rowsOf<SubtaskMemoRow>(subtaskMemosResult)) {
      const subtaskMemo: SubtaskMemo = {
        id: memo.id,
        text: memo.body,
        createdAt: toIso(memo.created_at),
      };
      const memos = subtaskMemosBySubtask.get(memo.subtask_id);
      if (memos) memos.push(subtaskMemo);
      else subtaskMemosBySubtask.set(memo.subtask_id, [subtaskMemo]);
    }

    const subtasksByTodo = new Map<string, Subtask[]>();
    for (const subtask of rowsOf<SubtaskRow>(subtasksResult)) {
      const item = toCloudSubtask(
        subtask,
        subtaskMemosBySubtask.get(subtask.id) ?? [],
      );
      const subtasks = subtasksByTodo.get(subtask.todo_id);
      if (subtasks) subtasks.push(item);
      else subtasksByTodo.set(subtask.todo_id, [item]);
    }

    const state: CloudState = {
      list: {
        id: list.id,
        title: list.title,
        revision: Number(list.revision),
      },
      users: rowsOf<UserRow>(usersResult).map((user): CloudUser => ({
        id: user.id,
        name: user.name,
        createdAt: toIso(user.created_at),
        notificationReadAt: user.notification_read_at
          ? toIso(user.notification_read_at)
          : null,
      })),
      todos: rowsOf<TodoRow>(todosResult).map((todo): CloudTodo => ({
        ...toCloudTodo(todo),
        notes: notesByTodo.get(todo.id) ?? [],
        subtasks: subtasksByTodo.get(todo.id) ?? [],
        attachments: attachmentsByTodo.get(todo.id) ?? [],
      })),
      activities: rowsOf<ActivityRow>(activitiesResult)
        .reverse()
        .map((activity): Activity => ({
          id: activity.id,
          todoId: activity.todo_id,
          userId: activity.user_id,
          kind: activity.kind as ActivityKind,
          field: activity.field,
          before: activity.before,
          after: activity.after,
          createdAt: toIso(activity.created_at),
        })),
      notifications: rowsOf<NotificationRow>(notificationsResult).map(
        (notification): Notification => ({
          id: notification.id,
          todoId: notification.todo_id,
          userId: notification.actor_id,
          kind: notification.kind as NotificationKind,
          body: notification.body,
          createdAt: toIso(notification.created_at),
        }),
      ),
    };
    return c.json(state);
  });

  app.notFound(notFound);

  app.onError((error, c) => {
    if (error instanceof ApiException)
      return c.json({ error: error.message }, error.status);
    if (describe) {
      void describe()
        .then((info) => console.error(error, { database: info }))
        .catch((diagnosticError: unknown) =>
          console.error(error, { databaseDiagnosticError: diagnosticError }),
        );
    } else {
      console.error(error);
    }
    return c.json({ error: "internal server error" }, 500);
  });

  return app;
}

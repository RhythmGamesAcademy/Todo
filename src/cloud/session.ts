export const SESSION_KEY = "hitotsuzutsu.session.v1";

export interface Session {
  token: string;
  userId: string;
  name: string;
}

const HASH_PREFIX = "#token=";

const isNonEmptyText = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "";

// 壊れたデータを勝手に直したり消したりしない。読めないときは null を返し、
// 呼び出し側(参加画面・復元導線)に判断を委ねる。
const toSession = (value: unknown): Session | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 3) return null;
  if (
    !isNonEmptyText(record.token) ||
    !isNonEmptyText(record.userId) ||
    !isNonEmptyText(record.name)
  )
    return null;
  return { token: record.token, userId: record.userId, name: record.name };
};

export function readSession(): Session | null {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    return toSession(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function writeSession(session: Session | null): void {
  try {
    if (session === null) window.localStorage.removeItem(SESSION_KEY);
    else window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // 保存できない環境(容量超過・プライベートモード)でもアプリは止めない。
    // 既存の値も変更しない。
  }
}

const eraseHash = (): void => {
  try {
    window.history.replaceState(
      null,
      "",
      window.location.pathname + window.location.search,
    );
  } catch {
    // 履歴 API が使えない環境では URL にトークンが残るが、動作は継続する。
  }
};

export function tokenFromHash(): string | null {
  const { hash } = window.location;
  if (!hash.startsWith(HASH_PREFIX)) return null;
  const raw = hash.slice(HASH_PREFIX.length);
  // トークンが URL に残らないよう、値の解釈より先に履歴から消す。
  eraseHash();
  if (!raw.trim()) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

export function resolveSession(): {
  token: string | null;
  session: Session | null;
} {
  const session = readSession();
  // 招待リンクで開いた場合はリンクのトークンを優先する(参加画面で確定)。
  const hashToken = tokenFromHash();
  return { token: hashToken ?? session?.token ?? null, session };
}

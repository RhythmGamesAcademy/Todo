import type { SubtaskDraft, SubtaskPatch, TodoDraft } from "../model";
import { parseCloudState } from "./parse";
import { readSession } from "./session";
import type { Session } from "./session";
import type { CloudState, TodoPatch } from "./types";

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

const encodeToken = (token: string) => encodeURIComponent(token);

const listPath = (token: string) => "/api/lists/" + encodeToken(token);

// API v1 は呼び出し元を認証しないため、現在のセッションの userId を本文に添える。
// 別リストのセッションを誤って送らないよう、トークンが一致するときだけ付ける。
const withCaller = (
  token: string,
  body: Record<string, unknown>,
): Record<string, unknown> => {
  const session = readSession();
  return session && session.token === token
    ? { ...body, userId: session.userId }
    : body;
};

const jsonInit = (
  method: string,
  body: Record<string, unknown>,
): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const errorFrom = async (response: Response): Promise<ApiError> => {
  let message = "Request failed with status " + response.status;
  try {
    const text = await response.text();
    if (text.trim()) {
      const body: unknown = JSON.parse(text);
      if (
        typeof body === "object" &&
        body !== null &&
        typeof (body as { error?: unknown }).error === "string"
      )
        message = (body as { error: string }).error;
    }
  } catch {
    // 本文が JSON でなくても、ステータスだけで ApiError を作る。
  }
  return new ApiError(response.status, message);
};

const apiFetch = async <T>(
  path: string,
  init?: RequestInit,
): Promise<T | undefined> => {
  const response = await fetch(path, init);
  if (!response.ok) throw await errorFrom(response);
  const text = await response.text();
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text) as T;
  } catch {
    // 壊れた JSON は undefined として返し、呼び出し側の検証に委ねる。
    return undefined;
  }
};

export async function createList(
  title: string,
  name: string,
): Promise<{ token: string }> {
  const data = await apiFetch<{ token: string }>(
    "/api/lists",
    jsonInit("POST", { title, name }),
  );
  if (!data) throw new ApiError(500, "invalid create response");
  return { token: data.token };
}

export async function join(token: string, name: string): Promise<Session> {
  const data = await apiFetch<{ userId: string; name: string }>(
    listPath(token) + "/join",
    jsonInit("POST", { name }),
  );
  if (!data) throw new ApiError(500, "invalid join response");
  return { token, userId: data.userId, name: data.name };
}

export async function fetchState(
  token: string,
  userId?: string | null,
): Promise<CloudState> {
  // userId が有効なメンバーのときだけ、その人宛の通知を同梱してもらう。
  const query = userId ? "?userId=" + encodeURIComponent(userId) : "";
  const data = await apiFetch<unknown>(listPath(token) + query);
  return parseCloudState(data);
}

export async function fetchRevision(token: string): Promise<number> {
  const data = await apiFetch<{ revision: number }>(
    listPath(token) + "/revision",
  );
  return data?.revision ?? Number.NaN;
}

export async function createTodo(
  token: string,
  draft: TodoDraft & { assigneeId: string | null },
): Promise<{ id: string }> {
  const data = await apiFetch<{ id: string }>(
    listPath(token) + "/todos",
    jsonInit("POST", withCaller(token, { ...draft })),
  );
  if (!data) throw new ApiError(500, "invalid create response");
  return { id: data.id };
}

export async function patchTodo(
  token: string,
  id: string,
  patch: TodoPatch,
): Promise<{ revision: number }> {
  const data = await apiFetch<{ revision: number }>(
    listPath(token) + "/todos/" + encodeURIComponent(id),
    jsonInit(
      "PATCH",
      withCaller(token, { ...patch } as Record<string, unknown>),
    ),
  );
  return { revision: data?.revision ?? Number.NaN };
}

export async function deleteTodo(token: string, id: string): Promise<void> {
  await apiFetch<void>(
    listPath(token) + "/todos/" + encodeURIComponent(id),
    jsonInit("DELETE", withCaller(token, {})),
  );
}

export async function restoreTodo(token: string, id: string): Promise<void> {
  await apiFetch<void>(
    listPath(token) + "/todos/" + encodeURIComponent(id) + "/restore",
    jsonInit("POST", withCaller(token, {})),
  );
}

export async function sendMemo(
  token: string,
  todoId: string,
  body: string,
): Promise<void> {
  await apiFetch<void>(
    listPath(token) + "/todos/" + encodeURIComponent(todoId) + "/memos",
    jsonInit("POST", withCaller(token, { body })),
  );
}

export async function createSubtask(
  token: string,
  todoId: string,
  draft: SubtaskDraft,
): Promise<{ id: string }> {
  const data = await apiFetch<{ id: string }>(
    listPath(token) + "/todos/" + encodeURIComponent(todoId) + "/subtasks",
    jsonInit(
      "POST",
      withCaller(token, { ...draft } as Record<string, unknown>),
    ),
  );
  if (!data) throw new ApiError(500, "invalid create response");
  return { id: data.id };
}

export async function patchSubtask(
  token: string,
  todoId: string,
  subtaskId: string,
  patch: SubtaskPatch,
): Promise<{ revision: number }> {
  const data = await apiFetch<{ revision: number }>(
    listPath(token) +
      "/todos/" +
      encodeURIComponent(todoId) +
      "/subtasks/" +
      encodeURIComponent(subtaskId),
    jsonInit(
      "PATCH",
      withCaller(token, { ...patch } as Record<string, unknown>),
    ),
  );
  return { revision: data?.revision ?? Number.NaN };
}

export async function deleteSubtask(
  token: string,
  todoId: string,
  subtaskId: string,
): Promise<void> {
  await apiFetch<void>(
    listPath(token) +
      "/todos/" +
      encodeURIComponent(todoId) +
      "/subtasks/" +
      encodeURIComponent(subtaskId),
    jsonInit("DELETE", withCaller(token, {})),
  );
}

export async function sendSubtaskMemo(
  token: string,
  todoId: string,
  subtaskId: string,
  body: string,
): Promise<void> {
  await apiFetch<void>(
    listPath(token) +
      "/todos/" +
      encodeURIComponent(todoId) +
      "/subtasks/" +
      encodeURIComponent(subtaskId) +
      "/memos",
    jsonInit("POST", withCaller(token, { body })),
  );
}

export const addSubtaskMemo = sendSubtaskMemo;

/** 申請タグ付きTODOを承認する。申請タグが付いていないTODOでは400になる。 */
export async function approveTodo(token: string, id: string): Promise<void> {
  await apiFetch<void>(
    listPath(token) + "/todos/" + encodeURIComponent(id) + "/approve",
    jsonInit("POST", withCaller(token, {})),
  );
}

/** 申請タグ付きTODOを否認する。理由が空のまま送らない(400になる)。 */
export async function rejectTodo(
  token: string,
  id: string,
  reason: string,
): Promise<void> {
  await apiFetch<void>(
    listPath(token) + "/todos/" + encodeURIComponent(id) + "/reject",
    jsonInit("POST", withCaller(token, { reason })),
  );
}

/** 通知パネルを開いた時点で全既読にする(バッジを0に寄せる)。 */
export async function markNotificationsRead(token: string): Promise<void> {
  await apiFetch<void>(
    listPath(token) + "/notifications/read",
    jsonInit("POST", withCaller(token, {})),
  );
}

export async function renameList(token: string, title: string): Promise<void> {
  await apiFetch<void>(
    listPath(token),
    jsonInit("PATCH", withCaller(token, { title })),
  );
}

export async function deleteList(token: string): Promise<void> {
  await apiFetch<void>(
    listPath(token),
    jsonInit("DELETE", withCaller(token, {})),
  );
}

export async function renameUser(
  token: string,
  id: string,
  name: string,
): Promise<void> {
  await apiFetch<void>(
    listPath(token) + "/users/" + encodeURIComponent(id),
    jsonInit("PATCH", withCaller(token, { name })),
  );
}

export async function removeUser(token: string, id: string): Promise<void> {
  await apiFetch<void>(
    listPath(token) + "/users/" + encodeURIComponent(id),
    jsonInit("DELETE", withCaller(token, {})),
  );
}

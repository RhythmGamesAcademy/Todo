// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { messages } from "../messages";
import {
  ApiError,
  createList,
  createTodo,
  deleteTodo,
  fetchRevision,
  fetchState,
  join,
  patchTodo,
  renameList,
  sendMemo,
} from "./client";
import { writeSession } from "./session";
import type { CloudState } from "./types";

const NOW = "2026-10-19T09:00:00.000Z";

const validState = (): CloudState => ({
  list: { id: "list-1", title: "チームTODO", revision: 3 },
  users: [
    { id: "user-1", name: "あき", createdAt: NOW },
    { id: "user-2", name: "はる", createdAt: NOW },
  ],
  todos: [
    {
      id: "todo-1",
      title: "設計を確認",
      description: "仕様書を読む",
      deadline: "2026-10-20T18:00:00+09:00",
      priority: "high",
      status: "doing",
      assigneeId: "user-1",
      createdAt: NOW,
      updatedAt: NOW,
      notes: [
        {
          id: "note-1",
          text: "たたき台を共有",
          createdAt: NOW,
          userId: "user-1",
        },
      ],
    },
  ],
  activities: [
    {
      id: "activity-1",
      todoId: "todo-1",
      userId: "user-1",
      kind: "todo.created",
      field: null,
      before: null,
      after: "設計を確認",
      createdAt: NOW,
    },
  ],
});

type Reply = { status?: number; body?: unknown; text?: string };

const respond = (reply: Reply): Response => {
  const status = reply.status ?? 200;
  const text =
    reply.text ?? (reply.body === undefined ? "" : JSON.stringify(reply.body));
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    json: async () => JSON.parse(text),
  } as Response;
};

type Handler = (url: string, init?: RequestInit) => Reply;

const stubFetch = (handler: Handler | Reply = { body: validState() }) => {
  const mock = vi.fn(async (url: string, init?: RequestInit) =>
    respond(typeof handler === "function" ? handler(url, init) : handler),
  );
  vi.stubGlobal("fetch", mock);
  return mock;
};

const bodyOf = (mock: ReturnType<typeof stubFetch>, index = 0) =>
  JSON.parse(String(mock.mock.calls[index][1]?.body));

const session = { token: "tok-1", userId: "user-1", name: "あき" };

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fetchState", () => {
  it("応答を parseCloudState に通して返す", async () => {
    const fixture = validState();
    stubFetch({ body: fixture });

    await expect(fetchState("tok-1")).resolves.toEqual(fixture);
  });

  it("JSON でない応答は invalidState のエラーになる", async () => {
    stubFetch({ text: "<html>not json</html>" });

    await expect(fetchState("tok-1")).rejects.toThrow(
      messages.errors.invalidState,
    );
  });

  it("形の違う応答も invalidState のエラーになる", async () => {
    stubFetch({ body: { list: { id: "list-1" } } });

    await expect(fetchState("tok-1")).rejects.toThrow(
      messages.errors.invalidState,
    );
  });
});

describe("fetchRevision", () => {
  it("revision を数値で返す", async () => {
    stubFetch({ body: { revision: 7 } });

    await expect(fetchRevision("tok-1")).resolves.toBe(7);
  });
});

describe("API エラー", () => {
  it("404 は status 付きの ApiError になる", async () => {
    stubFetch({ status: 404, body: { error: "not found" } });

    const error = await fetchState("tok-1").catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toBeInstanceOf(Error);
    expect((error as ApiError).status).toBe(404);
    expect((error as ApiError).message).toBe("not found");
  });

  it("本文がないエラーでも status を保つ", async () => {
    stubFetch({ status: 500, text: "" });

    const error = await fetchRevision("tok-1").catch(
      (reason: unknown) => reason,
    );

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(500);
    expect((error as ApiError).message).toContain("500");
  });
});

describe("URL", () => {
  it("トークンをパスに含め、エンコードする", async () => {
    const mock = stubFetch();

    await fetchState("tok/1 2");

    expect(mock.mock.calls[0][0]).toBe("/api/lists/tok%2F1%202");
  });
});

describe("リストの作成と参加", () => {
  it("createList は title と name を送り token を返す", async () => {
    const mock = stubFetch({ status: 201, body: { token: "tok-new" } });

    await expect(createList("チーム", "あき")).resolves.toEqual({
      token: "tok-new",
    });
    expect(mock.mock.calls[0][0]).toBe("/api/lists");
    expect(mock.mock.calls[0][1]?.method).toBe("POST");
    expect(bodyOf(mock)).toEqual({ title: "チーム", name: "あき" });
  });

  it("join は userId と name を Session にまとめる", async () => {
    const mock = stubFetch({ body: { userId: "user-9", name: "はる" } });

    await expect(join("tok-invite", "はる")).resolves.toEqual({
      token: "tok-invite",
      userId: "user-9",
      name: "はる",
    });
    expect(mock.mock.calls[0][0]).toBe("/api/lists/tok-invite/join");
    expect(bodyOf(mock)).toEqual({ name: "はる" });
  });
});

describe("呼び出し元の userId", () => {
  it("同じトークンのセッションがあれば変更系の本文に userId を添える", async () => {
    writeSession(session);
    const mock = stubFetch({ body: { revision: 4 } });

    await patchTodo("tok-1", "todo-1", { status: "done" });

    expect(bodyOf(mock)).toEqual({ status: "done", userId: "user-1" });
    expect(mock.mock.calls[0][0]).toBe("/api/lists/tok-1/todos/todo-1");
    expect(mock.mock.calls[0][1]?.method).toBe("PATCH");
  });

  it("createTodo・sendMemo・deleteTodo・renameList も userId を添える", async () => {
    writeSession(session);

    const createMock = stubFetch({ status: 201, body: { id: "todo-9" } });
    await createTodo("tok-1", {
      title: "新規",
      description: "",
      deadline: null,
      priority: "medium",
      status: "todo",
      assigneeId: null,
    });
    expect(bodyOf(createMock)).toEqual({
      title: "新規",
      description: "",
      deadline: null,
      priority: "medium",
      status: "todo",
      assigneeId: null,
      userId: "user-1",
    });
    vi.unstubAllGlobals();

    const memoMock = stubFetch({ status: 201, body: { id: "memo-1" } });
    await sendMemo("tok-1", "todo-1", "確認しました");
    expect(bodyOf(memoMock)).toEqual({
      body: "確認しました",
      userId: "user-1",
    });
    vi.unstubAllGlobals();

    const deleteMock = stubFetch({ body: { revision: 5 } });
    await deleteTodo("tok-1", "todo-1");
    expect(deleteMock.mock.calls[0][1]?.method).toBe("DELETE");
    expect(bodyOf(deleteMock)).toEqual({ userId: "user-1" });
    vi.unstubAllGlobals();

    const renameMock = stubFetch({ body: { revision: 6 } });
    await renameList("tok-1", "新しい名前");
    expect(bodyOf(renameMock)).toEqual({
      title: "新しい名前",
      userId: "user-1",
    });
  });

  it("別リストのセッションなら userId を送らない", async () => {
    writeSession({ token: "tok-other", userId: "user-1", name: "あき" });
    const mock = stubFetch({ body: { revision: 4 } });

    await patchTodo("tok-1", "todo-1", { status: "done" });

    expect(bodyOf(mock)).toEqual({ status: "done" });
  });

  it("セッションがなければ userId を送らない", async () => {
    const mock = stubFetch({ body: { revision: 4 } });

    await patchTodo("tok-1", "todo-1", { status: "done" });

    expect(bodyOf(mock)).toEqual({ status: "done" });
  });
});

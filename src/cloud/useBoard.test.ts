// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./client";
import { writeSession } from "./session";
import type { Session } from "./session";
import type { CloudState } from "./types";
import { POLL_INTERVAL_MS, useBoard } from "./useBoard";

const NOW = "2026-10-19T09:00:00.000Z";

const me: Session = { token: "tok-1", userId: "user-1", name: "あき" };

const makeState = (revision: number): CloudState => ({
  list: { id: "list-1", title: "チームTODO", revision },
  users: [
    { id: "user-1", name: "あき", createdAt: NOW },
    { id: "user-2", name: "はる", createdAt: NOW },
  ],
  todos: [
    {
      id: "todo-1",
      title: "設計を確認",
      description: "仕様書を読む",
      deadline: null,
      priority: "high",
      status: "doing",
      assigneeIds: ["user-1"],
      tags: [],
      approvalStatus: null,
      approvalReason: null,
      createdAt: NOW,
      updatedAt: NOW,
      subtasks: [],
      notes: [],
      attachments: [],
    },
  ],
  activities: [],
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

const installFetch = (handler: Handler) => {
  const mock = vi.fn(async (url: string, init?: RequestInit) =>
    respond(handler(url, init)),
  );
  vi.stubGlobal("fetch", mock);
  return mock;
};

const stateFetches = (mock: ReturnType<typeof installFetch>) =>
  mock.mock.calls.filter(
    ([url, init]) =>
      !String(url).endsWith("/revision") && (init?.method ?? "GET") === "GET",
  ).length;

const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
  });
};

const advance = async (milliseconds: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
  await flush();
};

const renderBoard = (session: Session | null = me) => {
  const lost = vi.fn();
  const view = renderHook(() => useBoard(session, lost));
  return { ...view, lost };
};

beforeEach(() => {
  window.localStorage.clear();
  writeSession(me);
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("メモの楽観反映", () => {
  /** サブタスクを持つ state。サブタスクメモのテストに使う。 */
  const stateWithSubtask = (): CloudState => {
    const base = makeState(3);
    return {
      ...base,
      todos: base.todos.map((todo) => ({
        ...todo,
        subtasks: [
          {
            id: "subtask-1",
            title: "資料を確認",
            status: "todo" as const,
            priority: "low" as const,
            deadline: null,
            createdAt: NOW,
            updatedAt: NOW,
            memos: [],
          },
        ],
      })),
    };
  };

  it("addMemo は state を取り直さず、送信直後にメモを表示へ載せる", async () => {
    const fixture = makeState(3);
    const mock = installFetch((url, init) => {
      const method = init?.method ?? "GET";
      if (String(url).endsWith("/revision")) return { body: { revision: 3 } };
      if (method === "POST" && String(url).endsWith("/memos"))
        return { status: 201, body: { id: "memo-1" } };
      return { body: fixture };
    });
    const { result } = renderBoard();
    await flush();
    expect(result.current.phase).toBe("ready");

    await act(async () => {
      await result.current.addMemo("todo-1", "最初のメモ");
    });

    // 全件の state 取り直しは初回の1件だけ。メモは送信直後に画面へ出る。
    expect(stateFetches(mock)).toBe(1);
    expect(result.current.phase).toBe("ready");
    if (result.current.phase !== "ready") throw new Error("not ready");
    expect(result.current.state.todos[0].notes).toHaveLength(1);
    expect(result.current.state.todos[0].notes[0]).toMatchObject({
      id: "memo-1",
      text: "最初のメモ",
      userId: me.userId,
    });
  });

  it("addMemo が失敗したらメモを載せない", async () => {
    const fixture = makeState(3);
    installFetch((url, init) => {
      const method = init?.method ?? "GET";
      if (String(url).endsWith("/revision")) return { body: { revision: 3 } };
      if (method === "POST" && String(url).endsWith("/memos"))
        throw new TypeError("network down");
      return { body: fixture };
    });
    const { result } = renderBoard();
    await flush();
    expect(result.current.phase).toBe("ready");

    await act(async () => {
      await expect(
        result.current.addMemo("todo-1", "届かないメモ"),
      ).rejects.toThrow("network down");
    });

    expect(result.current.phase).toBe("ready");
    if (result.current.phase !== "ready") throw new Error("not ready");
    expect(result.current.state.todos[0].notes).toHaveLength(0);
  });

  it("addSubtaskMemo も送信直後にサブタスクへ載せる", async () => {
    const fixture = stateWithSubtask();
    installFetch((url, init) => {
      const method = init?.method ?? "GET";
      if (String(url).endsWith("/revision")) return { body: { revision: 3 } };
      if (method === "POST" && String(url).endsWith("/memos"))
        return { status: 201, body: { id: "memo-2" } };
      return { body: fixture };
    });
    const { result } = renderBoard();
    await flush();
    expect(result.current.phase).toBe("ready");

    await act(async () => {
      await result.current.addSubtaskMemo("todo-1", "subtask-1", "追記");
    });

    if (result.current.phase !== "ready") throw new Error("not ready");
    const subtask = result.current.state.todos[0].subtasks[0];
    expect(subtask.memos).toHaveLength(1);
    expect(subtask.memos[0]).toMatchObject({ id: "memo-2", text: "追記" });
  });
});

describe("useBoard の初期化", () => {
  it("読み込み後に ready になり、全データと自分を保持する", async () => {
    const fixture = makeState(3);
    installFetch((url) =>
      String(url).endsWith("/revision")
        ? { body: { revision: 3 } }
        : { body: fixture },
    );
    const { result, lost } = renderBoard();

    expect(result.current.phase).toBe("loading");
    await flush();

    expect(result.current.phase).toBe("ready");
    if (result.current.phase !== "ready") throw new Error("not ready");
    expect(result.current.state).toEqual(fixture);
    expect(result.current.state.todos).toHaveLength(1);
    expect(result.current.me).toEqual(me);
    expect(result.current.refresh).toBeTypeOf("function");
    expect(lost).not.toHaveBeenCalled();
  });

  it("セッションがなければ login のまま API を呼ばない", async () => {
    const mock = installFetch(() => ({ body: makeState(1) }));
    const { result } = renderBoard(null);

    await flush();

    expect(result.current.phase).toBe("login");
    expect(mock).not.toHaveBeenCalled();
  });
});

describe("revision ポーリング", () => {
  it("revision が増えたら state を取り直す", async () => {
    let revision = 1;
    let current = makeState(1);
    const mock = installFetch((url) =>
      String(url).endsWith("/revision")
        ? { body: { revision } }
        : { body: current },
    );
    const { result } = renderBoard();
    await flush();
    expect(result.current.phase).toBe("ready");
    expect(stateFetches(mock)).toBe(1);

    revision = 2;
    current = makeState(2);
    await advance(POLL_INTERVAL_MS);

    expect(result.current.phase).toBe("ready");
    if (result.current.phase !== "ready") throw new Error("not ready");
    expect(result.current.state.list.revision).toBe(2);
    expect(stateFetches(mock)).toBe(2);
  });

  it("revision が同じなら state を取り直さない", async () => {
    const mock = installFetch((url) => ({
      body: String(url).endsWith("/revision") ? { revision: 1 } : makeState(1),
    }));
    const { result } = renderBoard();
    await flush();
    expect(result.current.phase).toBe("ready");

    await advance(POLL_INTERVAL_MS * 3);

    expect(stateFetches(mock)).toBe(1);
    expect(
      mock.mock.calls.filter(([url]) => String(url).endsWith("/revision")),
    ).toHaveLength(3);
  });

  it("ポーリング中の 404 でログインへ戻し、onSessionLost を呼ぶ", async () => {
    let gone = false;
    installFetch((url) => {
      if (String(url).endsWith("/revision"))
        return gone
          ? { status: 404, body: { error: "not found" } }
          : { body: { revision: 1 } };
      return { body: makeState(1) };
    });
    const { result, lost } = renderBoard();
    await flush();
    expect(result.current.phase).toBe("ready");

    gone = true;
    await advance(POLL_INTERVAL_MS);

    expect(result.current.phase).toBe("login");
    expect(lost).toHaveBeenCalledTimes(1);
  });
});

describe("セッション切れ", () => {
  it("初回取得の 404 でログインへ戻し、onSessionLost を呼ぶ", async () => {
    const mock = installFetch(() => ({
      status: 404,
      body: { error: "not found" },
    }));
    const { result, lost } = renderBoard();

    await flush();

    expect(result.current.phase).toBe("login");
    expect(lost).toHaveBeenCalledTimes(1);
    expect(stateFetches(mock)).toBe(1);
  });
});

describe("アクション", () => {
  it("addTodo は POST の後に state を取り直し、結果を反映する", async () => {
    let revision = 1;
    let current = makeState(1);
    const bodies: Record<string, unknown>[] = [];
    const mock = installFetch((url, init) => {
      const method = init?.method ?? "GET";
      if (String(url).endsWith("/revision")) return { body: { revision } };
      if (method === "POST" && String(url).endsWith("/todos")) {
        const draft = JSON.parse(String(init?.body));
        bodies.push(draft);
        revision += 1;
        current = {
          ...current,
          list: { ...current.list, revision },
          todos: [
            ...current.todos,
            {
              id: "todo-9",
              title: draft.title,
              description: draft.description,
              deadline: draft.deadline,
              priority: draft.priority,
              status: draft.status,
              assigneeIds: draft.assigneeIds ?? [],
              tags: draft.tags ?? [],
              approvalStatus: null,
              approvalReason: null,
              createdAt: NOW,
              updatedAt: NOW,
              subtasks: [],
              notes: [],
              attachments: [],
            },
          ],
        };
        return { status: 201, body: { id: "todo-9" } };
      }
      return { body: current };
    });
    const { result } = renderBoard();
    await flush();
    expect(result.current.phase).toBe("ready");

    await act(async () => {
      await result.current.addTodo({
        title: "新しいTODO",
        description: "",
        deadline: null,
        priority: "medium",
        status: "todo",
        assigneeIds: [],
        tags: [],
      });
    });

    expect(bodies[0]).toMatchObject({
      title: "新しいTODO",
      userId: me.userId,
    });
    expect(stateFetches(mock)).toBe(2);
    expect(result.current.phase).toBe("ready");
    if (result.current.phase !== "ready") throw new Error("not ready");
    expect(result.current.state.todos.map((todo) => todo.id)).toContain(
      "todo-9",
    );
    expect(result.current.state.list.revision).toBe(2);
  });

  it("アクションが失敗しても ready のまま、呼び出し元へ拒否を返す", async () => {
    let failing = false;
    installFetch((url, init) => {
      const method = init?.method ?? "GET";
      if (method === "PATCH" && failing) throw new TypeError("network down");
      if (String(url).endsWith("/revision")) return { body: { revision: 1 } };
      return { body: makeState(1) };
    });
    const { result, lost } = renderBoard();
    await flush();
    expect(result.current.phase).toBe("ready");

    failing = true;
    await act(async () => {
      await expect(
        result.current.updateTodo("todo-1", { title: "変更" }),
      ).rejects.toThrow("network down");
    });

    expect(result.current.phase).toBe("ready");
    expect(lost).not.toHaveBeenCalled();
  });

  it("アクションの 404 でもセッションを失わず、ApiError を返す", async () => {
    installFetch((url, init) => {
      const method = init?.method ?? "GET";
      if (method === "PATCH")
        return { status: 404, body: { error: "not found" } };
      if (String(url).endsWith("/revision")) return { body: { revision: 1 } };
      return { body: makeState(1) };
    });
    const { result, lost } = renderBoard();
    await flush();
    expect(result.current.phase).toBe("ready");

    let failure: unknown;
    await act(async () => {
      failure = await result.current
        .updateTodo("todo-1", { title: "変更" })
        .catch((error: unknown) => error);
    });

    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(404);
    expect(result.current.phase).toBe("ready");
    expect(lost).not.toHaveBeenCalled();
  });
});

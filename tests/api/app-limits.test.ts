import { describe, expect, it } from "vitest";
import {
  MAX_MEMOS_PER_TODO,
  MAX_SUBTASKS_PER_TODO,
  MAX_SUBTASK_MEMOS_PER_SUBTASK,
  MAX_TODOS_PER_LIST,
  createApp,
} from "../../api/src/app";
import type { ObjectStorage } from "../../api/src/object-storage";
import type { Sql, Transact, TransactGuarded } from "../../api/src/sql";

// DB なしで上限ロジックを検証するためのスタブ。TEST_DATABASE_URL が無い環境
// (CI 含む)でも app.test.ts の DB 結合テストが skip になるため、M-004 の
// 行数上限とレート制限はここでスタブ Sql で検証する。

const LIST_ID = "11111111-1111-1111-1111-111111111111";
const TODO_ID = "22222222-2222-2222-2222-222222222222";
const SUBTASK_ID = "33333333-3333-3333-3333-333333333333";
const TOKEN = "test-token";

const todoRow = (deletedAt: string | null = null) => ({
  id: TODO_ID,
  title: "TODO",
  description: "",
  status: "todo",
  priority: "medium",
  due: null,
  assignee_ids: "{}",
  tags: "{}",
  approval_status: null,
  approval_reason: null,
  approval_by: null,
  approval_at: null,
  created_by: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  deleted_at: deletedAt,
});

const subtaskRow = () => ({
  id: SUBTASK_ID,
  todo_id: TODO_ID,
  title: "サブタスク",
  status: "todo",
  priority: "medium",
  due: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
});

interface RowCounts {
  todos: number;
  subtasks: number;
  memos: number;
  subtaskMemos: number;
}

const makeStubDb = (counts: RowCounts, todoDeleted = false) => {
  const seen: string[] = [];
  const statementText = new WeakMap<object, string>();
  const locks = new Map<string, Promise<void>>();
  const currentCounts = { ...counts };
  const guardedLockKeys: string[] = [];
  const guardedTransactions: string[][] = [];
  const executedGuardedTransactions: string[][] = [];
  const result = (rows: unknown[]) =>
    ({
      rows,
      rowCount: rows.length,
      command: "SELECT",
    }) as never;
  const sql = ((strings: TemplateStringsArray, ..._values: unknown[]) => {
    const text = strings.join("?").replace(/\s+/g, " ");
    seen.push(text);
    const query = Promise.resolve(result([]));
    statementText.set(query, text);
    if (/^\s*(INSERT|UPDATE|DELETE)/.test(text)) return query;
    if (text.includes("FROM public.lists WHERE token"))
      return Promise.resolve(
        result([{ id: LIST_ID, title: "リスト", revision: "1" }]),
      );
    if (text.includes("SELECT revision FROM public.lists WHERE id"))
      return Promise.resolve(result([{ revision: "7" }]));
    if (text.includes("count(*)") && text.includes("FROM public.todos"))
      return Promise.resolve(result([{ count: counts.todos }]));
    if (text.includes("count(*)") && text.includes("FROM public.subtasks"))
      return Promise.resolve(result([{ count: counts.subtasks }]));
    if (text.includes("count(*)") && text.includes("FROM public.memos"))
      return Promise.resolve(result([{ count: counts.memos }]));
    if (text.includes("count(*)") && text.includes("FROM public.subtask_memos"))
      return Promise.resolve(result([{ count: counts.subtaskMemos }]));
    if (text.includes("count(*)") && text.includes("FROM public.attachments"))
      return Promise.resolve(result([{ count: 0 }]));
    if (text.includes("coalesce(sum(a.size_bytes), 0)"))
      return Promise.resolve(result([{ total: 0 }]));
    if (text.includes("FROM public.todos WHERE id"))
      return Promise.resolve(
        result([todoRow(todoDeleted ? "2026-01-02T00:00:00Z" : null)]),
      );
    if (text.includes("FROM public.subtasks WHERE id"))
      return Promise.resolve(result([subtaskRow()]));
    if (text.includes("FROM public.users WHERE list_id"))
      return Promise.resolve(result([]));
    throw new Error(`unexpected query: ${text}`);
  }) as unknown as Sql;
  const transact: Transact = async () => {};
  const transactGuarded: TransactGuarded = async (
    lockKey,
    statements,
    guardedStatementIndex,
  ) => {
    const previous = locks.get(lockKey) ?? Promise.resolve();
    let release = () => {};
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    locks.set(
      lockKey,
      previous.then(() => current),
    );
    await previous;
    try {
      guardedLockKeys.push(lockKey);
      const texts = statements.map(
        (statement) => statementText.get(statement as object) ?? "",
      );
      guardedTransactions.push(texts);
      const statement = texts[guardedStatementIndex];
      if (statement.includes("INSERT INTO public.todos")) {
        if (currentCounts.todos >= MAX_TODOS_PER_LIST) return false;
        currentCounts.todos += 1;
      } else if (
        statement.includes("UPDATE public.todos SET deleted_at = NULL")
      ) {
        if (currentCounts.todos >= MAX_TODOS_PER_LIST) return false;
        currentCounts.todos += 1;
      } else if (statement.includes("INSERT INTO public.subtasks")) {
        if (currentCounts.subtasks >= MAX_SUBTASKS_PER_TODO) return false;
        currentCounts.subtasks += 1;
      } else if (statement.includes("INSERT INTO public.memos")) {
        if (currentCounts.memos >= MAX_MEMOS_PER_TODO) return false;
        currentCounts.memos += 1;
      } else if (statement.includes("INSERT INTO public.subtask_memos")) {
        if (currentCounts.subtaskMemos >= MAX_SUBTASK_MEMOS_PER_SUBTASK)
          return false;
        currentCounts.subtaskMemos += 1;
      } else {
        throw new Error(`unexpected guarded query: ${statement}`);
      }
      executedGuardedTransactions.push(texts);
      return true;
    } finally {
      release();
    }
  };
  return {
    sql,
    transact,
    transactGuarded,
    seen,
    guardedLockKeys,
    guardedTransactions,
    executedGuardedTransactions,
  };
};

const postJson = (
  app: ReturnType<typeof createApp>,
  path: string,
  body: Record<string, unknown>,
) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const makeMultipartMemo = (): FormData => {
  const pngBytes = new ArrayBuffer(8);
  new Uint8Array(pngBytes).set([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  const form = new FormData();
  form.append("body", "添付付きメモ");
  form.append("file", new Blob([pngBytes], { type: "image/png" }), "memo.png");
  return form;
};

const makeObjectStorage = (put: ObjectStorage["put"]): ObjectStorage => ({
  put,
  delete: async () => {},
  signedUrl: async () => "https://example.invalid/signed",
});

const TODO_BODY = {
  title: "タイトル",
  status: "todo",
  priority: "medium",
  assigneeIds: [],
};

describe("行数上限(監査 M-004)", () => {
  it("TODO数が上限に達したリストではTODO作成が400になる", async () => {
    const app = createApp(
      makeStubDb({
        todos: MAX_TODOS_PER_LIST,
        subtasks: 0,
        memos: 0,
        subtaskMemos: 0,
      }),
    );
    const res = await postJson(app, `/api/lists/${TOKEN}/todos`, TODO_BODY);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "todo limit reached",
    });
  });

  it("TODO数が上限未満ならTODO作成は201になる", async () => {
    const app = createApp(
      makeStubDb({
        todos: MAX_TODOS_PER_LIST - 1,
        subtasks: 0,
        memos: 0,
        subtaskMemos: 0,
      }),
    );
    const res = await postJson(app, `/api/lists/${TOKEN}/todos`, TODO_BODY);
    expect(res.status).toBe(201);
  });

  it("上限直前の並行TODO作成でも上限を超えない", async () => {
    const db = makeStubDb({
      todos: MAX_TODOS_PER_LIST - 1,
      subtasks: 0,
      memos: 0,
      subtaskMemos: 0,
    });
    const app = createApp(db);
    const results = await Promise.all([
      postJson(app, `/api/lists/${TOKEN}/todos`, TODO_BODY),
      postJson(app, `/api/lists/${TOKEN}/todos`, TODO_BODY),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 400]);
    expect(db.guardedTransactions).toHaveLength(2);
    expect(db.executedGuardedTransactions).toHaveLength(1);
    expect(db.guardedLockKeys).toEqual([LIST_ID, LIST_ID]);
    expect(db.guardedTransactions[0][0]).toContain("SELECT count(*)");
  });

  it("TODO作成と削除済みTODOの並行復元でもリスト上限を超えない", async () => {
    const db = makeStubDb(
      {
        todos: MAX_TODOS_PER_LIST - 1,
        subtasks: 0,
        memos: 0,
        subtaskMemos: 0,
      },
      true,
    );
    const app = createApp(db);
    const results = await Promise.all([
      postJson(app, `/api/lists/${TOKEN}/todos`, TODO_BODY),
      postJson(app, `/api/lists/${TOKEN}/todos/${TODO_ID}/restore`, {}),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual([201, 400]);
    expect(db.guardedTransactions).toHaveLength(2);
    expect(db.executedGuardedTransactions).toHaveLength(1);
    expect(db.guardedLockKeys).toEqual([LIST_ID, LIST_ID]);
    expect(db.guardedTransactions[0][0]).toContain("SELECT count(*)");
    expect(db.guardedTransactions[1][0]).toContain("SELECT count(*)");
  });

  it("サブタスク数が上限未満ならサブタスク作成は201になる", async () => {
    const app = createApp(
      makeStubDb({
        todos: 0,
        subtasks: MAX_SUBTASKS_PER_TODO - 1,
        memos: 0,
        subtaskMemos: 0,
      }),
    );
    const res = await postJson(
      app,
      `/api/lists/${TOKEN}/todos/${TODO_ID}/subtasks`,
      { title: "サブタスク", status: "todo", priority: "medium" },
    );
    expect(res.status).toBe(201);
  });

  it("サブタスク数が上限に達したTODOではサブタスク作成が400になる", async () => {
    const app = createApp(
      makeStubDb({
        todos: 0,
        subtasks: MAX_SUBTASKS_PER_TODO,
        memos: 0,
        subtaskMemos: 0,
      }),
    );
    const res = await postJson(
      app,
      `/api/lists/${TOKEN}/todos/${TODO_ID}/subtasks`,
      { title: "サブタスク", status: "todo", priority: "medium" },
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "subtask limit reached",
    });
  });

  it("TODOメモ数が上限未満ならメモ作成は201になる", async () => {
    const app = createApp(
      makeStubDb({
        todos: 0,
        subtasks: 0,
        memos: MAX_MEMOS_PER_TODO - 1,
        subtaskMemos: 0,
      }),
    );
    const res = await postJson(
      app,
      `/api/lists/${TOKEN}/todos/${TODO_ID}/memos`,
      { body: "メモ" },
    );
    expect(res.status).toBe(201);
  });

  it("削除済みTODOは有効TODO数が上限なら復元できない", async () => {
    const app = createApp(
      makeStubDb(
        {
          todos: MAX_TODOS_PER_LIST,
          subtasks: 0,
          memos: 0,
          subtaskMemos: 0,
        },
        true,
      ),
    );
    const res = await postJson(
      app,
      `/api/lists/${TOKEN}/todos/${TODO_ID}/restore`,
      {},
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "todo limit reached",
    });
  });

  it("削除済みTODOは有効TODO数に余裕があれば復元できる", async () => {
    const app = createApp(
      makeStubDb(
        {
          todos: MAX_TODOS_PER_LIST - 1,
          subtasks: 0,
          memos: 0,
          subtaskMemos: 0,
        },
        true,
      ),
    );
    const res = await postJson(
      app,
      `/api/lists/${TOKEN}/todos/${TODO_ID}/restore`,
      {},
    );
    expect(res.status).toBe(200);
  });

  it("TODOメモ数が上限に達したTODOではメモ作成が400になる", async () => {
    const app = createApp(
      makeStubDb({
        todos: 0,
        subtasks: 0,
        memos: MAX_MEMOS_PER_TODO,
        subtaskMemos: 0,
      }),
    );
    const res = await postJson(
      app,
      `/api/lists/${TOKEN}/todos/${TODO_ID}/memos`,
      {
        body: "メモ",
      },
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "memo limit reached",
    });
  });

  it("サブタスクメモ数が上限未満ならサブタスクメモ作成は201になる", async () => {
    const app = createApp(
      makeStubDb({
        todos: 0,
        subtasks: 0,
        memos: 0,
        subtaskMemos: MAX_SUBTASK_MEMOS_PER_SUBTASK - 1,
      }),
    );
    const res = await postJson(
      app,
      `/api/lists/${TOKEN}/todos/${TODO_ID}/subtasks/${SUBTASK_ID}/memos`,
      { body: "メモ" },
    );
    expect(res.status).toBe(201);
  });

  it("サブタスクメモ数が上限に達するとサブタスクメモ作成が400になる", async () => {
    const app = createApp(
      makeStubDb({
        todos: 0,
        subtasks: 0,
        memos: 0,
        subtaskMemos: MAX_SUBTASK_MEMOS_PER_SUBTASK,
      }),
    );
    const res = await postJson(
      app,
      `/api/lists/${TOKEN}/todos/${TODO_ID}/subtasks/${SUBTASK_ID}/memos`,
      { body: "メモ" },
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "subtask memo limit reached",
    });
  });

  it("添付付きメモはメモ数上限到達時に拒否されストレージへ保存しない", async () => {
    let putCalls = 0;
    const db = makeStubDb({
      todos: 0,
      subtasks: 0,
      memos: MAX_MEMOS_PER_TODO,
      subtaskMemos: 0,
    });
    const app = createApp({
      ...db,
      objectStorage: makeObjectStorage(async () => {
        putCalls += 1;
      }),
    });
    const res = await app.request(
      `/api/lists/${TOKEN}/todos/${TODO_ID}/memos/with-attachment`,
      { method: "POST", body: makeMultipartMemo() },
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "memo limit reached",
    });
    expect(putCalls).toBe(0);
  });

  it("添付付きメモは上限未満なら201になりストレージへ1回保存する", async () => {
    const uploadedContentTypes: string[] = [];
    const db = makeStubDb({
      todos: 0,
      subtasks: 0,
      memos: MAX_MEMOS_PER_TODO - 1,
      subtaskMemos: 0,
    });
    const app = createApp({
      ...db,
      objectStorage: makeObjectStorage(async ({ contentType }) => {
        uploadedContentTypes.push(contentType);
      }),
    });
    const res = await app.request(
      `/api/lists/${TOKEN}/todos/${TODO_ID}/memos/with-attachment`,
      { method: "POST", body: makeMultipartMemo() },
    );
    expect(res.status).toBe(201);
    expect(uploadedContentTypes).toEqual(["image/png"]);
  });
});

describe("行作成のレート制限(監査 M-004)", () => {
  it("TODO作成は同一トークンで短時間に上限回を超えると429になる", async () => {
    const app = createApp(
      makeStubDb({ todos: 0, subtasks: 0, memos: 0, subtaskMemos: 0 }),
    );
    let created = 0;
    let lastStatus = 0;
    for (let i = 0; i < 121; i += 1) {
      const res = await postJson(app, `/api/lists/${TOKEN}/todos`, TODO_BODY);
      lastStatus = res.status;
      if (res.status === 201) created += 1;
      else break;
    }
    expect(created).toBe(120);
    expect(lastStatus).toBe(429);
  });
});

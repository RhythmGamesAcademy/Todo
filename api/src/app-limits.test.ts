import { describe, expect, it } from "vitest";
import {
  MAX_MEMOS_PER_TODO,
  MAX_SUBTASKS_PER_TODO,
  MAX_SUBTASK_MEMOS_PER_SUBTASK,
  MAX_TODOS_PER_LIST,
  createApp,
} from "./app";
import type { Sql, Transact } from "./sql";

// DB なしで上限ロジックを検証するためのスタブ。TEST_DATABASE_URL が無い環境
// (CI 含む)でも app.test.ts の DB 結合テストが skip になるため、M-004 の
// 行数上限とレート制限はここでスタブ Sql で検証する。

const LIST_ID = "11111111-1111-1111-1111-111111111111";
const TODO_ID = "22222222-2222-2222-2222-222222222222";
const SUBTASK_ID = "33333333-3333-3333-3333-333333333333";
const TOKEN = "test-token";

const todoRow = () => ({
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
  deleted_at: null,
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

const makeStubDb = (counts: RowCounts) => {
  const seen: string[] = [];
  const result = (rows: unknown[]) =>
    ({
      rows,
      rowCount: rows.length,
      command: "SELECT",
    }) as never;
  const sql = ((strings: TemplateStringsArray, ..._values: unknown[]) => {
    const text = strings.join("?").replace(/\s+/g, " ");
    seen.push(text);
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
    if (text.includes("FROM public.todos WHERE id"))
      return Promise.resolve(result([todoRow()]));
    if (text.includes("FROM public.subtasks WHERE id"))
      return Promise.resolve(result([subtaskRow()]));
    if (text.includes("FROM public.users WHERE list_id"))
      return Promise.resolve(result([]));
    // INSERT/UPDATE/DELETE は transact 経由で実行される SqlCall 生成時の
    // 呼び出し。内容は検証対象外なので成功として扱う。
    if (/^\s*(INSERT|UPDATE|DELETE)/.test(text))
      return Promise.resolve(result([]));
    throw new Error(`unexpected query: ${text}`);
  }) as unknown as Sql;
  const transact: Transact = async () => {};
  return { sql, transact, seen };
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

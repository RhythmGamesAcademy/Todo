import { describe, expect, it } from "vitest";
import { messages } from "../messages";
import { parseCloudState } from "./parse";
import type { CloudState } from "./types";

const now = "2026-10-19T09:00:00.000Z";

const validState = (): CloudState => ({
  list: { id: "list-1", title: "チームTODO", revision: 3 },
  users: [
    { id: "user-1", name: "あき", createdAt: now },
    { id: "user-2", name: "はる", createdAt: now },
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
      createdAt: now,
      updatedAt: now,
      notes: [
        { id: "note-1", text: "たたき台を共有", createdAt: now },
        { id: "note-2", text: "修正済み", createdAt: now, editedAt: now },
      ],
    },
    {
      id: "todo-2",
      title: "買い物",
      description: "",
      deadline: null,
      priority: "low",
      status: "todo",
      assigneeId: null,
      createdAt: now,
      updatedAt: now,
      notes: [],
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
      createdAt: now,
    },
    {
      id: "activity-2",
      todoId: null,
      userId: null,
      kind: "list.renamed",
      field: "name",
      before: "旧名",
      after: "チームTODO",
      createdAt: now,
    },
  ],
});

const broken = (change: (state: any) => void): unknown => {
  const state = validState();
  change(state);
  return state;
};

const reject = (input: unknown) =>
  expect(() => parseCloudState(input)).toThrow(messages.errors.invalidState);

describe("parseCloudState", () => {
  it("正しい共有データをそのまま返す", () => {
    const state = validState();
    expect(parseCloudState(state)).toEqual(state);
  });

  it("空の一覧を受け付ける", () => {
    const state = { ...validState(), users: [], todos: [], activities: [] };
    expect(parseCloudState(state)).toEqual(state);
  });

  it("オブジェクト以外は拒否する", () => {
    reject(null);
    reject([]);
    reject("{}");
    reject(undefined);
  });

  it("revision が数値でなければ拒否する", () => {
    reject(broken((s) => (s.list.revision = "3")));
    reject(broken((s) => (s.list.revision = null)));
    reject(broken((s) => delete s.list.revision));
    reject(broken((s) => (s.list.revision = 1.5)));
    reject(broken((s) => (s.list.revision = -1)));
  });

  it("users が配列でなければ拒否する", () => {
    reject(broken((s) => (s.users = {})));
    reject(broken((s) => (s.users = null)));
  });

  it("todos・activities・list の型を検証する", () => {
    reject(broken((s) => (s.todos = {})));
    reject(broken((s) => (s.activities = {})));
    reject(broken((s) => (s.list = [])));
  });

  it("TODO に assigneeId がなければ拒否する", () => {
    reject(broken((s) => delete s.todos[0].assigneeId));
    reject(broken((s) => (s.todos[0].assigneeId = 1)));
  });

  it("status が todo|doing|done 以外なら拒否する", () => {
    reject(broken((s) => (s.todos[0].status = "blocked")));
    reject(broken((s) => delete s.todos[0].status));
  });

  it("priority が high|medium|low 以外なら拒否する", () => {
    reject(broken((s) => (s.todos[0].priority = "urgent")));
  });

  it("activity の kind が既定の種類以外なら拒否する", () => {
    reject(broken((s) => (s.activities[0].kind = "todo.archived")));
    reject(broken((s) => delete s.activities[0].kind));
  });

  it("deadline が ISO 文字列ではなく数値なら拒否する", () => {
    reject(broken((s) => (s.todos[0].deadline = Date.parse(now))));
    reject(broken((s) => (s.todos[0].deadline = "not-a-date")));
    reject(broken((s) => delete s.todos[0].deadline));
  });

  it("日時は完全な ISO 8601 文字列でなければ拒否する", () => {
    reject(broken((s) => (s.users[0].createdAt = 0)));
    reject(broken((s) => (s.todos[0].createdAt = "yesterday")));
    reject(broken((s) => (s.todos[0].updatedAt = null)));
    reject(broken((s) => (s.todos[0].notes[0].createdAt = {})));
    reject(broken((s) => (s.todos[0].notes[1].editedAt = false)));
    reject(broken((s) => (s.activities[0].createdAt = undefined)));
    reject(broken((s) => (s.users[0].createdAt = "2026/10/19")));
    reject(broken((s) => (s.users[0].createdAt = "Oct 19 2026")));
    reject(broken((s) => (s.todos[0].createdAt = "2026-10-19")));
    reject(broken((s) => (s.todos[0].deadline = "2026-10-20")));
    reject(broken((s) => (s.todos[0].updatedAt = "2026-10-19T09:00:00")));
    reject(broken((s) => (s.todos[0].createdAt = "2026-02-30T00:00:00Z")));
    reject(broken((s) => (s.todos[0].createdAt = "2026-02-29T00:00:00Z")));
    reject(broken((s) => (s.todos[0].createdAt = "2026-13-01T00:00:00Z")));
    reject(broken((s) => (s.todos[0].createdAt = "2026-10-19T24:00:00Z")));
    reject(broken((s) => (s.todos[0].createdAt = "2026-10-19T09:60:00Z")));
  });

  it("ISO 8601 のタイムゾーン・秒・小数秒の表記を受け付ける", () => {
    const accept = (change: (state: any) => void) =>
      expect(() => parseCloudState(broken(change))).not.toThrow();
    accept((s) => (s.todos[0].deadline = "2026-10-20T18:00:00+0900"));
    accept((s) => (s.todos[0].createdAt = "2026-10-19T09:00Z"));
    accept((s) => (s.todos[0].updatedAt = "2026-10-19T09:00:00.123456Z"));
    accept((s) => (s.todos[0].notes[0].createdAt = "2026-10-19T09:00:00.1Z"));
    accept((s) => (s.todos[0].notes[1].editedAt = "2026-10-19T09:00:00-05:00"));
    accept((s) => (s.users[0].createdAt = "2028-02-29T00:00:00Z"));
    accept((s) => (s.activities[0].createdAt = "2026-10-19T09:00:00+09:00"));
  });

  it("TODO の必須項目と長さを検証する", () => {
    reject(broken((s) => (s.todos[0].title = "")));
    reject(broken((s) => (s.todos[0].title = "あ".repeat(121))));
    reject(broken((s) => (s.todos[0].description = null)));
    reject(broken((s) => (s.todos[0].description = "あ".repeat(2001))));
    reject(broken((s) => delete s.todos[0].notes));
  });

  it("メモの必須項目と長さを検証する", () => {
    reject(broken((s) => (s.todos[0].notes[0].text = "")));
    reject(broken((s) => (s.todos[0].notes[0].text = "あ".repeat(2001))));
    reject(broken((s) => delete s.todos[0].notes[0].id));
  });

  it("一覧とユーザーの必須項目を検証する", () => {
    reject(broken((s) => (s.list.title = "")));
    reject(broken((s) => (s.list.title = "あ".repeat(121))));
    reject(broken((s) => delete s.list.id));
    reject(broken((s) => (s.users[0].name = "")));
    reject(broken((s) => (s.users[0].name = "あ".repeat(121))));
  });

  it("activity の表示項目の型を検証する", () => {
    reject(broken((s) => (s.activities[0].before = 1)));
    reject(broken((s) => (s.activities[0].after = [])));
    reject(broken((s) => (s.activities[0].field = 2)));
    reject(broken((s) => (s.activities[0].todoId = 3)));
    reject(broken((s) => (s.activities[0].userId = true)));
    reject(broken((s) => delete s.activities[0].field));
  });

  it("ID の重複を拒否する", () => {
    reject(broken((s) => (s.users[1].id = s.users[0].id)));
    reject(broken((s) => (s.todos[1].id = s.todos[0].id)));
    reject(broken((s) => (s.todos[0].notes[1].id = s.todos[0].notes[0].id)));
    reject(broken((s) => (s.activities[1].id = s.activities[0].id)));
  });

  it("空白だけの ID を拒否する", () => {
    reject(broken((s) => (s.list.id = " ")));
    reject(broken((s) => (s.users[0].id = " ")));
    reject(broken((s) => (s.todos[0].id = "   ")));
    reject(broken((s) => (s.todos[0].notes[0].id = "\t")));
    reject(broken((s) => (s.activities[0].id = " ")));
  });

  it("不正な要素が1つでもあれば全体を拒否する", () => {
    const state = validState();
    state.todos.push({ ...state.todos[1], id: "todo-3", title: "" });
    reject(state);
  });
});

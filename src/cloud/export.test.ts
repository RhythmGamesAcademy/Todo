import { describe, expect, it } from "vitest";
import { buildCloudExport, serializeCloudExport } from "./export";
import type { CloudState, CloudTodo } from "./types";

const todo: CloudTodo = {
  id: "todo-1",
  title: "共有の課題",
  description: "説明",
  deadline: "2026-10-30T01:00:00.000Z",
  priority: "high",
  status: "doing",
  assigneeId: "user-1",
  createdAt: "2026-10-19T00:00:00.000Z",
  updatedAt: "2026-10-20T00:00:00.000Z",
  notes: [
    {
      id: "note-1",
      text: "メモ",
      createdAt: "2026-10-19T01:00:00.000Z",
      editedAt: "2026-10-19T02:00:00.000Z",
    },
  ],
};

const state: CloudState = {
  list: { id: "list-1", title: "共有リスト", revision: 7 },
  users: [
    { id: "user-1", name: "自分", createdAt: "2026-10-19T00:00:00.000Z" },
    { id: "user-2", name: "佐藤", createdAt: "2026-10-20T00:00:00.000Z" },
  ],
  todos: [todo],
  activities: [
    {
      id: "activity-1",
      todoId: "todo-1",
      userId: "user-1",
      kind: "todo.created",
      field: null,
      before: null,
      after: "共有の課題",
      createdAt: "2026-10-19T00:00:00.000Z",
    },
    {
      id: "activity-2",
      todoId: "todo-1",
      userId: "user-2",
      kind: "todo.updated",
      field: "status",
      before: "todo",
      after: "doing",
      createdAt: "2026-10-20T00:00:00.000Z",
    },
  ],
};

describe("クラウド版の書き出し", () => {
  it("version 2 と4つの節、指定した書き出し日時を含む", () => {
    const result = buildCloudExport(state, "2026-10-20T12:34:56.000Z");
    expect(result.version).toBe(2);
    expect(result.exportedAt).toBe("2026-10-20T12:34:56.000Z");
    expect(result.list).toEqual({ id: "list-1", title: "共有リスト" });
    expect(result.users).toHaveLength(2);
    expect(result.todos).toHaveLength(1);
    expect(result.activities).toHaveLength(2);
  });

  it("TODOのメモと担当者、メンバーをそのまま含む", () => {
    const result = buildCloudExport(state, "2026-10-20T12:34:56.000Z");
    expect(result.todos).toEqual(state.todos);
    expect(result.todos[0].notes[0].text).toBe("メモ");
    expect(result.todos[0].assigneeId).toBe("user-1");
    expect(result.users).toEqual(state.users);
  });

  it("活動履歴は渡された昇順のまま含まれる", () => {
    const result = buildCloudExport(state, "2026-10-20T12:34:56.000Z");
    expect(result.activities.map((activity) => activity.id)).toEqual([
      "activity-1",
      "activity-2",
    ]);
  });

  it("JSONとして読み戻せて version 2 を保つ", () => {
    const raw = serializeCloudExport(
      buildCloudExport(state, "2026-10-20T12:34:56.000Z"),
    );
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed.version).toBe(2);
    expect(parsed.todos).toEqual(state.todos);
    expect(parsed.activities).toEqual(state.activities);
  });
});

import { describe, expect, it } from "vitest";
import { mergeNotes, planRestore, serializeTodos } from "./model";
import type { Note, Todo } from "./model";
const note = (id: string, text: string, createdAt: string): Note => ({
  id,
  text,
  createdAt,
});
const task = (id: string, extra: Partial<Todo> = {}): Todo => ({
  id,
  title: id,
  description: "",
  deadline: null,
  priority: "medium",
  status: "todo",
  notes: [],
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-02T00:00:00Z",
  ...extra,
});
describe("バックアップの復元", () => {
  it("完全上書きはメモも置換し、ファイルにないTODOを削除する", () => {
    const current = [
      task("same", {
        notes: [note("local", "端末のメモ", "2026-10-01T00:00:00Z")],
      }),
      task("local-only"),
    ];
    const imported = [
      task("same", { title: "読み込んだタイトル" }),
      task("new"),
    ];
    const plan = planRestore(current, imported, "replace");
    expect(plan.todos).toEqual(imported);
    expect(plan).toMatchObject({ added: 1, updated: 1, removed: 1 });
  });
  it("更新＋新規追加は現在だけのTODOを残し、作成日時を保持し、新しいTODOも追加する", () => {
    const local = task("same");
    const incoming = task("same", {
      title: "更新",
      description: "新しい説明",
      deadline: "2026-11-01T12:00:00Z",
      priority: "high",
      status: "doing",
      createdAt: "2026-10-03T00:00:00Z",
      updatedAt: "2026-10-04T00:00:00Z",
    });
    const before = serializeTodos([local]);
    const plan = planRestore(
      [local, task("local-only")],
      [incoming, task("new")],
      "merge",
    );
    expect(plan.todos.map((t) => t.id)).toEqual(["same", "local-only", "new"]);
    expect(plan.todos[0]).toMatchObject({
      title: "更新",
      description: "新しい説明",
      deadline: incoming.deadline,
      priority: "high",
      status: "doing",
      createdAt: local.createdAt,
      updatedAt: incoming.updatedAt,
    });
    expect(serializeTodos([local])).toBe(before);
    expect(plan).toMatchObject({
      added: 1,
      updated: 1,
      removed: 0,
      unchanged: 1,
    });
  });
  it("メモはIDで重複排除し、同じIDは読込側を採用して、タイムゾーンを考慮した日時順に統合する", () => {
    const local = [
      note("late", "あと", "2026-10-18T12:00:00+09:00"),
      note("same", "元", "2026-10-18T03:00:00Z"),
    ];
    const imported = [
      note("early", "先", "2026-10-18T10:00:00+09:00"),
      note("same", "読込側", "2026-10-18T02:00:00Z"),
    ];
    const merged = mergeNotes(local, imported);
    expect(merged.map((n) => n.id)).toEqual(["early", "same", "late"]);
    expect(merged[1].text).toBe("読込側");
    expect(local[1].text).toBe("元");
    expect(mergeNotes(merged, imported)).toEqual(merged);
  });
  it("同じバックアップを繰り返し統合してもTODOとメモは増えない", () => {
    const current = [
      task("same", { notes: [note("local", "元", "2026-10-01T00:00:00Z")] }),
    ];
    const incoming = [
      task("same", {
        title: "変更",
        notes: [note("remote", "追加", "2026-10-02T00:00:00Z")],
      }),
      task("new"),
    ];
    const first = planRestore(current, incoming, "merge");
    const second = planRestore(first.todos, incoming, "merge");
    expect(second.todos).toEqual(first.todos);
    expect(second).toMatchObject({ added: 0, updated: 0, removed: 0 });
    expect(second.todos[0].notes).toHaveLength(2);
  });
  it("ないTODOだけ追加では同じIDのパラメータとメモを変更しない", () => {
    const local = task("same", {
      title: "端末のタイトル",
      notes: [note("local", "元", "2026-10-01T00:00:00Z")],
    });
    const imported = [
      task("same", { title: "読み込んだタイトル", notes: [] }),
      task("new"),
    ];
    const plan = planRestore([local], imported, "add");
    expect(plan.todos).toEqual([local, imported[1]]);
    expect(plan).toMatchObject({
      added: 1,
      updated: 0,
      removed: 0,
      unchanged: 1,
    });
  });
  it("追加後の件数が保存形式の上限を超える場合は復元を拒否する", () => {
    const current = Array.from({ length: 10000 }, (_, i) => task(String(i)));
    expect(() => planRestore(current, [task("new")], "add")).toThrow("10,000");
    expect(planRestore(current, [task("new")], "replace").todos).toHaveLength(
      1,
    );
  });
});

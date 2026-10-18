import { describe, expect, it } from "vitest";
import {
  calendarUrl,
  isOverdue,
  parseTodos,
  selectTodos,
  serializeTodos,
  toDateInput,
} from "./model";
import type { Todo } from "./model";
const now = new Date("2026-10-18T12:00:00+09:00");
const make = (
  id: string,
  deadline: string | null,
  priority: Todo["priority"] = "medium",
): Todo => ({
  id,
  title: id,
  description: "",
  deadline,
  priority,
  status: "todo",
  notes: [],
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
});
describe("TODOの表示と保存", () => {
  it("期限なしを最後に置き、同じ期限なら優先度で並ぶ。元データは変更しない", () => {
    const list = [
      make("none", null),
      make("later", "2026-10-20T00:00:00Z"),
      make("low", "2026-10-19T00:00:00Z", "low"),
      make("high", "2026-10-19T00:00:00Z", "high"),
      make("none-high", null, "high"),
    ];
    expect(
      selectTodos(list, "all", "", "deadline", now).map((t) => t.id),
    ).toEqual(["high", "low", "later", "none-high", "none"]);
    expect(list[0].id).toBe("none");
  });
  it("優先度順では優先度、期限の順で並ぶ", () => {
    const list = [
      make("low", "2026-10-19T00:00:00Z", "low"),
      make("high-none", null, "high"),
      make("high-due", "2026-10-20T00:00:00Z", "high"),
    ];
    expect(
      selectTodos(list, "all", "", "priority", now).map((t) => t.id),
    ).toEqual(["high-due", "high-none", "low"]);
  });
  it("メモも検索し、完了状態で絞り込める", () => {
    const task = make("report", null);
    task.status = "done";
    task.notes = [
      { id: "note", text: "資料を調査した", createdAt: now.toISOString() },
    ];
    expect(selectTodos([task], "done", "調査", "deadline", now)).toEqual([
      task,
    ]);
    expect(selectTodos([task], "active", "調査", "deadline", now)).toEqual([]);
  });
  it("今日が期限の一覧には完了済みを含めない", () => {
    const task = make("today", now.toISOString());
    const done = { ...task, id: "done", status: "done" as const };
    expect(
      selectTodos([task, done], "today", "", "deadline", now).map((t) => t.id),
    ).toEqual(["today"]);
  });
  it("完了済みと期限なしのTODOは期限超過にならない", () => {
    const task = make("overdue", "2026-10-01T00:00:00Z");
    expect(isOverdue(task, now)).toBe(true);
    expect(isOverdue({ ...task, status: "done" }, now)).toBe(false);
    expect(isOverdue({ ...task, deadline: null }, now)).toBe(false);
  });
  it("締切時刻から15分の予定リンクを生成し、日本語と改行を保持する", () => {
    const task = make("レポート提出", "2026-10-18T14:55:00+09:00");
    task.description = "説明 & 確認\n改行";
    const url = new URL(calendarUrl(task)!);
    expect(url.searchParams.get("dates")).toBe(
      "20261018T055500Z/20261018T061000Z",
    );
    expect(url.searchParams.get("text")).toBe("【締切】レポート提出");
    expect(url.searchParams.get("details")).toContain(task.description);
    expect(calendarUrl({ ...task, deadline: null })).toBe(null);
  });
  it("バックアップでメモと日時を保持できる", () => {
    const task = make("task", now.toISOString());
    task.notes = [
      {
        id: "n",
        text: "メモ",
        createdAt: now.toISOString(),
        editedAt: now.toISOString(),
      },
    ];
    expect(parseTodos(serializeTodos([task]))).toEqual([task]);
    expect(new Date(toDateInput(task.deadline!)).getTime()).toBe(
      new Date(task.deadline!).getTime(),
    );
  });
  it("壊れた形式、重複ID、不正な日時・メモは復元しない", () => {
    const task = make("task", null);
    for (const raw of [
      "not json",
      JSON.stringify([]),
      serializeTodos([task, task]),
      serializeTodos([{ ...task, deadline: "invalid" }]),
      serializeTodos([
        {
          ...task,
          notes: [{ id: "n", text: "", createdAt: now.toISOString() }],
        },
      ]),
    ])
      expect(() => parseTodos(raw)).toThrow();
  });
});

describe("期限超過の一覧", () => {
  it("期限を過ぎた未完了だけを表示し、完了済み・期限なし・同時刻・未来は除く", () => {
    const past = new Date(now.getTime() - 60000).toISOString();
    const future = new Date(now.getTime() + 60000).toISOString();
    const list = [
      make("past", past),
      { ...make("doing", past), status: "doing" as const },
      { ...make("done", past), status: "done" as const },
      make("none", null),
      make("exact", now.toISOString()),
      make("future", future),
    ];
    expect(
      selectTodos(list, "overdue", "", "deadline", now)
        .map((t) => t.id)
        .sort(),
    ).toEqual(["doing", "past"]);
    expect(
      selectTodos(list, "overdue", "doing", "deadline", now).map((t) => t.id),
    ).toEqual(["doing"]);
  });
});

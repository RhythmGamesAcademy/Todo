import { describe, expect, it } from "vitest";
import { calendarUrl, isOverdue, selectTodos, toDateInput } from "./model";
import { nextDeadlineId } from "./model";
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
  assigneeId: null,
  notes: [],
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
});
describe("TODOの表示と保存", () => {
  it("すべてのTODOにも完了済みを含め、完了の一覧で絞り込める", () => {
    const active = make("active", null);
    const done = { ...make("done", null), status: "done" as const };
    expect(
      selectTodos([active, done], "all", "", "deadline", now, "any"),
    ).toEqual([active, done]);
    expect(
      selectTodos([active, done], "done", "", "deadline", now, "any"),
    ).toEqual([done]);
  });
  it.each(["deadline", "priority"] as const)(
    "完了済みを末尾に集め、両グループ内を%s順にする",
    (sort) => {
      const list = [
        {
          ...make("done-soon", "2026-10-19T00:00:00Z", "low"),
          status: "done" as const,
        },
        make("active-later", "2026-10-23T00:00:00Z", "high"),
        {
          ...make("done-later", "2026-10-20T00:00:00Z", "high"),
          status: "done" as const,
        },
        make("active-soon", "2026-10-22T00:00:00Z", "low"),
      ];
      const original = [...list];
      expect(
        selectTodos(list, "all", "", sort, now, "any").map((todo) => todo.id),
      ).toEqual(
        sort === "deadline"
          ? ["active-soon", "active-later", "done-soon", "done-later"]
          : ["active-later", "active-soon", "done-later", "done-soon"],
      );
      expect(list).toEqual(original);
    },
  );
  it("期限なしを最後に置き、同じ期限なら優先度で並ぶ。元データは変更しない", () => {
    const list = [
      make("none", null),
      make("later", "2026-10-20T00:00:00Z"),
      make("low", "2026-10-19T00:00:00Z", "low"),
      make("high", "2026-10-19T00:00:00Z", "high"),
      make("none-high", null, "high"),
    ];
    expect(
      selectTodos(list, "all", "", "deadline", now, "any").map((t) => t.id),
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
      selectTodos(list, "all", "", "priority", now, "any").map((t) => t.id),
    ).toEqual(["high-due", "high-none", "low"]);
  });
  it("メモも検索し、完了状態で絞り込める", () => {
    const task = make("report", null);
    task.status = "done";
    task.notes = [
      {
        id: "note",
        text: "資料を調査した",
        createdAt: now.toISOString(),
        userId: null,
      },
    ];
    expect(selectTodos([task], "done", "調査", "deadline", now, "any")).toEqual(
      [task],
    );
    expect(
      selectTodos([task], "active", "調査", "deadline", now, "any"),
    ).toEqual([]);
  });
  it("selectTodos filters by assignee", () => {
    const todos = [
      make("unassigned", null),
      { ...make("assigned", null), assigneeId: "u1" },
    ];
    expect(
      selectTodos(todos, "all", "", "deadline", now, "none").map(
        (t) => t.assigneeId,
      ),
    ).toEqual([null]);
    expect(selectTodos(todos, "all", "", "deadline", now, "u1").length).toBe(1);
    expect(selectTodos(todos, "all", "", "deadline", now, "any").length).toBe(
      2,
    );
  });
  it("今日が期限の一覧には完了済みを含めない", () => {
    const task = make("today", now.toISOString());
    const done = { ...task, id: "done", status: "done" as const };
    expect(
      selectTodos([task, done], "today", "", "deadline", now, "any").map(
        (t) => t.id,
      ),
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
    expect(url.origin + url.pathname).toBe(
      "https://calendar.google.com/calendar/render",
    );
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
    const browserUrl = new URL(calendarUrl(task, true)!);
    expect(browserUrl.origin + browserUrl.pathname).toBe(
      "https://www.google.com/calendar/render",
    );
    expect(browserUrl.search).toBe(url.search);
    expect(url.searchParams.get("dates")).toBe(
      "20261018T055500Z/20261018T061000Z",
    );
    expect(url.searchParams.get("text")).toBe("【締切】レポート提出");
    expect(url.searchParams.get("details")).toContain(task.description);
    expect(calendarUrl({ ...task, deadline: null })).toBe(null);
  });
  it("期限の日時を入力欄の形式に変換しても時刻を保つ", () => {
    const task = make("task", now.toISOString());
    expect(new Date(toDateInput(task.deadline!)).getTime()).toBe(
      new Date(task.deadline!).getTime(),
    );
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
      selectTodos(list, "overdue", "", "deadline", now, "any")
        .map((t) => t.id)
        .sort(),
    ).toEqual(["doing", "past"]);
    expect(
      selectTodos(list, "overdue", "doing", "deadline", now, "any").map(
        (t) => t.id,
      ),
    ).toEqual(["doing"]);
  });
});

describe("直近の期限のアクセント", () => {
  it("完了・期限超過・期限なしを除外し、これからの期限が最も近いTODOを選ぶ", () => {
    const past = new Date(now.getTime() - 60000).toISOString();
    const soon = new Date(now.getTime() + 60000).toISOString();
    const later = new Date(now.getTime() + 3600000).toISOString();
    const list = [
      make("past", past),
      { ...make("done", soon), status: "done" as const },
      make("none", null),
      make("later", later),
      make("soon", soon),
    ];
    expect(nextDeadlineId(list, now)).toBe("soon");
    expect(list.map((t) => t.id)).toEqual([
      "past",
      "done",
      "none",
      "later",
      "soon",
    ]);
  });
  it("対象がない場合はアクセントを付けない", () => {
    expect(nextDeadlineId([], now)).toBeNull();
    expect(
      nextDeadlineId(
        [
          make("none", null),
          make("past", new Date(now.getTime() - 1).toISOString()),
        ],
        now,
      ),
    ).toBeNull();
  });
  it("期限が同じ場合も配列の順番によらず1件だけ選ぶ", () => {
    const a = make("a", now.toISOString());
    const b = make("b", now.toISOString());
    expect(nextDeadlineId([a, b], now)).toBe("a");
    expect(nextDeadlineId([b, a], now)).toBe("a");
  });
});

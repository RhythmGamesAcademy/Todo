// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { computeEntries, Timeline } from "./Timeline";
import { messages } from "../messages";
import type { Note } from "../model";
import type { Activity, CloudUser } from "../cloud/types";

const users: CloudUser[] = [
  { id: "u1", name: "田中", createdAt: "2026-01-01T00:00:00.000Z" },
  { id: "u2", name: "佐藤", createdAt: "2026-01-01T00:00:00.000Z" },
];

const memo = (
  id: string,
  text: string,
  createdAt: string,
  userId: string | null = "u1",
): Note => ({
  id,
  text,
  createdAt,
  userId,
});

const activity = (extra: Partial<Activity>): Activity => ({
  id: "a1",
  todoId: "t1",
  userId: "u1",
  kind: "todo.updated",
  field: null,
  before: null,
  after: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  ...extra,
});

function renderTimeline(activities: Activity[], memos: Note[] = []) {
  return render(
    <Timeline
      activities={activities}
      memos={memos}
      users={users}
      meId="u1"
    />,
  );
}

afterEach(cleanup);

describe("タイムライン", () => {
  it("メモと変更履歴を createdAt 昇順で混ぜ、同時刻はメモを先に並べる", () => {
    renderTimeline(
      [
        activity({
          id: "created-late",
          kind: "todo.created",
          createdAt: "2026-10-01T03:00:00.000Z",
        }),
        activity({
          id: "created-tie",
          kind: "todo.created",
          createdAt: "2026-10-01T01:00:00.000Z",
        }),
      ],
      [
        memo("m2", "次のメモ", "2026-10-01T02:00:00.000Z"),
        memo("m1", "最初のメモ", "2026-10-01T01:00:00.000Z"),
      ],
    );
    const items = screen
      .getAllByRole("listitem")
      .map((item) => item.textContent ?? "");
    expect(
      screen.getByRole("list", { name: messages.activity.heading }),
    ).toBeTruthy();
    expect(items).toHaveLength(4);
    expect(items[0]).toContain("最初のメモ");
    expect(items[1]).toContain("田中がTODOを作成しました");
    expect(items[2]).toContain("次のメモ");
    expect(items[3]).toContain("田中がTODOを作成しました");
    const times = screen
      .getAllByRole("listitem")
      .map((item) => item.querySelector("time")?.getAttribute("dateTime"));
    expect(times[0]).toBe("2026-10-01T01:00:00.000Z");
    expect(times[2]).toBe("2026-10-01T02:00:00.000Z");
  });

  it("メモの投稿者名を表示し、自分・削除済み・不明を区別する", () => {
    renderTimeline(
      [],
      [
        memo("m1", "自分のメモ", "2026-10-01T01:00:00.000Z", "u1"),
        memo("m2", "佐藤のメモ", "2026-10-01T02:00:00.000Z", "u2"),
        memo("m3", "削除済みのメモ", "2026-10-01T03:00:00.000Z", "gone"),
        memo("m4", "投稿者不明のメモ", "2026-10-01T04:00:00.000Z", null),
      ],
    );
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(4);
    expect(items[0].textContent).toContain(messages.chat.self);
    expect(items[1].textContent).toContain("佐藤");
    expect(items[2].textContent).toContain(messages.activity.memoFallback);
    expect(items[3].textContent).toContain(messages.activity.memoFallback);
  });

  it("状態と優先度の変更を日本語ラベルで表示する", () => {
    renderTimeline([
      activity({
        id: "status",
        field: "status",
        before: "todo",
        after: "doing",
        createdAt: "2026-10-01T01:00:00.000Z",
      }),
      activity({
        id: "priority",
        field: "priority",
        before: "low",
        after: "high",
        createdAt: "2026-10-01T02:00:00.000Z",
      }),
    ]);
    expect(
      screen.getByText("田中が状態を未着手から進行中に変更しました"),
    ).toBeTruthy();
    expect(
      screen.getByText("田中が優先度を低から高に変更しました"),
    ).toBeTruthy();
  });

  it("担当者の変更に操作者と両方の名前を表示し、未設定は担当者なしとする", () => {
    renderTimeline([
      activity({
        id: "assign",
        field: "assignee",
        before: null,
        after: "佐藤",
        createdAt: "2026-10-01T01:00:00.000Z",
      }),
      activity({
        id: "unassign",
        field: "assignee",
        before: "佐藤",
        after: null,
        createdAt: "2026-10-01T02:00:00.000Z",
      }),
    ]);
    expect(
      screen.getByText("田中が担当者を担当者なしから「佐藤」に変更しました"),
    ).toBeTruthy();
    expect(
      screen.getByText("田中が担当者を「佐藤」から担当者なしに変更しました"),
    ).toBeTruthy();
  });

  it("users に居ない操作者・操作者不明の履歴も fallback 文言で表示する", () => {
    renderTimeline([
      activity({
        id: "gone",
        userId: "removed",
        field: "title",
        before: "旧題",
        after: "新題",
        createdAt: "2026-10-01T01:00:00.000Z",
      }),
      activity({
        id: "null-actor",
        userId: null,
        field: "title",
        before: "新題",
        after: "決定版",
        createdAt: "2026-10-01T02:00:00.000Z",
      }),
    ]);
    expect(
      screen.getByText(
        "削除されたメンバーがタイトルを「旧題」から「新題」に変更しました",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "削除されたメンバーがタイトルを「新題」から「決定版」に変更しました",
      ),
    ).toBeTruthy();
  });

  it("作成・削除・元に戻した履歴をそれぞれの文言で表示する", () => {
    renderTimeline([
      activity({
        id: "created",
        kind: "todo.created",
        createdAt: "2026-10-01T01:00:00.000Z",
      }),
      activity({
        id: "deleted",
        kind: "todo.deleted",
        createdAt: "2026-10-01T02:00:00.000Z",
      }),
      activity({
        id: "restored",
        kind: "todo.restored",
        createdAt: "2026-10-01T03:00:00.000Z",
      }),
    ]);
    expect(screen.getByText("田中がTODOを作成しました")).toBeTruthy();
    expect(screen.getByText("田中がTODOを削除しました")).toBeTruthy();
    expect(screen.getByText("田中がTODOを元に戻しました")).toBeTruthy();
  });

  it("期限の変更を日時として表示し、未設定は期限なしとする", () => {
    const deadline = new Date(2026, 9, 30, 10, 0).toISOString();
    renderTimeline([
      activity({
        id: "set",
        field: "deadline",
        before: null,
        after: deadline,
        createdAt: "2026-10-01T01:00:00.000Z",
      }),
      activity({
        id: "clear",
        field: "deadline",
        before: deadline,
        after: null,
        createdAt: "2026-10-01T02:00:00.000Z",
      }),
    ]);
    expect(
      screen.getByText(
        "田中が期限を期限なしから2026年10月30日 10:00に変更しました",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "田中が期限を2026年10月30日 10:00から期限なしに変更しました",
      ),
    ).toBeTruthy();
  });

  it("表示できない履歴を除いた件数を数え、リストは変更履歴として読み上げる", () => {
    const rows = [
      activity({
        id: "valid",
        kind: "todo.created",
        createdAt: "2026-10-01T00:00:00.000Z",
      }),
      activity({ id: "unknown-field", field: "mystery" }),
      activity({ id: "empty-field", field: null }),
      activity({ id: "renamed", kind: "user.renamed" }),
    ];
    const memos = [memo("m1", "メモ", "2026-10-01T00:00:00.000Z")];
    const entries = computeEntries(rows, memos, users);
    expect(entries).toHaveLength(2);
    renderTimeline(rows, memos);
    expect(
      screen.getByRole("list", { name: messages.activity.heading }),
    ).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(entries.length);
  });
});

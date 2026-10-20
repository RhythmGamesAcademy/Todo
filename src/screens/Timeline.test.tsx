// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Timeline } from "./Timeline";
import type { Note } from "../model";
import type { Activity, CloudUser } from "../cloud/types";

const users: CloudUser[] = [
  { id: "u1", name: "田中", createdAt: "2026-01-01T00:00:00.000Z" },
  { id: "u2", name: "佐藤", createdAt: "2026-01-01T00:00:00.000Z" },
];

const memo = (id: string, text: string, createdAt: string): Note => ({
  id,
  text,
  createdAt,
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
    <Timeline activities={activities} memos={memos} users={users} />,
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
});

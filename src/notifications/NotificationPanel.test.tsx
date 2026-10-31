// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NotificationPanel } from "./NotificationPanel";
import { messages } from "../messages";
import type { Notification } from "../cloud/types";

const me = {
  id: "user-1",
  name: "あき",
  createdAt: "2026-10-01T00:00:00.000Z",
};
const other = {
  id: "user-2",
  name: "はる",
  createdAt: "2026-10-01T00:00:00.000Z",
};

const notification = (extra: Partial<Notification>): Notification => ({
  id: "notification-1",
  todoId: "todo-1",
  userId: "user-2",
  kind: "mention",
  body: "設計を確認して",
  createdAt: "2026-10-20T09:00:00.000Z",
  ...extra,
});

describe("NotificationPanel", () => {
  afterEach(cleanup);
  it("通知がないときは空状態の文言だけを出す", () => {
    render(<NotificationPanel notifications={[]} users={[me]} meId={me.id} />);
    expect(screen.getByText(messages.notifications.empty)).toBeTruthy();
    const list = screen.getByLabelText(messages.notifications.title);
    expect(list.children).toHaveLength(1);
  });

  it("種別ごとの見出しと本文の1行プレビューを出す", () => {
    render(
      <NotificationPanel
        notifications={[
          notification({}),
          notification({
            id: "notification-2",
            userId: "user-2",
            kind: "todo.assigned",
            body: "買い物に行く",
          }),
          notification({
            id: "notification-3",
            userId: null,
            kind: "approval.approved",
            body: null,
          }),
        ]}
        users={[me, other]}
        meId={me.id}
      />,
    );
    const list = screen.getByLabelText(messages.notifications.title);
    expect(list.children).toHaveLength(3);
    // 宛先側の actor 名はメンバー一覧から解決する。
    expect(
      screen.getByText(messages.notifications.mention("はる")),
    ).toBeTruthy();
    expect(screen.getByText("設計を確認して")).toBeTruthy();
    expect(
      screen.getByText(messages.notifications.assigned("はる")),
    ).toBeTruthy();
    expect(screen.getByText("買い物に行く")).toBeTruthy();
    // actor が退会済みのときは「誰か」に落ちる。
    expect(
      screen.getByText(messages.notifications.approved(null)),
    ).toBeTruthy();
  });

  it("自分が操作者だったときの表示は「自分」に置き換わる", () => {
    render(
      <NotificationPanel
        notifications={[notification({ userId: "user-1" })]}
        users={[me, other]}
        meId={me.id}
      />,
    );
    expect(
      screen.getByText(messages.notifications.mention("自分")),
    ).toBeTruthy();
    expect(
      screen.queryByText(messages.notifications.mention("はる")),
    ).toBeNull();
  });
});

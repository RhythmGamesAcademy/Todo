// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TodoCard, TodoForm } from "./ui";
import { messages } from "./messages";
import type { Todo } from "./model";

afterEach(cleanup);

// jsdom には ResizeObserver / scrollIntoView がなく、Headless UI が使うためスタブする。
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub;
Element.prototype.scrollIntoView ??= () => {};

const todo = (extra: Partial<Todo> = {}): Todo => ({
  id: "todo",
  title: "親TODO",
  description: "説明",
  deadline: "2026-10-30T10:00:00.000Z",
  priority: "medium",
  status: "todo",
  assigneeIds: [],
  tags: [],
  approvalStatus: null,
  approvalReason: null,
  createdAt: "2026-10-18T00:00:00.000Z",
  updatedAt: "2026-10-18T00:00:00.000Z",
  notes: [],
  subtasks: [],
  ...extra,
});

describe("TodoCard", () => {
  it("サブタスクがあると完了数と総数を表示し、ない場合は表示しない", () => {
    render(
      <>
        <TodoCard
          todo={todo({
            subtasks: [
              {
                id: "done",
                title: "完了",
                status: "done",
                priority: "low",
                deadline: null,
                createdAt: "2026-10-18T00:00:00.000Z",
                updatedAt: "2026-10-18T00:00:00.000Z",
                memos: [],
              },
              {
                id: "active",
                title: "未完了",
                status: "todo",
                priority: "high",
                deadline: null,
                createdAt: "2026-10-18T00:00:00.000Z",
                updatedAt: "2026-10-18T00:00:00.000Z",
                memos: [],
              },
            ],
          })}
          now={new Date("2026-10-20T00:00:00.000Z")}
          users={[]}
          onOpen={() => {}}
        />
        <TodoCard
          todo={todo({ id: "empty", title: "サブタスクなし" })}
          now={new Date("2026-10-20T00:00:00.000Z")}
          users={[]}
          onOpen={() => {}}
        />
      </>,
    );
    expect(
      within(
        screen.getByRole("button", { name: "親TODOの詳細を開く" }),
      ).getByText("サブタスク 1/2"),
    ).toBeTruthy();
    expect(
      within(
        screen.getByRole("button", {
          name: "サブタスクなしの詳細を開く",
        }),
      ).queryByText(/サブタスク \d+\/\d+/),
    ).toBeNull();
  });

  it("タグをチップで出し、申請タグつきTODOには承認状態のバッジを出す", () => {
    render(
      <>
        <TodoCard
          todo={todo({
            id: "tagged",
            title: "タグつきのTODO",
            tags: ["会議", "申請"],
            approvalStatus: "pending",
          })}
          now={new Date("2026-10-20T00:00:00.000Z")}
          users={[]}
          onOpen={() => {}}
        />
        <TodoCard
          todo={todo({
            id: "approved",
            title: "承認済みのTODO",
            tags: ["申請"],
            approvalStatus: "approved",
          })}
          now={new Date("2026-10-20T00:00:00.000Z")}
          users={[]}
          onOpen={() => {}}
        />
        <TodoCard
          todo={todo({ id: "plain", title: "タグなしのTODO" })}
          now={new Date("2026-10-20T00:00:00.000Z")}
          users={[]}
          onOpen={() => {}}
        />
      </>,
    );
    const tagged = within(
      screen.getByRole("button", { name: "タグつきのTODOの詳細を開く" }),
    );
    expect(tagged.getByText("会議")).toBeTruthy();
    expect(tagged.getByText("申請")).toBeTruthy();
    expect(tagged.getByText(messages.approval.pending)).toBeTruthy();
    const approved = within(
      screen.getByRole("button", { name: "承認済みのTODOの詳細を開く" }),
    );
    expect(approved.getByText(messages.approval.approved)).toBeTruthy();
    // タグがなければチップもバッジも出さない。
    const plain = within(
      screen.getByRole("button", { name: "タグなしのTODOの詳細を開く" }),
    );
    expect(plain.queryByText(messages.approval.pending)).toBeNull();
    expect(plain.queryByLabelText(messages.tags.label)).toBeNull();
  });
});

describe("TodoForm のタグ選択", () => {
  const renderForm = (tagSuggestions: string[] = []) =>
    render(
      <TodoForm
        users={[]}
        tagSuggestions={tagSuggestions}
        onSave={async () => true}
        onCancel={() => {}}
        onDirty={() => {}}
        ask={async () => true}
      />,
    );
  const openTags = async () => {
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: messages.tags.selectLabel }));
    return screen.getByRole("listbox");
  };

  it("プルダウンからテンプレートタグを選ぶとチップが追加される", async () => {
    renderForm(["既存タグ"]);
    const listbox = await openTags();
    expect(within(listbox).getByRole("option", { name: "開発" })).toBeTruthy();
    expect(
      within(listbox).getByRole("option", { name: "既存タグ" }),
    ).toBeTruthy();
    await userEvent
      .setup()
      .click(within(listbox).getByRole("option", { name: "開発" }));
    expect(screen.getByText("開発")).toBeTruthy();
    // 再度開くと既に追加したタグは選択肢から消える。
    const reopened = await openTags();
    expect(within(reopened).queryByRole("option", { name: "開発" })).toBeNull();
    expect(
      within(reopened).getByRole("option", { name: "既存タグ" }),
    ).toBeTruthy();
  });

  it("プルダウンには申請タグも選択肢に含まれる", async () => {
    renderForm();
    const listbox = await openTags();
    expect(
      within(listbox).getByRole("option", { name: messages.approval.label }),
    ).toBeTruthy();
  });
});

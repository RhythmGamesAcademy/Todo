// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { TodoCard } from "./ui";
import type { Todo } from "./model";

const todo = (extra: Partial<Todo> = {}): Todo => ({
  id: "todo",
  title: "親TODO",
  description: "説明",
  deadline: "2026-10-30T10:00:00.000Z",
  priority: "medium",
  status: "todo",
  assigneeId: null,
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
});

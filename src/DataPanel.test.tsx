// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DataPanel } from "./DataPanel";
import { messages } from "./messages";
import type { CloudState } from "./cloud/types";

const state: CloudState = {
  list: { id: "list-1", title: "共有リスト", revision: 3 },
  users: [
    { id: "user-1", name: "自分", createdAt: "2026-10-19T00:00:00.000Z" },
    { id: "user-2", name: "佐藤", createdAt: "2026-10-20T00:00:00.000Z" },
  ],
  todos: [
    {
      id: "todo-1",
      title: "課題",
      description: "",
      deadline: null,
      priority: "medium",
      status: "todo",
      assigneeId: "user-1",
      createdAt: "2026-10-19T00:00:00.000Z",
      updatedAt: "2026-10-20T00:00:00.000Z",
      notes: [
        {
          id: "note-1",
          text: "メモ",
          createdAt: "2026-10-19T01:00:00.000Z",
          userId: "user-1",
        },
      ],
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
      after: "課題",
      createdAt: "2026-10-19T00:00:00.000Z",
    },
  ],
};

let blobs: Blob[] = [];
let downloads: string[] = [];

const readBlob = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });

beforeEach(() => {
  blobs = [];
  downloads = [];
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn((blob: Blob) => {
      blobs.push(blob);
      return "blob:test";
    }),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloads.push(this.download);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("データの書き出し", () => {
  it("共有データの件数を表示し、読み込み用の入力を残さない", () => {
    render(<DataPanel state={state} notify={vi.fn()} />);
    expect(
      screen.getByText(
        messages.data.cloudSummary(state.list.title, state.users.length),
      ),
    ).toBeTruthy();
    expect(screen.getByText(messages.data.summary(1, 1))).toBeTruthy();
    expect(document.querySelector('input[type="file"]')).toBeNull();
    expect(
      screen.queryByRole("button", { name: messages.data.export }),
    ).toBeTruthy();
  });

  it("クリックで version 2 のJSONをダウンロードし、開始を通知する", async () => {
    const user = userEvent.setup();
    const notify = vi.fn();
    render(<DataPanel state={state} notify={notify} />);
    await user.click(
      screen.getByRole("button", { name: messages.data.export }),
    );

    expect(blobs).toHaveLength(1);
    const data = JSON.parse(await readBlob(blobs[0])) as Record<
      string,
      unknown
    >;
    expect(data.version).toBe(2);
    expect(data.list).toEqual({ id: "list-1", title: "共有リスト" });
    expect(data.users).toEqual(state.users);
    expect(data.todos).toEqual(state.todos);
    expect(data.activities).toEqual(state.activities);
    expect(typeof data.exportedAt).toBe("string");
    expect(downloads[0]).toMatch(/^todo-cloud-\d{4}-\d{2}-\d{2}\.json$/);
    expect(notify).toHaveBeenCalledWith(messages.data.exportStarted);
  });
});

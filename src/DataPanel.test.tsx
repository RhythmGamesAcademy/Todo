// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { parseTodos, serializeTodos, STORAGE_KEY } from "./model";
import type { Todo } from "./model";
const task = (id: string, extra: Partial<Todo> = {}): Todo => ({
  id,
  title: id,
  description: "",
  deadline: null,
  priority: "medium",
  status: "todo",
  assigneeId: null,
  notes: [],
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-02T00:00:00Z",
  ...extra,
});
const saved = () => parseTodos(localStorage.getItem(STORAGE_KEY)!);
const file = (todos: Todo[]) => {
  const raw = serializeTodos(todos);
  const file = new File([raw], "backup.json", { type: "application/json" });
  Object.defineProperty(file, "text", { value: async () => raw });
  return file;
};
beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value() {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value() {
      this.removeAttribute("open");
    },
  });
  Element.prototype.scrollTo = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
async function openData(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    screen.getAllByRole("button", { name: "データの保存・復元" })[0],
  );
}
async function upload(user: ReturnType<typeof userEvent.setup>, todos: Todo[]) {
  await user.upload(screen.getByLabelText("復元するJSONファイル"), file(todos));
}
describe("復元と一括削除の操作", () => {
  it("ファイル選択や確認のキャンセルだけでは変更せず、追加だけを選んで復元できる", async () => {
    const existing = [task("local")];
    localStorage.setItem(STORAGE_KEY, serializeTodos(existing));
    const user = userEvent.setup();
    render(<App />);
    await openData(user);
    await upload(user, [task("local", { title: "変更されない" }), task("new")]);
    expect(saved()).toEqual(existing);
    await user.click(screen.getByRole("button", { name: "復元する" }));
    expect(saved()).toEqual(existing);
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "キャンセル",
      }),
    );
    expect(saved()).toEqual(existing);
    await user.click(screen.getByRole("button", { name: "復元する" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "復元する",
      }),
    );
    expect(saved().map((t) => t.id)).toEqual(["local", "new"]);
    expect(saved()[0].title).toBe("local");
    await upload(user, [task("new")]);
    expect(screen.getByRole("button", { name: "復元する" })).toHaveProperty(
      "disabled",
      true,
    );
  });
  it("更新＋新規追加でパラメータとメモを統合し、新しいIDも保存する", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      serializeTodos([
        task("same", {
          notes: [
            { id: "a", text: "端末側", createdAt: "2026-10-02T00:00:00Z" },
          ],
        }),
        task("local-only"),
      ]),
    );
    const user = userEvent.setup();
    render(<App />);
    await openData(user);
    await user.click(screen.getByRole("radio", { name: /更新＋新規追加/ }));
    await upload(user, [
      task("same", {
        title: "更新済み",
        notes: [
          { id: "b", text: "ファイル側", createdAt: "2026-10-01T00:00:00Z" },
        ],
      }),
      task("new"),
    ]);
    await user.click(screen.getByRole("button", { name: "復元する" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "復元する",
      }),
    );
    expect(saved().map((t) => t.id)).toEqual(["same", "local-only", "new"]);
    expect(saved()[0].title).toBe("更新済み");
    expect(saved()[0].notes.map((n) => n.text)).toEqual([
      "ファイル側",
      "端末側",
    ]);
  });
  it("完全上書きは現在だけのTODOとメモを置き換える", async () => {
    localStorage.setItem(STORAGE_KEY, serializeTodos([task("old")]));
    const user = userEvent.setup();
    render(<App />);
    await openData(user);
    await user.click(screen.getByRole("radio", { name: /完全上書き/ }));
    await upload(user, [task("replacement")]);
    await user.click(screen.getByRole("button", { name: "復元する" }));
    expect(screen.getByRole("alertdialog").textContent).toContain("削除 1件");
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "復元する",
      }),
    );
    expect(saved().map((t) => t.id)).toEqual(["replacement"]);
  });
  it("完了済みだけの削除は確認後に実行し、全削除も選べる。保存失敗時はデータを残す", async () => {
    const existing = [
      task("active"),
      task("done", {
        status: "done",
        notes: [
          { id: "n", text: "完了のメモ", createdAt: "2026-10-01T00:00:00Z" },
        ],
      }),
    ];
    localStorage.setItem(STORAGE_KEY, serializeTodos(existing));
    const user = userEvent.setup();
    render(<App />);
    await openData(user);
    await user.click(screen.getByRole("button", { name: "まとめて削除" }));
    expect(screen.getByRole("alertdialog").textContent).toContain(
      "TODO 1件とメモ 1件",
    );
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "キャンセル",
      }),
    );
    expect(saved()).toEqual(existing);
    await user.click(screen.getByRole("button", { name: "まとめて削除" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "まとめて削除",
      }),
    );
    expect(saved().map((t) => t.id)).toEqual(["active"]);
    await user.selectOptions(screen.getByLabelText("削除対象"), "all");
    const fail = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("quota", "QuotaExceededError");
      });
    await user.click(screen.getByRole("button", { name: "まとめて削除" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "まとめて削除",
      }),
    );
    expect(saved().map((t) => t.id)).toEqual(["active"]);
    expect(
      within(screen.getByRole("dialog")).getByRole("alert").textContent,
    ).toContain("保存できませんでした");
    fail.mockRestore();
    await user.click(screen.getByRole("button", { name: "まとめて削除" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "まとめて削除",
      }),
    );
    expect(saved()).toEqual([]);
    expect(screen.getByRole("button", { name: "まとめて削除" })).toHaveProperty(
      "disabled",
      true,
    );
  });
  it("壊れたファイルは復元せず、元のデータを保持する", async () => {
    const existing = [task("local")];
    localStorage.setItem(STORAGE_KEY, serializeTodos(existing));
    const user = userEvent.setup();
    render(<App />);
    await openData(user);
    const broken = new File(["broken"], "bad.json", {
      type: "application/json",
    });
    Object.defineProperty(broken, "text", { value: async () => "broken" });
    await user.upload(screen.getByLabelText("復元するJSONファイル"), broken);
    expect(within(screen.getByRole("dialog")).getByRole("alert")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "復元する" })).toBeNull();
    expect(saved()).toEqual(existing);
  });
  it("確認中に別タブで更新された場合は古い復元内容を書き込まない", async () => {
    localStorage.setItem(STORAGE_KEY, serializeTodos([task("local")]));
    const user = userEvent.setup();
    render(<App />);
    await openData(user);
    await upload(user, [task("new")]);
    await user.click(screen.getByRole("button", { name: "復元する" }));
    const latest = [task("local"), task("another-tab")];
    localStorage.setItem(STORAGE_KEY, serializeTodos(latest));
    fireEvent(window, new StorageEvent("storage", { key: STORAGE_KEY }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "復元する",
      }),
    );
    expect(saved()).toEqual(latest);
    expect(
      within(screen.getByRole("dialog")).getByRole("alert").textContent,
    ).toContain("確認中に保存データが更新されました");
  });
});

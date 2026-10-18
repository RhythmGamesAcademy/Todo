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
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const task = (): Todo => ({
  id: "task",
  title: "授業の課題",
  description: "TODOアプリを作る",
  deadline: "2026-10-30T10:00:00.000Z",
  priority: "high",
  status: "doing",
  createdAt: "2026-10-18T00:00:00.000Z",
  updatedAt: "2026-10-18T00:00:00.000Z",
  notes: [],
});
const seed = () => localStorage.setItem(STORAGE_KEY, serializeTodos([task()]));

describe("利用者の操作", () => {
  it("期限なしの作成前に確認し、戻れば保存せず、承認後だけ作成する", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "新しいTODO" }));
    await user.type(screen.getByLabelText(/^タイトル/), "本を読む");
    await user.click(screen.getByLabelText("期限を設定しない"));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "TODOを作成",
      }),
    );
    let warning = screen.getByRole("alertdialog");
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    await user.click(
      within(warning).getByRole("button", { name: "期限を設定する" }),
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByLabelText(/^タイトル/)).toHaveProperty(
      "value",
      "本を読む",
    );
    expect(screen.getByLabelText("期限を設定しない")).toHaveProperty(
      "checked",
      false,
    );
    expect(screen.getByLabelText("期限")).toBeTruthy();
    await user.click(screen.getByLabelText("期限を設定しない"));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "TODOを作成",
      }),
    );
    warning = screen.getByRole("alertdialog");
    await user.click(
      within(warning).getByRole("button", { name: "期限なしで作成" }),
    );
    const saved = parseTodos(localStorage.getItem(STORAGE_KEY)!);
    expect(saved).toHaveLength(1);
    expect(saved[0].deadline).toBeNull();
    expect(
      within(screen.getByRole("dialog")).getByRole("heading", {
        name: "本を読む",
      }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("link", { name: /Googleカレンダーに追加/ }),
    ).toBeNull();
  });
  it("期限を持つTODOを作成し、登録用リンクを表示する", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "新しいTODO" }));
    await user.type(screen.getByLabelText(/^タイトル/), "レポートを提出");
    fireEvent.change(screen.getByLabelText("期限"), {
      target: { value: "2026-10-30T23:59" },
    });
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "TODOを作成",
      }),
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
    const link = screen.getByRole("link", { name: /Googleカレンダーに追加/ });
    expect(link.getAttribute("target")).toBe("_blank");
    expect(new URL(link.getAttribute("href")!).searchParams.get("text")).toBe(
      "【締切】レポートを提出",
    );
    expect(
      parseTodos(localStorage.getItem(STORAGE_KEY)!)[0].deadline,
    ).not.toBeNull();
  });
  it("進捗メモを保存し、アプリを開き直しても残り、編集できる", async () => {
    seed();
    const user = userEvent.setup();
    const initial = render(<App />);
    await user.click(
      screen.getByRole("button", { name: "授業の課題の詳細を開く" }),
    );
    await user.type(screen.getByLabelText("メモを残す"), "一覧画面までできた");
    await user.click(screen.getByRole("button", { name: "メモを保存" }));
    expect(
      parseTodos(localStorage.getItem(STORAGE_KEY)!)[0].notes[0].text,
    ).toBe("一覧画面までできた");
    expect(screen.getByLabelText("メモを残す")).toHaveProperty("value", "");
    initial.unmount();
    render(<App />);
    await user.click(
      screen.getByRole("button", { name: "授業の課題の詳細を開く" }),
    );
    const detail = screen.getByRole("dialog");
    expect(within(detail).getByText("一覧画面までできた")).toBeTruthy();
    await user.click(
      within(detail).getByRole("button", { name: "メモを編集" }),
    );
    await user.clear(screen.getByRole("textbox", { name: "メモを編集" }));
    await user.type(
      screen.getByRole("textbox", { name: "メモを編集" }),
      "一覧とモーダルが完成",
    );
    await user.click(screen.getByRole("button", { name: "保存する" }));
    const saved = parseTodos(localStorage.getItem(STORAGE_KEY)!)[0].notes[0];
    expect(saved.text).toBe("一覧とモーダルが完成");
    expect(saved.editedAt).toBeTruthy();
  });
  it("入力中のフォームを閉じる前に確認し、続けると入力を残す", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "新しいTODO" }));
    await user.type(screen.getByLabelText(/^タイトル/), "途中の入力");
    await user.click(screen.getByRole("button", { name: "閉じる" }));
    const warning = screen.getByRole("alertdialog");
    await user.click(
      within(warning).getByRole("button", { name: "入力を続ける" }),
    );
    expect(screen.getByLabelText(/^タイトル/)).toHaveProperty(
      "value",
      "途中の入力",
    );
    await user.click(screen.getByRole("button", { name: "閉じる" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "破棄して閉じる",
      }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
  it("保存失敗時はメモ入力を消さず、成功したと表示しない", async () => {
    seed();
    const user = userEvent.setup();
    render(<App />);
    await user.click(
      screen.getByRole("button", { name: "授業の課題の詳細を開く" }),
    );
    await user.type(
      screen.getByLabelText("メモを残す"),
      "保存できないときも残る",
    );
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    await user.click(screen.getByRole("button", { name: "メモを保存" }));
    expect(screen.getByLabelText("メモを残す")).toHaveProperty(
      "value",
      "保存できないときも残る",
    );
    expect(
      within(screen.getByRole("dialog")).getByRole("alert").textContent,
    ).toContain("保存できませんでした");
    expect(screen.queryByText("メモを保存しました")).toBeNull();
    expect(
      parseTodos(localStorage.getItem(STORAGE_KEY)!)[0].notes,
    ).toHaveLength(0);
  });
  it("削除の確認後に削除し、取り消すとメモも復元する", async () => {
    const t = task();
    t.notes = [{ id: "note", text: "残すメモ", createdAt: t.createdAt }];
    localStorage.setItem(STORAGE_KEY, serializeTodos([t]));
    const user = userEvent.setup();
    render(<App />);
    await user.click(
      screen.getByRole("button", { name: "授業の課題の詳細を開く" }),
    );
    await user.click(screen.getByRole("button", { name: "TODOを削除" }));
    expect(parseTodos(localStorage.getItem(STORAGE_KEY)!)).toHaveLength(1);
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "TODOを削除",
      }),
    );
    expect(parseTodos(localStorage.getItem(STORAGE_KEY)!)).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "元に戻す" }));
    expect(
      parseTodos(localStorage.getItem(STORAGE_KEY)!)[0].notes[0].text,
    ).toBe("残すメモ");
  });
  it("壊れた保存データは自動で上書きせず復元を案内する", () => {
    localStorage.setItem(STORAGE_KEY, "broken");
    render(<App />);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("broken");
    expect(screen.getByRole("alert").textContent).toContain(
      "元のデータは変更していません",
    );
    expect(screen.getByRole("button", { name: "新しいTODO" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(
      screen.getByRole("button", { name: /データの保存・復元を開く/ }),
    ).toBeTruthy();
  });
});

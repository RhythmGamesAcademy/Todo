// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
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
  Element.prototype.scrollTo = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("一覧の表示形式", () => {
  it("簡潔表示は必要な項目だけを表示し、検索・並び順を維持して詳細を開く。表示形式を再読み込み後も保つ", async () => {
    const t = task();
    t.notes = [
      { id: "memo", text: "一覧には不要な進捗メモ", createdAt: t.createdAt },
    ];
    localStorage.setItem(STORAGE_KEY, serializeTodos([t]));
    const original = localStorage.getItem(STORAGE_KEY);
    const user = userEvent.setup();
    const mounted = render(<App />);
    await user.type(screen.getByLabelText("TODO・メモを検索"), "授業");
    await user.selectOptions(screen.getByLabelText("並べ替え"), "priority");
    await user.click(screen.getByRole("button", { name: "簡潔" }));
    const row = screen.getByRole("button", { name: "授業の課題の詳細を開く" });
    expect(row.classList.contains("todo-compact")).toBe(true);
    expect(within(row).getByText("TODOアプリを作る")).toBeTruthy();
    expect(within(row).getByText("優先度 高")).toBeTruthy();
    expect(within(row).queryByText("進行中")).toBeNull();
    expect(within(row).queryByText("一覧には不要な進捗メモ")).toBeNull();
    expect(within(row).queryByText("詳細を開く")).toBeNull();
    expect(row.querySelector(".card-date")?.textContent).toContain("10月30日");
    expect(screen.getByLabelText("TODO・メモを検索")).toHaveProperty(
      "value",
      "授業",
    );
    expect(screen.getByLabelText("並べ替え")).toHaveProperty(
      "value",
      "priority",
    );
    await user.click(row);
    expect(screen.getByRole("dialog")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "閉じる" }));
    expect(localStorage.getItem(STORAGE_KEY)).toBe(original);
    mounted.unmount();
    render(<App />);
    expect(
      screen.getByRole("button", { name: "簡潔" }).getAttribute("aria-pressed"),
    ).toBe("true");
    await user.click(screen.getByRole("button", { name: "カード" }));
    expect(screen.getByText("一覧には不要な進捗メモ")).toBeTruthy();
  });
});

describe("メモの表示演出", () => {
  function motion(reduced: boolean) {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: reduced,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
  }
  function send(text: string) {
    fireEvent.change(screen.getByLabelText("メモを入力"), {
      target: { value: text },
    });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));
  }
  it("保存は即時に完了し、連続送信した各メモがそれぞれ点から本文へ変わる。途中で閉じても保存済みメモは残る", () => {
    vi.useFakeTimers();
    motion(false);
    seed();
    const mounted = render(<App />);
    fireEvent.click(
      screen.getByRole("button", { name: "授業の課題の詳細を開く" }),
    );
    send("最初のメモ");
    expect(
      parseTodos(localStorage.getItem(STORAGE_KEY)!)[0].notes[0].text,
    ).toBe("最初のメモ");
    act(() => vi.advanceTimersByTime(200));
    send("次のメモ");
    expect(
      screen.getAllByRole("status", { name: "メモを表示中" }),
    ).toHaveLength(2);
    const thread = () =>
      within(screen.getByRole("list", { name: "メモの履歴" }));
    expect(thread().queryByText("最初のメモ")).toBeNull();
    act(() => vi.advanceTimersByTime(220));
    expect(thread().getByText("最初のメモ")).toBeTruthy();
    expect(
      screen.getAllByRole("status", { name: "メモを表示中" }),
    ).toHaveLength(1);
    act(() => vi.advanceTimersByTime(200));
    expect(thread().getByText("次のメモ")).toBeTruthy();
    send("演出中に閉じたメモ");
    fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
    mounted.unmount();
    render(<App />);
    fireEvent.click(
      screen.getByRole("button", { name: "授業の課題の詳細を開く" }),
    );
    expect(thread().getByText("演出中に閉じたメモ")).toBeTruthy();
    expect(screen.queryByRole("status", { name: "メモを表示中" })).toBeNull();
  });
  it("動きを減らす設定では点の待ち時間を省略し、すぐ本文を表示する", () => {
    motion(true);
    seed();
    render(<App />);
    fireEvent.click(
      screen.getByRole("button", { name: "授業の課題の詳細を開く" }),
    );
    send("すぐ表示するメモ");
    expect(
      within(screen.getByRole("list", { name: "メモの履歴" })).getByText(
        "すぐ表示するメモ",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("status", { name: "メモを表示中" })).toBeNull();
  });
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
      screen.queryByRole("link", { name: /Googleカレンダーに登録/ }),
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
    const link = screen.getByRole("link", { name: /Googleカレンダーに登録/ });
    expect(link.getAttribute("target")).toBe("_blank");
    expect(new URL(link.getAttribute("href")!).searchParams.get("text")).toBe(
      "【締切】レポートを提出",
    );
    expect(
      parseTodos(localStorage.getItem(STORAGE_KEY)!)[0].deadline,
    ).not.toBeNull();
  });
  it("メモをチャットとして追記し、名前・送信日時とともに永続化する。編集・削除操作はない", async () => {
    seed();
    const user = userEvent.setup();
    const initial = render(<App />);
    await user.click(
      screen.getByRole("button", { name: "授業の課題の詳細を開く" }),
    );
    const input = screen.getByRole("textbox", { name: "メモを入力" });
    expect(screen.getByRole("button", { name: "送信" })).toHaveProperty(
      "disabled",
      true,
    );
    await user.type(input, "一覧画面までできた");
    await user.click(screen.getByRole("button", { name: "送信" }));
    expect(input).toHaveProperty("value", "");
    await user.type(input, "モーダルも完成");
    await user.keyboard("{Control>}{Enter}{/Control}");
    const stored = parseTodos(localStorage.getItem(STORAGE_KEY)!)[0].notes;
    expect(stored.map((n) => n.text)).toEqual([
      "一覧画面までできた",
      "モーダルも完成",
    ]);
    initial.unmount();
    render(<App />);
    await user.click(
      screen.getByRole("button", { name: "授業の課題の詳細を開く" }),
    );
    const thread = screen.getByRole("list", { name: "メモの履歴" });
    const messages = within(thread).getAllByRole("listitem");
    expect(messages).toHaveLength(2);
    for (let i = 0; i < messages.length; i++) {
      expect(within(messages[i]).getByText("自分")).toBeTruthy();
      expect(messages[i].querySelector("time")?.getAttribute("dateTime")).toBe(
        stored[i].createdAt,
      );
      expect(within(messages[i]).getByText(stored[i].text)).toBeTruthy();
    }
    expect(screen.queryByRole("button", { name: "メモを編集" })).toBeNull();
    expect(screen.queryByRole("button", { name: "メモを削除" })).toBeNull();
  });
  it("未送信メモを閉じる前に確認し、入力を続けられる", async () => {
    seed();
    const user = userEvent.setup();
    render(<App />);
    await user.click(
      screen.getByRole("button", { name: "授業の課題の詳細を開く" }),
    );
    await user.type(
      screen.getByRole("textbox", { name: "メモを入力" }),
      "送信前のメモ",
    );
    await user.click(screen.getByRole("button", { name: "閉じる" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "入力を続ける",
      }),
    );
    expect(screen.getByRole("textbox", { name: "メモを入力" })).toHaveProperty(
      "value",
      "送信前のメモ",
    );
    expect(
      parseTodos(localStorage.getItem(STORAGE_KEY)!)[0].notes,
    ).toHaveLength(0);
  });
  it("期限なしの場合はカレンダー操作から期限の編集へ進める", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      serializeTodos([{ ...task(), deadline: null }]),
    );
    const user = userEvent.setup();
    render(<App />);
    await user.click(
      screen.getByRole("button", { name: "授業の課題の詳細を開く" }),
    );
    expect(
      screen.queryByRole("link", { name: /Googleカレンダーに登録/ }),
    ).toBeNull();
    await user.click(screen.getByRole("button", { name: "TODOを編集" }));
    expect(screen.getByLabelText("期限を設定しない")).toHaveProperty(
      "checked",
      true,
    );
    await user.click(screen.getByRole("button", { name: "キャンセル" }));
    await user.click(screen.getByRole("button", { name: "期限を設定" }));
    expect(screen.getByLabelText("期限を設定しない")).toHaveProperty(
      "checked",
      false,
    );
    expect(screen.getByLabelText("期限")).toBeTruthy();
  });
  it("キャッチコピーやサンプル操作を表示しない", () => {
    render(<App />);
    for (const copy of [
      "今日も、ひとつずつ。",
      "やることと、その続き。",
      "ONE STEP AT A TIME",
      "小さな一歩も、",
      "マイワークスペース",
    ])
      expect(screen.queryByText(copy)).toBeNull();
    expect(screen.queryByRole("button", { name: /サンプル/ })).toBeNull();
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
      screen.getByLabelText("メモを入力"),
      "保存できないときも残る",
    );
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    await user.click(screen.getByRole("button", { name: "送信" }));
    expect(screen.getByLabelText("メモを入力")).toHaveProperty(
      "value",
      "保存できないときも残る",
    );
    expect(
      within(screen.getByRole("dialog")).getByRole("alert").textContent,
    ).toContain("保存できませんでした");
    expect(screen.queryByText("送信しました")).toBeNull();
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

describe("期限超過メニュー", () => {
  it("すべてのTODOと未完了の間に表示し、件数と表示対象を未完了の期限超過に絞る", async () => {
    const past = new Date(Date.now() - 60000).toISOString();
    const future = new Date(Date.now() + 3600000).toISOString();
    localStorage.setItem(
      STORAGE_KEY,
      serializeTodos([
        { ...task(), id: "expired", title: "期限超過の課題", deadline: past },
        {
          ...task(),
          id: "finished",
          title: "完了済みの課題",
          deadline: past,
          status: "done",
        },
        { ...task(), id: "none", title: "期限なしの課題", deadline: null },
        { ...task(), id: "later", title: "これからの課題", deadline: future },
      ]),
    );
    const user = userEvent.setup();
    render(<App />);
    const nav = within(screen.getByRole("navigation", { name: "TODOの表示" }));
    const buttons = nav.getAllByRole("button");
    expect(buttons.slice(0, 3).map((b) => b.textContent)).toEqual([
      "すべてのTODO4",
      "期限超過1",
      "未完了3",
    ]);
    await user.click(nav.getByRole("button", { name: /^期限超過/ }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "期限超過1",
    );
    expect(
      screen.getByRole("button", { name: "期限超過の課題の詳細を開く" }),
    ).toBeTruthy();
    for (const title of ["完了済みの課題", "期限なしの課題", "これからの課題"])
      expect(
        screen.queryByRole("button", { name: title + "の詳細を開く" }),
      ).toBeNull();
  });
});

describe("直近の期限の表示", () => {
  it("優先度順でも直近の期限を示し、そのTODOを完了すると次の期限へ移る", async () => {
    const current = Date.now();
    const soon = {
      ...task(),
      id: "soon",
      title: "直近の課題",
      priority: "low" as const,
      deadline: new Date(current + 3600000).toISOString(),
    };
    const later = {
      ...task(),
      id: "later",
      title: "次の課題",
      priority: "high" as const,
      deadline: new Date(current + 7200000).toISOString(),
    };
    localStorage.setItem(STORAGE_KEY, serializeTodos([soon, later]));
    const user = userEvent.setup();
    render(<App />);
    const soonButton = () =>
      screen.getByRole("button", { name: "直近の課題の詳細を開く" });
    const laterButton = () =>
      screen.getByRole("button", { name: "次の課題の詳細を開く" });
    expect(soonButton().getAttribute("aria-description")).toBe("直近の期限");
    expect(laterButton().getAttribute("aria-description")).toBeNull();
    await user.selectOptions(screen.getByLabelText("並べ替え"), "priority");
    expect(soonButton().getAttribute("aria-description")).toBe("直近の期限");
    await user.click(soonButton());
    await user.selectOptions(screen.getByLabelText("状態"), "done");
    await user.click(screen.getByRole("button", { name: "閉じる" }));
    expect(soonButton().getAttribute("aria-description")).toBeNull();
    expect(laterButton().getAttribute("aria-description")).toBe("直近の期限");
  });
});

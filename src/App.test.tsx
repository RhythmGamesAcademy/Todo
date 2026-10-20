// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { messages } from "./messages";
import type { Todo, TodoDraft } from "./model";

const session = { token: "token-1", userId: "me", name: "自分" };
const defaultUsers = [
  { id: "me", name: "自分", createdAt: "2026-10-01T00:00:00.000Z" },
  { id: "other", name: "佐藤", createdAt: "2026-10-01T00:00:00.000Z" },
];

const ctrl = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  return {
    board: null as unknown,
    boot: { token: null as string | null, session: null as unknown },
    writes: [] as unknown[],
    listeners,
    notify() {
      listeners.forEach((listener) => listener());
    },
  };
});

vi.mock("./cloud/session", () => ({
  resolveSession: () => ctrl.boot,
  writeSession: (value: unknown) => {
    ctrl.writes.push(value);
  },
}));

vi.mock("./cloud/useBoard", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useBoard: () => {
      useSyncExternalStore(
        (listener: () => void) => {
          ctrl.listeners.add(listener);
          return () => ctrl.listeners.delete(listener);
        },
        () => ctrl.board,
      );
      return ctrl.board;
    },
  };
});

vi.mock("./screens/LoginScreen", async () => {
  const { jsx } = await import("react/jsx-runtime");
  return {
    LoginScreen: ({
      prefillToken,
      onJoined,
    }: {
      prefillToken: string | null;
      onJoined: (value: unknown) => void;
    }) =>
      jsx("div", {
        children: [
          jsx("h1", { children: "ログイン画面" }, "title"),
          jsx(
            "p",
            { "data-testid": "prefill", children: prefillToken ?? "none" },
            "prefill",
          ),
          jsx(
            "button",
            {
              type: "button",
              onClick: () =>
                onJoined({
                  token: "joined",
                  userId: "joined-user",
                  name: "参加者",
                }),
              children: "参加する",
            },
            "join",
          ),
        ],
      }),
  };
});

const task = (extra: Partial<Todo> = {}): Todo => ({
  id: "task",
  title: "授業の課題",
  description: "TODOアプリを作る",
  deadline: "2026-10-30T10:00:00.000Z",
  priority: "high",
  status: "doing",
  assigneeId: null,
  createdAt: "2026-10-18T00:00:00.000Z",
  updatedAt: "2026-10-18T00:00:00.000Z",
  notes: [],
  ...extra,
});

let board: any;
let undoStore = new Map<string, Todo>();

function commit(next: Todo[]) {
  board = { ...board, state: { ...board.state, todos: next } };
  ctrl.board = board;
  ctrl.notify();
}

function setBoard(next: unknown) {
  board = next;
  ctrl.board = next;
  ctrl.notify();
}

function setTodos(next: Todo[]) {
  commit(next);
}

function ready(todos: Todo[], overrides: Record<string, unknown> = {}) {
  undoStore = new Map();
  let sequence = 0;
  const timestamp = "2026-10-20T00:00:00.000Z";
  board = {
    phase: "ready",
    state: {
      list: { id: "list", title: "共有リスト", revision: 1 },
      users: defaultUsers,
      todos,
      activities: [],
    },
    me: session,
    refresh: vi.fn(),
    addTodo: vi.fn(async (draft: TodoDraft) => {
      sequence += 1;
      commit([
        ...board.state.todos,
        {
          ...draft,
          id: "created-" + sequence,
          notes: [],
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ]);
    }),
    updateTodo: vi.fn(async (id: string, patch: Partial<TodoDraft>) => {
      commit(
        board.state.todos.map((todo: Todo) =>
          todo.id === id ? { ...todo, ...patch, updatedAt: timestamp } : todo,
        ),
      );
    }),
    removeTodo: vi.fn(async (id: string) => {
      const found = board.state.todos.find((todo: Todo) => todo.id === id);
      if (found) undoStore.set(id, found);
      commit(board.state.todos.filter((todo: Todo) => todo.id !== id));
    }),
    undoRemove: vi.fn(async (id: string) => {
      const found = undoStore.get(id);
      if (found && !board.state.todos.some((todo: Todo) => todo.id === id))
        commit([...board.state.todos, found]);
    }),
    addMemo: vi.fn(async (todoId: string, body: string) => {
      sequence += 1;
      commit(
        board.state.todos.map((todo: Todo) =>
          todo.id === todoId
            ? {
                ...todo,
                notes: [
                  ...todo.notes,
                  { id: "memo-" + sequence, text: body, createdAt: timestamp },
                ],
                updatedAt: timestamp,
              }
            : todo,
        ),
      );
    }),
    setAssignee: vi.fn(async (id: string, assigneeId: string | null) => {
      commit(
        board.state.todos.map((todo: Todo) =>
          todo.id === id ? { ...todo, assigneeId, updatedAt: timestamp } : todo,
        ),
      );
    }),
    renameBoard: vi.fn(async () => {}),
    removeBoard: vi.fn(async () => {}),
    renameMember: vi.fn(async () => {}),
    removeMember: vi.fn(async () => {}),
    ...overrides,
  };
  ctrl.board = board;
  ctrl.notify();
  return board;
}

beforeEach(() => {
  localStorage.clear();
  ctrl.writes.length = 0;
  ctrl.boot = { token: null, session };
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
  ready([]);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("一覧の表示形式", () => {
  it("簡潔表示は必要な項目だけを表示し、検索・並び順を維持して詳細を開く。表示形式を再読み込み後も保つ", async () => {
    ready([
      task({
        notes: [
          {
            id: "memo",
            text: "一覧には不要な進捗メモ",
            createdAt: "2026-10-18T00:00:00.000Z",
          },
        ],
      }),
    ]);
    const user = userEvent.setup();
    const mounted = render(<App />);
    await user.type(
      screen.getByRole("searchbox", { name: messages.search.label }),
      "授業",
    );
    await user.selectOptions(
      screen.getByLabelText(messages.search.sort),
      "priority",
    );
    await user.click(
      screen.getByRole("button", { name: messages.layout.compact }),
    );
    const row = screen.getByRole("button", { name: "授業の課題の詳細を開く" });
    expect(row.classList.contains("todo-compact")).toBe(true);
    expect(within(row).getByText("TODOアプリを作る")).toBeTruthy();
    expect(within(row).getByText("優先度 高")).toBeTruthy();
    expect(within(row).queryByText("進行中")).toBeNull();
    expect(within(row).queryByText("一覧には不要な進捗メモ")).toBeNull();
    expect(within(row).queryByText("詳細を開く")).toBeNull();
    expect(row.querySelector(".card-date")?.textContent).toContain("10月30日");
    expect(
      screen.getByRole("searchbox", { name: messages.search.label }),
    ).toHaveProperty("value", "授業");
    expect(screen.getByLabelText(messages.search.sort)).toHaveProperty(
      "value",
      "priority",
    );
    await user.click(row);
    expect(screen.getByRole("dialog")).toBeTruthy();
    await user.click(
      screen.getByRole("button", { name: messages.common.close }),
    );
    mounted.unmount();
    render(<App />);
    expect(
      screen
        .getByRole("button", { name: messages.layout.compact })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    await user.click(
      screen.getByRole("button", { name: messages.layout.cards }),
    );
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
  it("送信したメモが点から本文へ変わり、失敗時は入力を残す", async () => {
    vi.useFakeTimers();
    motion(false);
    ready([task()]);
    render(<App />);
    fireEvent.click(
      screen.getByRole("button", { name: "授業の課題の詳細を開く" }),
    );
    fireEvent.change(screen.getByLabelText("メモを入力"), {
      target: { value: "最初のメモ" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "送信" }));
    });
    expect(board.addMemo).toHaveBeenCalledWith("task", "最初のメモ");
    expect(screen.getByRole("status", { name: "メモを表示中" })).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(420);
    });
    expect(
      within(screen.getByRole("list", { name: "メモの履歴" })).getByText(
        "最初のメモ",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("status", { name: "メモを表示中" })).toBeNull();
  });
});

describe("利用者の操作", () => {
  it("優先度は左から低・中・高の順で選べて、選んだ値で保存する", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "新しいTODO" }));
    const radios = within(
      screen.getByRole("group", { name: "優先度" }),
    ).getAllByRole("radio");
    expect(radios.map((r) => (r as HTMLInputElement).value)).toEqual([
      "low",
      "medium",
      "high",
    ]);
    await user.type(screen.getByLabelText(/^タイトル/), "低い優先度の課題");
    fireEvent.change(screen.getByLabelText("期限"), {
      target: { value: "2026-10-30T23:59" },
    });
    await user.click(radios[0]);
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "TODOを作成",
      }),
    );
    await waitFor(() => expect(board.addTodo).toHaveBeenCalledTimes(1));
    expect(board.addTodo.mock.calls[0][0].priority).toBe("low");
    expect(board.state.todos[0].priority).toBe("low");
  });
  it("送信ボタンは入力欄へフォーカスを戻さず、キーボードショートカットは入力を続けられる", async () => {
    ready([task()]);
    const user = userEvent.setup();
    render(<App />);
    await user.click(
      screen.getByRole("button", { name: "授業の課題の詳細を開く" }),
    );
    const input = screen.getByLabelText("メモを入力");
    await user.type(input, "ボタンから送信");
    await user.click(screen.getByRole("button", { name: "送信" }));
    expect(document.activeElement).not.toBe(input);
    await waitFor(() => expect(board.addMemo).toHaveBeenCalledTimes(1));
    await user.type(input, "キーボードから送信");
    await user.keyboard("{Control>}{Enter}{/Control}");
    expect(document.activeElement).toBe(input);
    await waitFor(() => expect(board.addMemo).toHaveBeenCalledTimes(2));
    expect(board.addMemo.mock.calls.map((call: unknown[]) => call[1])).toEqual([
      "ボタンから送信",
      "キーボードから送信",
    ]);
  });
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
    expect(board.addTodo).not.toHaveBeenCalled();
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
    await waitFor(() => expect(board.addTodo).toHaveBeenCalledTimes(1));
    expect(board.addTodo.mock.calls[0][0].deadline).toBeNull();
    expect(
      screen.getByRole("button", { name: "本を読むの詳細を開く" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("link", { name: /Googleカレンダーに登録/ }),
    ).toBeNull();
  });
  it("期限を持つTODOを作成し、詳細で登録用リンクを表示する", async () => {
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
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "レポートを提出の詳細を開く" }),
      ).toBeTruthy(),
    );
    await user.click(
      screen.getByRole("button", { name: "レポートを提出の詳細を開く" }),
    );
    const link = screen.getByRole("link", { name: /Googleカレンダーに登録/ });
    expect(link.getAttribute("target")).toBe("_blank");
    expect(new URL(link.getAttribute("href")!).searchParams.get("text")).toBe(
      "【締切】レポートを提出",
    );
    expect(board.addTodo.mock.calls[0][0].deadline).not.toBeNull();
  });
  it("メモをチャットとして追記し、名前・送信日時とともに残す。編集・削除操作はない", async () => {
    ready([task()]);
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
    await waitFor(() => expect(input).toHaveProperty("value", ""));
    await user.type(input, "モーダルも完成");
    await user.keyboard("{Control>}{Enter}{/Control}");
    await waitFor(() =>
      expect(
        board.state.todos[0].notes.map((note: { text: string }) => note.text),
      ).toEqual(["一覧画面までできた", "モーダルも完成"]),
    );
    initial.unmount();
    render(<App />);
    await user.click(
      screen.getByRole("button", { name: "授業の課題の詳細を開く" }),
    );
    const thread = screen.getByRole("list", { name: "メモの履歴" });
    const items = within(thread).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    for (let i = 0; i < items.length; i++) {
      expect(within(items[i]).getByText("自分")).toBeTruthy();
      expect(
        items[i].querySelector("time")?.getAttribute("dateTime"),
      ).toBeTruthy();
    }
    expect(screen.queryByRole("button", { name: "メモを編集" })).toBeNull();
    expect(screen.queryByRole("button", { name: "メモを削除" })).toBeNull();
  });
  it("未送信メモを閉じる前に確認し、入力を続けられる", async () => {
    ready([task()]);
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
    expect(board.addMemo).not.toHaveBeenCalled();
  });
  it("期限なしの場合はカレンダー操作から期限の編集へ進める", async () => {
    ready([task({ deadline: null })]);
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
    expect(board.addTodo).not.toHaveBeenCalled();
  });
  it("保存失敗時はメモ入力を消さず、成功したと表示しない", async () => {
    ready([task()], {
      addMemo: vi.fn().mockRejectedValue(new Error("offline")),
    });
    const user = userEvent.setup();
    render(<App />);
    await user.click(
      screen.getByRole("button", { name: "授業の課題の詳細を開く" }),
    );
    await user.type(
      screen.getByLabelText("メモを入力"),
      "保存できないときも残る",
    );
    await user.click(screen.getByRole("button", { name: "送信" }));
    await waitFor(() =>
      expect(screen.getByLabelText("メモを入力")).toHaveProperty(
        "value",
        "保存できないときも残る",
      ),
    );
    expect(
      within(screen.getByRole("dialog")).getByRole("alert").textContent,
    ).toContain(messages.errors.api.general);
    expect(screen.queryByText(messages.chat.sent)).toBeNull();
    expect(board.state.todos[0].notes).toHaveLength(0);
  });
  it("削除の確認後に削除し、取り消すと復元を呼ぶ", async () => {
    ready([
      task({
        notes: [
          {
            id: "note",
            text: "残すメモ",
            createdAt: "2026-10-18T00:00:00.000Z",
          },
        ],
      }),
    ]);
    const user = userEvent.setup();
    render(<App />);
    await user.click(
      screen.getByRole("button", { name: "授業の課題の詳細を開く" }),
    );
    await user.click(screen.getByRole("button", { name: "TODOを削除" }));
    expect(board.removeTodo).not.toHaveBeenCalled();
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "TODOを削除",
      }),
    );
    await waitFor(() => expect(board.removeTodo).toHaveBeenCalledWith("task"));
    expect(board.state.todos).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "元に戻す" }));
    await waitFor(() => expect(board.undoRemove).toHaveBeenCalledWith("task"));
    expect(board.state.todos[0].notes[0].text).toBe("残すメモ");
    expect(screen.getByText(messages.todo.restored)).toBeTruthy();
  });
  it("担当者の絞り込みが効き、カードに名前を表示する。削除済みは不明と表示する", async () => {
    ready([
      task({ id: "mine", title: "自分の課題", assigneeId: "me" }),
      task({ id: "other", title: "佐藤の課題", assigneeId: "other" }),
      task({ id: "none", title: "未割当の課題", assigneeId: null }),
      task({ id: "ghost", title: "削除済みの課題", assigneeId: "ghost" }),
    ]);
    const user = userEvent.setup();
    render(<App />);
    expect(
      within(
        screen.getByRole("button", { name: "自分の課題の詳細を開く" }),
      ).getByText("自分"),
    ).toBeTruthy();
    expect(
      within(
        screen.getByRole("button", { name: "削除済みの課題の詳細を開く" }),
      ).getByText(messages.todo.assigneeUnknown),
    ).toBeTruthy();
    await user.selectOptions(screen.getByLabelText("担当者"), "other");
    expect(
      screen.queryByRole("button", { name: "自分の課題の詳細を開く" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "佐藤の課題の詳細を開く" }),
    ).toBeTruthy();
    await user.selectOptions(screen.getByLabelText("担当者"), "none");
    expect(
      screen.getByRole("button", { name: "未割当の課題の詳細を開く" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "佐藤の課題の詳細を開く" }),
    ).toBeNull();
    await user.selectOptions(screen.getByLabelText("担当者"), "any");
    expect(
      screen.getAllByRole("button", { name: /の詳細を開く$/ }),
    ).toHaveLength(4);
  });
  it("作成時に担当者を選ぶとその担当者で保存する", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "新しいTODO" }));
    await user.type(screen.getByLabelText(/^タイトル/), "担当者付きの課題");
    fireEvent.change(screen.getByLabelText("期限"), {
      target: { value: "2026-10-30T23:59" },
    });
    await user.selectOptions(
      within(screen.getByRole("dialog")).getByLabelText("担当者"),
      "other",
    );
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "TODOを作成",
      }),
    );
    await waitFor(() => expect(board.addTodo).toHaveBeenCalledTimes(1));
    expect(board.addTodo.mock.calls[0][0].assigneeId).toBe("other");
    expect(
      within(
        screen.getByRole("button", {
          name: "担当者付きの課題の詳細を開く",
        }),
      ).getByText("佐藤"),
    ).toBeTruthy();
  });
  it("詳細を開いたままボードからTODOが消えたらモーダルを閉じる", async () => {
    ready([task()]);
    const user = userEvent.setup();
    render(<App />);
    await user.click(
      screen.getByRole("button", { name: "授業の課題の詳細を開く" }),
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
    act(() => setTodos([]));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("接続状態", () => {
  it("セッションがないときは参加画面へトークンを渡す", async () => {
    ctrl.boot = { token: "invite-token", session: null };
    setBoard({ phase: "login" });
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getByRole("heading", { name: "ログイン画面" })).toBeTruthy();
    expect(screen.getByTestId("prefill").textContent).toBe("invite-token");
    await user.click(screen.getByRole("button", { name: "参加する" }));
    expect(ctrl.writes).toContainEqual({
      token: "joined",
      userId: "joined-user",
      name: "参加者",
    });
    expect(screen.getByTestId("prefill").textContent).toBe("none");
  });
  it("読み込み中は待機表示を出す", () => {
    setBoard({ phase: "loading" });
    render(<App />);
    expect(screen.getByRole("status").textContent).toContain(
      messages.board.loading,
    );
  });
  it("読み込み失敗時は再試行できる", async () => {
    const refresh = vi.fn();
    setBoard({
      phase: "error",
      message: messages.errors.api.general,
      retryable: true,
      refresh,
    });
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getByRole("alert").textContent).toContain(
      messages.errors.api.general,
    );
    await user.click(
      screen.getByRole("button", { name: messages.common.retry }),
    );
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe("期限超過メニュー", () => {
  it("すべてのTODOと未完了の間に表示し、件数と表示対象を未完了の期限超過に絞る", async () => {
    const past = new Date(Date.now() - 60000).toISOString();
    const future = new Date(Date.now() + 3600000).toISOString();
    ready([
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
    ]);
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
    ready([soon, later]);
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
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
        messages.filters.heading.active + "1",
      ),
    );
    expect(
      screen.queryByRole("button", {
        name: messages.todo.openLabel(soon.title),
      }),
    ).toBeNull();
    expect(laterButton().getAttribute("aria-description")).toBe("直近の期限");
  });
});

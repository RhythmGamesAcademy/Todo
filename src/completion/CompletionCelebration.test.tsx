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
import App from "../App";
import { messages } from "../messages";
import type { Todo } from "../model";

const TEST_STORAGE_KEY = "hitotsuzutsu.completion-test.v1";
const readStored = (): Todo[] => {
  const raw = localStorage.getItem(TEST_STORAGE_KEY);
  return raw ? (JSON.parse(raw) as Todo[]) : [];
};
const writeStored = (todos: Todo[]) => {
  localStorage.setItem(TEST_STORAGE_KEY, JSON.stringify(todos));
};

const remote = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  return {
    version: 0,
    listeners,
    notify() {
      this.version += 1;
      listeners.forEach((listener) => listener());
    },
  };
});

vi.mock("../cloud/useBoard", async () => {
  const { useSyncExternalStore } = await import("react");
  const key = "hitotsuzutsu.completion-test.v1";
  const removed = new Map<string, Todo>();
  const now = () => new Date().toISOString();
  const read = (): Todo[] => {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Todo[]) : [];
  };
  const write = (todos: Todo[]) => {
    localStorage.setItem(key, JSON.stringify(todos));
    remote.notify();
  };
  return {
    useBoard: () => {
      useSyncExternalStore(
        (listener: () => void) => {
          remote.listeners.add(listener);
          return () => remote.listeners.delete(listener);
        },
        () => remote.version,
      );
      const todos = read();
      return {
        phase: "ready",
        state: {
          list: { id: "list", title: "共有リスト", revision: 1 },
          users: [
            {
              id: "me",
              name: "自分",
              createdAt: "2026-10-19T00:00:00Z",
            },
          ],
          todos,
          activities: [],
        },
        me: { token: "token", userId: "me", name: "自分" },
        refresh: () => {},
        addTodo: async (draft: Todo) => {
          const timestamp = now();
          write([
            ...todos,
            {
              ...draft,
              id: crypto.randomUUID(),
              subtasks: [],
              notes: [],
              createdAt: timestamp,
              updatedAt: timestamp,
            },
          ]);
        },
        updateTodo: async (id: string, patch: Partial<Todo>) => {
          write(
            todos.map((todo) =>
              todo.id === id ? { ...todo, ...patch, updatedAt: now() } : todo,
            ),
          );
        },
        removeTodo: async (id: string) => {
          const found = todos.find((todo) => todo.id === id);
          if (found) removed.set(id, found);
          write(todos.filter((todo) => todo.id !== id));
        },
        undoRemove: async (id: string) => {
          const found = removed.get(id);
          if (found && !read().some((todo) => todo.id === id))
            write([...read(), found]);
        },
        addMemo: async (todoId: string, body: string) => {
          const timestamp = now();
          write(
            todos.map((todo) =>
              todo.id === todoId
                ? {
                    ...todo,
                    subtasks: [],
                    notes: [
                      ...todo.notes,
                      {
                        id: crypto.randomUUID(),
                        text: body,
                        createdAt: timestamp,
                        userId: "me",
                      },
                    ],
                    updatedAt: timestamp,
                  }
                : todo,
            ),
          );
        },
        setAssignee: async (id: string, assigneeId: string | null) => {
          write(
            todos.map((todo) =>
              todo.id === id ? { ...todo, assigneeId, updatedAt: now() } : todo,
            ),
          );
        },
        renameBoard: async () => {},
        removeBoard: async () => {},
        renameMember: async () => {},
        removeMember: async () => {},
      };
    },
  };
});

interface Play {
  frames: Keyframe[];
  finish: () => void;
  cancel: ReturnType<typeof vi.fn>;
  setKeyframes: ReturnType<typeof vi.fn>;
}
let plays: Play[];
const task: Todo = {
  id: "completed-task",
  title: "提出する課題",
  description: "提出前の確認",
  status: "doing",
  priority: "medium",
  assigneeId: null,
  deadline: null,
  tags: [],
  approvalStatus: null,
  approvalReason: null,
  createdAt: "2026-10-19T00:00:00Z",
  updatedAt: "2026-10-19T00:00:00Z",
  subtasks: [],
  notes: [
    {
      id: "progress",
      text: "メモも残す",
      createdAt: "2026-10-19T00:00:00Z",
      userId: "me",
    },
  ],
};
const doneMenu = () =>
  within(
    screen.getByRole("navigation", { name: messages.app.navigation }),
  ).getByRole("button", {
    name: new RegExp("^" + messages.filters.navigation.done),
  });
const counter = () => doneMenu().querySelector(".nav-count")!;
const rect = (left: number, top: number, width: number, height: number) => ({
  left,
  top,
  width,
  height,
  x: left,
  y: top,
  right: left + width,
  bottom: top + height,
  toJSON: () => ({}),
});
let destination = rect(288, 80, 14, 18);

beforeEach(() => {
  localStorage.clear();
  writeStored([task]);
  plays = [];
  destination = rect(288, 80, 14, 18);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      if (this.classList.contains("nav-count")) return destination;
      if (this.classList.contains("completion-layer"))
        return rect(0, 0, 390, 844);
      return rect(0, 0, 0, 0);
    },
  );
  vi.stubGlobal("visualViewport", undefined);
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
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(Element.prototype, "scrollTo", {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(Element.prototype, "animate", {
    configurable: true,
    value: vi.fn((frames: Keyframe[]) => {
      let resolve!: () => void;
      let reject!: (reason: Error) => void;
      const finished = new Promise<void>((yes, no) => {
        resolve = yes;
        reject = no;
      });
      const cancel = vi.fn(() =>
        reject(new DOMException("Cancelled", "AbortError")),
      );
      const setKeyframes = vi.fn();
      plays.push({ frames, finish: resolve, cancel, setKeyframes });
      return { finished, cancel, effect: { setKeyframes } };
    }),
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(Element.prototype, "animate");
});
function openTask() {
  fireEvent.click(
    screen.getByRole("button", { name: messages.todo.openLabel(task.title) }),
  );
}
function complete() {
  fireEvent.change(screen.getByLabelText(messages.todo.state), {
    target: { value: "done" },
  });
}
async function closeTask() {
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: messages.common.close }),
    );
  });
}
async function finishPhase(index: number) {
  await act(async () => {
    plays[index].finish();
  });
}

describe("完了のトド演出", () => {
  it.each([
    { remaining: 0, tone: "green", detail: messages.completion.allDone },
    { remaining: 1, tone: "orange", detail: messages.completion.oneLeft },
    { remaining: 2, tone: "blue", detail: messages.completion.keepGoing },
  ])(
    "残り$remaining件の完了通知を$toneで表示し、通知を閉じられる",
    async ({ remaining, tone, detail }) => {
      const others = Array.from({ length: remaining }, (_, index) => ({
        ...task,
        id: "other-" + index,
        title: "other-" + index,
      }));
      writeStored([task, ...others]);
      render(<App />);
      // Starting in another filter still stages the animation on the unfinished tab.
      fireEvent.click(
        screen.getByRole("button", {
          name: new RegExp("^" + messages.filters.navigation.doing),
        }),
      );
      openTask();
      complete();
      await closeTask();
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
        messages.filters.heading.active + remaining,
      );
      fireEvent.click(
        screen.getByRole("button", { name: messages.completion.skip }),
      );
      expect(screen.getByText(messages.completion.title)).toBeTruthy();
      expect(
        screen
          .getByText(detail)
          .closest(".completion-notice")
          ?.classList.contains("completion-notice-" + tone),
      ).toBe(true);
      expect(counter().textContent).toBe("1");
      fireEvent.click(
        screen.getByRole("button", { name: messages.common.closeNotification }),
      );
      expect(screen.queryByText(messages.completion.title)).toBeNull();
    },
  );
  it("保存と一覧移動は即時、演出は詳細を閉じてから。実際の完了件数の位置へ飛び、到着時に数字が増える", async () => {
    const mounted = render(<App />);
    openTask();
    complete();
    expect(readStored()[0].status).toBe("done");
    expect(plays).toHaveLength(0);
    expect(counter().textContent).toBe("0");
    await closeTask();
    expect(plays).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      messages.filters.heading.active + "0",
    );
    expect(
      screen.queryByRole("button", {
        name: messages.todo.openLabel(task.title),
      }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: messages.completion.skip }),
    ).toBeTruthy();
    await finishPhase(0);
    await finishPhase(1);
    expect(plays[2].frames.at(-1)).toMatchObject({
      offset: 1,
      opacity: 0,
    });
    await finishPhase(2);
    expect(
      document.querySelector(".completion-swimmer")?.getAttribute("data-stage"),
    ).toBe("turn");
    expect(
      document.querySelector(".sea-lion-body")?.getAttribute("d"),
    ).toContain("M16.000 55.000");
    await finishPhase(3);
    expect(
      document.querySelector(".completion-swimmer")?.getAttribute("data-stage"),
    ).toBe("anticipate");
    await finishPhase(4);
    expect(plays).toHaveLength(6);
    // Counter center (295, 89), stage center (195, 422): no desktop/mobile constants.
    expect(plays[5].frames.at(-1)?.transform).toContain(
      "translate(100px, -333px)",
    );
    expect(counter().textContent).toBe("0");
    await finishPhase(5);
    expect(counter().textContent).toBe("1");
    expect(counter().classList.contains("nav-count-arrived")).toBe(true);
    expect(
      screen.queryByRole("button", { name: messages.completion.skip }),
    ).toBeNull();
    fireEvent.click(doneMenu());
    expect(
      screen.getByRole("button", { name: messages.todo.openLabel(task.title) }),
    ).toBeTruthy();
    expect(readStored()[0].notes).toEqual(task.notes);
    mounted.unmount();
    render(<App />);
    expect(plays).toHaveLength(6);
    expect(counter().textContent).toBe("1");
  });
  it("泳いでいる途中にメニュー位置が変わっても、画面上の新しい位置を追跡する", async () => {
    vi.useFakeTimers();
    render(<App />);
    openTask();
    complete();
    await closeTask();
    await finishPhase(0);
    await finishPhase(1);
    await finishPhase(2);
    await finishPhase(3);
    await finishPhase(4);
    destination = rect(20, 340, 14, 18);
    act(() => vi.advanceTimersByTime(64));
    const revised = plays[5].setKeyframes.mock.calls.at(-1)?.[0] as Keyframe[];
    expect(revised.at(-1)?.transform).toContain("translate(-168px, -73px)");
    await finishPhase(5);
    expect(counter().textContent).toBe("1");
  });
  it("Escで即時終了して件数を反映し、保存済みの完了状態を戻さない", async () => {
    render(<App />);
    openTask();
    complete();
    await closeTask();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(counter().textContent).toBe("1");
    expect(plays[0].cancel).toHaveBeenCalled();
    await act(async () => {
      plays[0].finish();
    });
    expect(plays).toHaveLength(1);
    expect(readStored()[0].status).toBe("done");
  });
  it("完了を取り消してから閉じた場合は演出しない", async () => {
    render(<App />);
    openTask();
    complete();
    fireEvent.change(screen.getByLabelText(messages.todo.state), {
      target: { value: "doing" },
    });
    await closeTask();
    expect(plays).toHaveLength(0);
    expect(counter().textContent).toBe("0");
    expect(
      screen.getByRole("button", { name: messages.todo.openLabel(task.title) }),
    ).toBeTruthy();
  });
  it("ブラウザーの描画が止まっても件数を待たせ続けず、時間制限で完了する", async () => {
    vi.useFakeTimers();
    render(<App />);
    openTask();
    complete();
    await closeTask();
    expect(counter().textContent).toBe("0");
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(counter().textContent).toBe("1");
    expect(
      screen.queryByRole("button", { name: messages.completion.skip }),
    ).toBeNull();
    expect(plays[0].cancel).toHaveBeenCalled();
  });
  it("保存に失敗した場合は演出や件数の増加を起こさない", async () => {
    render(<App />);
    openTask();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    complete();
    await closeTask();
    expect(plays).toHaveLength(0);
    expect(counter().textContent).toBe("0");
    expect(readStored()[0].status).toBe("doing");
  });
  it("未送信メモがある間は入力破棄の確認を保ち、入力を続けると演出は始まらない", async () => {
    render(<App />);
    openTask();
    fireEvent.change(screen.getByLabelText(messages.chat.input), {
      target: { value: "送る前のメモ" },
    });
    complete();
    await closeTask();
    const confirmation = screen.getByRole("alertdialog");
    fireEvent.click(
      within(confirmation).getByRole("button", { name: messages.discard.keep }),
    );
    expect(screen.getByLabelText(messages.chat.input)).toHaveProperty(
      "value",
      "送る前のメモ",
    );
    expect(plays).toHaveLength(0);
  });
});

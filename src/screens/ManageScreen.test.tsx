// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ManageScreen } from "./ManageScreen";
import type { ManageScreenProps } from "./ManageScreen";
import { messages } from "../messages";
import type { Todo } from "../model";
import type { CloudState, CloudUser } from "../cloud/types";

const me: CloudUser = {
  id: "me",
  name: "自分",
  createdAt: "2026-10-01T00:00:00.000Z",
};
const other: CloudUser = {
  id: "other",
  name: "佐藤",
  createdAt: "2026-10-02T00:00:00.000Z",
};

const todo = (extra: Partial<Todo>): Todo => ({
  id: "todo",
  title: "課題",
  description: "",
  deadline: null,
  priority: "medium",
  status: "todo",
  assigneeId: null,
  createdAt: "2026-10-03T00:00:00.000Z",
  updatedAt: "2026-10-03T00:00:00.000Z",
  notes: [],
  ...extra,
});

const state: CloudState = {
  list: { id: "list", title: "共有リスト", revision: 4 },
  users: [me, other],
  todos: [
    todo({ id: "t1", assigneeId: "other" }),
    todo({ id: "t2", assigneeId: "other" }),
    todo({ id: "t3", assigneeId: "me" }),
    todo({ id: "t4", assigneeId: null }),
  ],
  activities: [],
};

function setup(overrides: Partial<ManageScreenProps> = {}) {
  const props: ManageScreenProps = {
    state,
    meId: "me",
    token: "token-1",
    ask: vi.fn(async () => false),
    onRenameList: vi.fn(async () => true),
    onRemoveList: vi.fn(async () => true),
    onRenameMember: vi.fn(async () => true),
    onRemoveMember: vi.fn(async () => true),
    onSessionLost: vi.fn(),
    onNotify: vi.fn(),
    onOpenData: vi.fn(),
    ...overrides,
  };
  render(<ManageScreen {...props} />);
  return props;
}

function memberRow(name: string) {
  return screen
    .getByLabelText(messages.manage.memberNameLabel(name))
    .closest("li") as HTMLElement;
}

afterEach(cleanup);

describe("管理画面", () => {
  it("メンバー名は変更したときだけ renameMember に渡す", async () => {
    const user = userEvent.setup();
    const props = setup();
    const row = memberRow("佐藤");
    const save = within(row).getByRole("button", {
      name: messages.manage.save,
    });
    expect(save).toHaveProperty("disabled", true);
    await user.click(save);
    expect(props.onRenameMember).not.toHaveBeenCalled();

    const input = within(row).getByLabelText(
      messages.manage.memberNameLabel("佐藤"),
    );
    await user.clear(input);
    await user.type(input, "佐藤（改）");
    await user.click(save);
    await waitFor(() =>
      expect(props.onRenameMember).toHaveBeenCalledWith("other", "佐藤（改）"),
    );
    expect(props.onRenameMember).toHaveBeenCalledTimes(1);
  });

  it("リスト名は変更したときだけ renameList に渡す", async () => {
    const user = userEvent.setup();
    const props = setup();
    const save = within(
      screen
        .getByRole("textbox", { name: messages.manage.listTitleLabel })
        .closest("form") as HTMLElement,
    ).getByRole("button", { name: messages.manage.save });
    expect(save).toHaveProperty("disabled", true);
    await user.click(save);
    expect(props.onRenameList).not.toHaveBeenCalled();

    const input = screen.getByRole("textbox", {
      name: messages.manage.listTitleLabel,
    });
    await user.type(input, "（改）");
    await user.click(save);
    await waitFor(() =>
      expect(props.onRenameList).toHaveBeenCalledWith("共有リスト（改）"),
    );
  });

  it("リスト削除は警告の確認後、2回目の確認で初めて実行する", async () => {
    const user = userEvent.setup();
    let resolveSecond: ((value: boolean) => void) | undefined;
    const ask = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            resolveSecond = resolve;
          }),
      );
    const props = setup({ ask });
    await user.click(
      screen.getByRole("button", { name: messages.manage.deleteList }),
    );
    await waitFor(() => expect(ask).toHaveBeenCalledTimes(2));
    expect(ask.mock.calls[0][0].description).toBe(
      messages.manage.deleteListWarning,
    );
    expect(ask.mock.calls[1][0].description).toBe(
      messages.manage.deleteListConfirmDescription,
    );
    expect(props.onRemoveList).not.toHaveBeenCalled();

    await act(async () => {
      resolveSecond?.(true);
    });
    await waitFor(() => expect(props.onRemoveList).toHaveBeenCalledTimes(1));
    expect(props.onSessionLost).toHaveBeenCalledTimes(1);
  });

  it("共有URLは #token= 形式で、コピーできる", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const props = setup();
    const input = screen.getByRole("textbox", {
      name: messages.manage.shareLabel,
    }) as HTMLInputElement;
    expect(input.value).toMatch(/#token=token-1$/);

    await user.click(
      screen.getByRole("button", { name: messages.manage.copyShare }),
    );
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(input.value));
    expect(props.onNotify).toHaveBeenCalledWith(messages.manage.copied);
  });

  it("自分の削除に成功したときだけ session を失効させる", async () => {
    const user = userEvent.setup();
    const props = setup({ ask: vi.fn(async () => true) });
    await user.click(
      within(memberRow("自分")).getByRole("button", {
        name: messages.manage.removeMember,
      }),
    );
    await waitFor(() =>
      expect(props.onRemoveMember).toHaveBeenCalledWith("me"),
    );
    expect(props.onSessionLost).toHaveBeenCalledTimes(1);
  });

  it("自分の削除に失敗したときは session を失効させない", async () => {
    const user = userEvent.setup();
    const props = setup({
      ask: vi.fn(async () => true),
      onRemoveMember: vi.fn(async () => false),
    });
    await user.click(
      within(memberRow("自分")).getByRole("button", {
        name: messages.manage.removeMember,
      }),
    );
    await waitFor(() =>
      expect(props.onRemoveMember).toHaveBeenCalledWith("me"),
    );
    expect(props.onSessionLost).not.toHaveBeenCalled();
  });
});

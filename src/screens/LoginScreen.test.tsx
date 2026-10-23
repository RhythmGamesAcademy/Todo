// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError, createList, join } from "../cloud/client";
import type { Session } from "../cloud/session";
import { writeSession } from "../cloud/session";
import { messages } from "../messages";
import { LoginScreen } from "./LoginScreen";

vi.mock("../cloud/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../cloud/client")>();
  return { ...actual, createList: vi.fn(), join: vi.fn() };
});

vi.mock("../cloud/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../cloud/session")>();
  return { ...actual, writeSession: vi.fn() };
});

const createListMock = vi.mocked(createList);
const joinMock = vi.mocked(join);
const writeSessionMock = vi.mocked(writeSession);

const session: Session = { token: "tok-1", userId: "user-1", name: "はる" };

const tokenInput = () =>
  screen.getByLabelText(messages.login.joinToken) as HTMLInputElement;
const joinNameInput = () =>
  screen.getByLabelText(messages.login.joinName) as HTMLInputElement;

beforeEach(() => {
  localStorage.clear();
  createListMock.mockReset();
  joinMock.mockReset();
  writeSessionMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ログイン・参加画面", () => {
  it("参加に成功するとセッションを保存してから onJoined を呼ぶ", async () => {
    joinMock.mockResolvedValue(session);
    const calls: string[] = [];
    writeSessionMock.mockImplementation(() => {
      calls.push("write");
    });
    const onJoined = vi.fn((joined: Session) => {
      calls.push("joined:" + joined.userId);
    });
    const user = userEvent.setup();
    render(<LoginScreen prefillToken={null} onJoined={onJoined} />);

    await user.type(tokenInput(), " tok-1 ");
    await user.type(joinNameInput(), "はる");
    await user.click(
      screen.getByRole("button", { name: messages.login.joinAction }),
    );

    await waitFor(() => expect(onJoined).toHaveBeenCalledTimes(1));
    expect(joinMock).toHaveBeenCalledWith("tok-1", "はる");
    expect(onJoined).toHaveBeenCalledWith(session);
    expect(writeSessionMock).toHaveBeenCalledWith(session);
    expect(calls).toEqual(["write", "joined:user-1"]);
  });

  it("prefillToken が共有トークンの既定値になる", () => {
    render(<LoginScreen prefillToken="invited-token" onJoined={vi.fn()} />);

    expect(tokenInput().value).toBe("invited-token");
  });

  it("作成では createList のあとに返されたトークンで join する", async () => {
    const calls: string[] = [];
    createListMock.mockImplementation(async () => {
      calls.push("create");
      return { token: "new-token" };
    });
    joinMock.mockImplementation(async (token: string, name: string) => {
      calls.push("join:" + token);
      return { token, userId: "user-9", name };
    });
    writeSessionMock.mockImplementation(() => {
      calls.push("write");
    });
    const onJoined = vi.fn(() => {
      calls.push("joined");
    });
    const user = userEvent.setup();
    render(<LoginScreen prefillToken={null} onJoined={onJoined} />);

    await user.click(
      screen.getByRole("button", { name: messages.login.createTab }),
    );
    await user.type(
      screen.getByLabelText(messages.login.createListTitle),
      "週末の買い物",
    );
    await user.type(
      screen.getByLabelText(messages.login.createListName),
      "はる",
    );
    await user.click(
      screen.getByRole("button", { name: messages.login.createAction }),
    );

    await waitFor(() => expect(onJoined).toHaveBeenCalledTimes(1));
    expect(createListMock).toHaveBeenCalledWith("週末の買い物", "はる");
    expect(joinMock).toHaveBeenCalledWith("new-token", "はる");
    expect(calls).toEqual(["create", "join:new-token", "write", "joined"]);
    expect(onJoined).toHaveBeenCalledWith({
      token: "new-token",
      userId: "user-9",
      name: "はる",
    });
  });

  it("参加に失敗すると内容エラーを表示し、セッションと入力値を変えない", async () => {
    joinMock.mockRejectedValue(new ApiError(404, "not found"));
    const onJoined = vi.fn();
    const user = userEvent.setup();
    render(<LoginScreen prefillToken={null} onJoined={onJoined} />);

    await user.type(tokenInput(), "bad-token");
    await user.type(joinNameInput(), "はる");
    await user.click(
      screen.getByRole("button", { name: messages.login.joinAction }),
    );

    expect(await screen.findByText(messages.login.invalidToken)).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe(
      messages.login.invalidToken,
    );
    expect(writeSessionMock).not.toHaveBeenCalled();
    expect(onJoined).not.toHaveBeenCalled();
    expect(tokenInput().value).toBe("bad-token");
    expect(joinNameInput().value).toBe("はる");
  });
});

// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { CompletionNotice } from "./CompletionNotice";
import { messages } from "../messages";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("通知に触れている間は閉じず、離れた後に自動で閉じる", () => {
  vi.useFakeTimers();
  const dismiss = vi.fn();
  render(
    <CompletionNotice receipt={{ id: 4, remaining: 1 }} onDismiss={dismiss} />,
  );
  const notice = screen
    .getByText(messages.completion.title)
    .closest(".completion-notice")!;
  fireEvent.mouseEnter(notice);
  act(() => vi.advanceTimersByTime(10000));
  expect(dismiss).not.toHaveBeenCalled();
  fireEvent.mouseLeave(notice);
  act(() => vi.advanceTimersByTime(6000));
  expect(dismiss).toHaveBeenCalledExactlyOnceWith(4);
});

// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { AnimationSession } from "./AnimationSession";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("途中で閉じた後はタイマーとイベントが動かず、解放処理は一度だけ実行する", () => {
  vi.useFakeTimers();
  const session = new AnimationSession();
  const dispose = vi.fn(),
    timeout = vi.fn(),
    onResize = vi.fn();
  const release = session.own(dispose);
  session.after(500, timeout);
  session.listen(window, "resize", onResize);
  window.dispatchEvent(new Event("resize"));
  expect(onResize).toHaveBeenCalledTimes(1);
  release();
  session.cancel();
  session.cancel();
  window.dispatchEvent(new Event("resize"));
  vi.advanceTimersByTime(1000);
  expect(dispose).toHaveBeenCalledTimes(1);
  expect(onResize).toHaveBeenCalledTimes(1);
  expect(timeout).not.toHaveBeenCalled();
});

it("再生中に閉じた場合は全アニメーションを止め、後続の演出を開始しない", async () => {
  let reject!: (reason: Error) => void;
  const finished = new Promise<void>((_, no) => {
    reject = no;
  });
  const cancel = vi.fn(() =>
    reject(new DOMException("Cancelled", "AbortError")),
  );
  const element = document.createElement("div");
  element.animate = vi.fn(() => ({ finished, cancel }) as unknown as Animation);
  const session = new AnimationSession();
  const playing = session.play(element, [{ opacity: 0 }, { opacity: 1 }], {
    duration: 100,
  });
  const rejected = expect(playing).rejects.toHaveProperty("name", "AbortError");
  session.cancel();
  await rejected;
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(() => session.start(element, [], { duration: 100 })).toThrow();
  expect(element.animate).toHaveBeenCalledTimes(1);
});

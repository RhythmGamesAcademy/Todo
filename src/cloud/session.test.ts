// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SESSION_KEY,
  readSession,
  resolveSession,
  tokenFromHash,
  writeSession,
} from "./session";
import type { Session } from "./session";

const session: Session = { token: "tok_123", userId: "user_1", name: "あき" };

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("セッションの保存", () => {
  it("書き込んだ内容をそのまま読み出し、null で削除できる", () => {
    writeSession(session);
    expect(window.localStorage.getItem(SESSION_KEY)).toBe(
      JSON.stringify(session),
    );
    expect(readSession()).toEqual(session);

    writeSession(null);
    expect(window.localStorage.getItem(SESSION_KEY)).toBeNull();
    expect(readSession()).toBeNull();
  });

  it("壊れたJSONは null を返し、勝手に削除しない", () => {
    window.localStorage.setItem(SESSION_KEY, '{"token":');
    expect(readSession()).toBeNull();
    expect(window.localStorage.getItem(SESSION_KEY)).toBe('{"token":');
  });

  it("形が違う値は null を返す", () => {
    const invalid = [
      "null",
      '"text"',
      "[]",
      '{"token":"t","userId":"u"}',
      '{"token":"","userId":"u","name":"n"}',
      '{"token":"t","userId":"u","name":"   "}',
      '{"token":"t","userId":"u","name":"n","extra":1}',
      '{"token":1,"userId":"u","name":"n"}',
    ];
    for (const raw of invalid) {
      window.localStorage.setItem(SESSION_KEY, raw);
      expect(readSession(), raw).toBeNull();
    }
  });

  it("保存に失敗しても例外を投げない", () => {
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    expect(() => writeSession(session)).not.toThrow();

    vi.spyOn(window.localStorage, "removeItem").mockImplementation(() => {
      throw new Error("unavailable");
    });
    expect(() => writeSession(null)).not.toThrow();
  });

  it("読み出しに失敗したときも例外を投げない", () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("unavailable");
    });
    expect(readSession()).toBeNull();
  });
});

describe("URLハッシュのトークン", () => {
  it("#token= を抽出し、履歴からハッシュを消す", () => {
    window.history.replaceState(null, "", "/lists?lang=ja");
    window.location.hash = "#token=abc";
    const spy = vi
      .spyOn(window.history, "replaceState")
      .mockImplementation(() => {});

    expect(tokenFromHash()).toBe("abc");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(null, "", "/lists?lang=ja");
  });

  it("パーセントエンコードを解釈する", () => {
    window.location.hash = "#token=abc%2Ddef";
    vi.spyOn(window.history, "replaceState").mockImplementation(() => {});
    expect(tokenFromHash()).toBe("abc-def");
  });

  it("ハッシュがなければ null で、履歴に触らない", () => {
    const spy = vi.spyOn(window.history, "replaceState");
    expect(tokenFromHash()).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("#token= 以外のハッシュは無視する", () => {
    window.location.hash = "#section";
    const spy = vi.spyOn(window.history, "replaceState");
    expect(tokenFromHash()).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("壊れたエンコードは null でも、ハッシュは消す", () => {
    window.location.hash = "#token=%E0%A4%A";
    const spy = vi
      .spyOn(window.history, "replaceState")
      .mockImplementation(() => {});
    expect(tokenFromHash()).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("空のトークンは null でも、ハッシュは消す", () => {
    window.location.hash = "#token=";
    const spy = vi
      .spyOn(window.history, "replaceState")
      .mockImplementation(() => {});
    expect(tokenFromHash()).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("セッションの解決", () => {
  it("ハッシュのトークンをセッションより優先する", () => {
    writeSession(session);
    window.location.hash = "#token=invite-token";

    expect(resolveSession()).toEqual({ token: "invite-token", session });
    expect(window.location.hash).toBe("");
  });

  it("ハッシュがなければ保存済みセッションのトークンを使う", () => {
    writeSession(session);
    expect(resolveSession()).toEqual({ token: "tok_123", session });
  });

  it("どちらもなければ token も session も null", () => {
    expect(resolveSession()).toEqual({ token: null, session: null });
  });

  it("セッションが壊れていてもハッシュのトークンは返す", () => {
    window.localStorage.setItem(SESSION_KEY, "broken");
    window.location.hash = "#token=invite-token";
    expect(resolveSession()).toEqual({ token: "invite-token", session: null });
  });
});

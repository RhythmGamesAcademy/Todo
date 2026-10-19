import { describe, expect, it } from "vitest";
import { ApiException, assertText, generateToken } from "./domain";

describe("generateToken", () => {
  it("43文字のbase64urlを生成し、呼ぶたびに異なる", () => {
    const first = generateToken();
    const second = generateToken();
    expect(first).toHaveLength(43);
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first).not.toBe(second);
  });
});

describe("assertText", () => {
  it("前後の空白を除いた文字列を返す", () => {
    expect(assertText("  チームTODO  ", 120, "title")).toBe("チームTODO");
  });

  it("空文字と空白だけの文字列を拒否する", () => {
    expect(() => assertText("", 120, "title")).toThrow(ApiException);
    expect(() => assertText("   ", 120, "title")).toThrow(ApiException);
    expect(() => assertText("\n\t", 120, "title")).toThrow(ApiException);
  });

  it("文字列以外を拒否する", () => {
    expect(() => assertText(undefined, 120, "title")).toThrow(ApiException);
    expect(() => assertText(1, 120, "title")).toThrow(ApiException);
    expect(() => assertText(null, 120, "title")).toThrow(ApiException);
    expect(() => assertText(["TODO"], 120, "title")).toThrow(ApiException);
  });

  it("上限ちょうどは受け付け、超過は拒否する", () => {
    expect(assertText("あ".repeat(120), 120, "title")).toHaveLength(120);
    expect(() => assertText("あ".repeat(121), 120, "title")).toThrow(
      ApiException,
    );
  });

  it("400 のステータスを持つ", () => {
    let error: unknown;
    try {
      assertText("", 10, "name");
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ApiException);
    expect((error as ApiException).status).toBe(400);
  });
});

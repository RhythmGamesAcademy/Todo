import { describe, expect, it } from "vitest";
import type { CloudTodo } from "../../src/cloud/types";
import {
  ApiException,
  assertText,
  computeActivities,
  extractMentions,
  generateToken,
  parseTags,
  toPgTextArray,
} from "./domain";

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

describe("computeActivities", () => {
  const before: CloudTodo = {
    id: "todo-1",
    title: "旧タイトル",
    description: "旧説明",
    deadline: "2026-10-19T00:00:00.000Z",
    priority: "medium",
    status: "todo",
    assigneeId: "user-1",
    tags: [],
    approvalStatus: null,
    approvalReason: null,
    createdAt: "2026-10-18T00:00:00.000Z",
    updatedAt: "2026-10-18T00:00:00.000Z",
    subtasks: [],
    notes: [],
  };

  it("変更した1フィールドだけ行を返す", () => {
    expect(computeActivities(before, { title: "新タイトル" }, null)).toEqual([
      { field: "title", before: "旧タイトル", after: "新タイトル" },
    ]);
  });

  it("複数フィールドの変更は生値で複数行を返す", () => {
    expect(
      computeActivities(
        before,
        {
          deadline: "2026-10-20T12:00:00.000Z",
          status: "done",
          priority: "high",
        },
        null,
      ),
    ).toEqual([
      {
        field: "deadline",
        before: "2026-10-19T00:00:00.000Z",
        after: "2026-10-20T12:00:00.000Z",
      },
      { field: "status", before: "todo", after: "done" },
      { field: "priority", before: "medium", after: "high" },
    ]);
  });

  it("説明の変更も生値で返す", () => {
    expect(computeActivities(before, { description: "新説明" }, null)).toEqual([
      { field: "description", before: "旧説明", after: "新説明" },
    ]);
  });

  it("無変更・空パッチは空配列を返す", () => {
    expect(computeActivities(before, {}, null)).toEqual([]);
    expect(computeActivities(before, { title: before.title }, null)).toEqual(
      [],
    );
    expect(
      computeActivities(before, { deadline: before.deadline }, null),
    ).toEqual([]);
    expect(
      computeActivities(before, { assigneeId: before.assigneeId }, null),
    ).toEqual([]);
  });

  it("assignee は変更前後の名前で1行を返す", () => {
    expect(
      computeActivities(before, { assigneeId: "user-2" }, "はる", "あき"),
    ).toEqual([{ field: "assignee", before: "あき", after: "はる" }]);
  });

  it("assignee の解除は after を null にする", () => {
    expect(
      computeActivities(before, { assigneeId: null }, null, "あき"),
    ).toEqual([{ field: "assignee", before: "あき", after: null }]);
  });

  it("タグの差し替えは「、」結合の前後を履歴に出す", () => {
    expect(
      computeActivities({ ...before, tags: ["設計"] }, { tags: [] }, null),
    ).toEqual([{ field: "tags", before: "設計", after: null }]);
    expect(computeActivities(before, { tags: ["会議"] }, null)).toEqual([
      { field: "tags", before: null, after: "会議" },
    ]);
  });
});

describe("parseTags", () => {
  it("未指定は空配列、前後の空白を除き重複を除き順序を保つ", () => {
    expect(parseTags(undefined)).toEqual([]);
    expect(parseTags(null)).toEqual([]);
    expect(parseTags([" 申請 ", "申請", "会議"])).toEqual(["申請", "会議"]);
  });

  it("配列以外・空要素・長過ぎるタグ・5個超を400で拒否する", () => {
    expect(() => parseTags("申請")).toThrow(ApiException);
    expect(() => parseTags([""])).toThrow(ApiException);
    expect(() => parseTags(["あ".repeat(21)])).toThrow(ApiException);
    expect(() => parseTags(["1", "2", "3", "4", "5", "6"])).toThrow(
      ApiException,
    );
  });

  it("5個ちょうどと20文字ちょうどは受け入れる", () => {
    expect(parseTags(["あ".repeat(20)])).toEqual(["あ".repeat(20)]);
    expect(parseTags(["1", "2", "3", "4", "5"])).toHaveLength(5);
  });
});

describe("extractMentions", () => {
  const users = [
    { id: "u1", name: "あき" },
    { id: "u2", name: "あきこ" },
  ];

  it("@名前 の完全一致だけでIDを返す", () => {
    expect(extractMentions("@あき と @はる へ", users)).toEqual(["u1"]);
    expect(extractMentions("@あきこさん", users)).toEqual(["u2"]);
  });

  it("長い名前を先に判定するため @あきこ は短い方に吸われない", () => {
    expect(extractMentions("@あきこ", users)).toEqual(["u2"]);
  });

  it("対象外の名前や@なしは空配列", () => {
    expect(extractMentions("@はる と あき", users)).toEqual([]);
    expect(extractMentions("呼ぶぞあき", users)).toEqual([]);
  });

  it("重複メンションはIDを1つに畳む", () => {
    expect(extractMentions("@あき @あき", users)).toEqual(["u1"]);
  });
});

describe("toPgTextArray", () => {
  it("text[] リテラルに変換する", () => {
    expect(toPgTextArray([])).toBe("{}");
    expect(toPgTextArray(["申請"])).toBe('{"申請"}');
    expect(toPgTextArray(["a", "b"])).toBe('{"a","b"}');
  });

  it("引用符とバックスラッシュをエスケープする", () => {
    expect(toPgTextArray(['"x"'])).toBe('{"\\"x\\""}');
    expect(toPgTextArray(["y\\z"])).toBe('{"y\\\\z"}');
  });
});

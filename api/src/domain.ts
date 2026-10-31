import { randomBytes } from "node:crypto";
import type { CloudTodo, TodoPatch } from "../../src/cloud/types";

/** 承認フローの対象にする特別タグ。src/model.ts の REQUEST_TAG と揃える。 */
export const REQUEST_TAG = "申請";
export const MAX_TAGS = 5;
export const MAX_TAG_LENGTH = 20;

export interface ActivityChange {
  field: string;
  before: string | null;
  after: string | null;
}

export class ApiException extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 500,
    message: string,
  ) {
    super(message);
    this.name = "ApiException";
  }
}

export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * TODOのタグを正規化する。前後の空白を除き、空文字と20文字超を拒否し、
 * 順序を保ったまま重複を除く。API v1 の他の入力と同じく、不正値は 400 にする。
 */
export function parseTags(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value))
    throw new ApiException(400, "tags must be an array");
  if (value.length > MAX_TAGS)
    throw new ApiException(400, `tags must have at most ${MAX_TAGS} items`);
  const tags: string[] = [];
  for (const item of value) {
    if (typeof item !== "string")
      throw new ApiException(400, "each tag must be a string");
    const tag = item.trim();
    if (!tag) throw new ApiException(400, "tags must not contain empty items");
    if (tag.length > MAX_TAG_LENGTH)
      throw new ApiException(
        400,
        `each tag must be at most ${MAX_TAG_LENGTH} characters`,
      );
    if (!tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

/**
 * メモ本文からメンションされたメンバーのIDを抜き出す。
 * 名前は @<名前> の完全一致のみ。長い名前から先に判定する(「あき」「あきこ」で
 * @あきこ が短い方に飲まれないようにする)。
 */
export function extractMentions(
  text: string,
  users: readonly { id: string; name: string }[],
): string[] {
  // @ の位置ごとに最長の名前から照合し、1件だけ採用する。
  // (@あき という短い名前が @あきこ の一部に当たるのを防ぐ)
  const sorted = [...users].sort((a, b) => b.name.length - a.name.length);
  const mentioned: string[] = [];
  for (let at = text.indexOf("@"); at !== -1; at = text.indexOf("@", at + 1)) {
    for (const user of sorted) {
      if (!user.name || !text.startsWith(user.name, at + 1)) continue;
      if (!mentioned.includes(user.id)) mentioned.push(user.id);
      break;
    }
  }
  return mentioned;
}

/**
 * Postgres の text[] リテラルに変換する。要素は二重引用符で囲み、
 * 引用符とバックスラッシュだけをエスケープする(空配列は {})。
 */
export function toPgTextArray(tags: readonly string[]): string {
  return (
    "{" +
    tags
      .map((tag) => '"' + tag.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"')
      .join(",") +
    "}"
  );
}

export function assertText(value: unknown, max: number, field: string): string {
  if (typeof value !== "string")
    throw new ApiException(400, `${field} must be a string`);
  const text = value.trim();
  if (!text) throw new ApiException(400, `${field} is required`);
  if (text.length > max)
    throw new ApiException(400, `${field} must be at most ${max} characters`);
  return text;
}

/**
 * 実際に値が変わったフィールドだけを activity 行にする。
 * 値は機械可読な生値（deadline は ISO 文字列 or null）で、
 * assignee だけは呼び出し側が解決した名前を使う。
 *
 * CloudTodo は assigneeId しか持たないため、変更前の担当者名は
 * 追加の第 4 引数で受け取る（3 引数呼び出しでは null になる）。
 */
export function computeActivities(
  before: CloudTodo,
  patch: TodoPatch,
  assigneeNameAfter: string | null,
  assigneeNameBefore: string | null = null,
): ActivityChange[] {
  const changes: ActivityChange[] = [];
  const push = (
    field: string,
    previous: string | null,
    next: string | null,
  ) => {
    if (previous !== next)
      changes.push({ field, before: previous, after: next });
  };

  if (patch.title !== undefined) push("title", before.title, patch.title);
  if (patch.description !== undefined)
    push("description", before.description, patch.description);
  if (patch.deadline !== undefined)
    push("deadline", before.deadline, patch.deadline);
  if (patch.tags !== undefined) {
    const beforeTags = before.tags ?? [];
    push(
      "tags",
      beforeTags.length ? beforeTags.join("、") : null,
      patch.tags.length ? patch.tags.join("、") : null,
    );
  }
  if (patch.status !== undefined) push("status", before.status, patch.status);
  if (patch.priority !== undefined)
    push("priority", before.priority, patch.priority);
  if (patch.assigneeId !== undefined && patch.assigneeId !== before.assigneeId)
    push("assignee", assigneeNameBefore, assigneeNameAfter);

  return changes;
}

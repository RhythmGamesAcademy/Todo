import { randomBytes } from "node:crypto";
import type { CloudTodo, TodoPatch } from "../../src/cloud/types";

export interface ActivityChange {
  field: string;
  before: string | null;
  after: string | null;
}

export class ApiException extends Error {
  constructor(
    readonly status: 400 | 404 | 500,
    message: string,
  ) {
    super(message);
    this.name = "ApiException";
  }
}

export function generateToken(): string {
  return randomBytes(32).toString("base64url");
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
  if (patch.status !== undefined) push("status", before.status, patch.status);
  if (patch.priority !== undefined)
    push("priority", before.priority, patch.priority);
  if (patch.assigneeId !== undefined && patch.assigneeId !== before.assigneeId)
    push("assignee", assigneeNameBefore, assigneeNameAfter);

  return changes;
}

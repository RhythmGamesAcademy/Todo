import { messages } from "../messages";
import { record, validDate } from "../model";
import type { ApprovalStatus, Priority, Status, SubtaskStatus } from "../model";
import type { ActivityKind, CloudState, NotificationKind } from "./types";

const STATUSES: readonly Status[] = ["todo", "doing", "done"];
const SUBTASK_STATUSES: readonly SubtaskStatus[] = ["todo", "done"];
const PRIORITIES: readonly Priority[] = ["high", "medium", "low"];
const APPROVAL_STATUSES: readonly ApprovalStatus[] = [
  "pending",
  "approved",
  "rejected",
];
const ACTIVITY_KINDS: readonly ActivityKind[] = [
  "todo.created",
  "todo.updated",
  "todo.deleted",
  "todo.restored",
  "user.joined",
  "user.renamed",
  "user.removed",
  "list.renamed",
  "approval.approved",
  "approval.rejected",
];
const NOTIFICATION_KINDS: readonly NotificationKind[] = [
  "mention",
  "todo.assigned",
  "approval.approved",
  "approval.rejected",
];
const MAX_TAGS = 5;
const MAX_TAG_LENGTH = 20;

const fail = (): never => {
  throw new Error(messages.errors.invalidState);
};

const validId = (x: unknown): x is string =>
  typeof x === "string" && !!x.trim();
const validText = (x: unknown, max: number): x is string =>
  typeof x === "string" && !!x.trim() && x.length <= max;
const nullableString = (x: unknown): x is string | null =>
  x === null || typeof x === "string";
const optionalString = (x: unknown): x is string | null | undefined =>
  x === undefined || nullableString(x);
const ISO_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/;
const daysInMonth = (year: number, month: number) =>
  month === 2
    ? year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
      ? 29
      : 28
    : [4, 6, 9, 11].includes(month)
      ? 30
      : 31;
const isIsoTimestamp = (x: unknown): x is string => {
  if (typeof x !== "string") return false;
  const match = ISO_TIMESTAMP.exec(x);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  return (
    month >= 1 &&
    month <= 12 &&
    Number(match[3]) >= 1 &&
    Number(match[3]) <= daysInMonth(year, month) &&
    Number(match[4]) <= 23 &&
    Number(match[5]) <= 59 &&
    (match[6] === undefined || Number(match[6]) <= 59) &&
    validDate(x)
  );
};
const oneOf = <T extends string>(values: readonly T[], x: unknown): x is T =>
  typeof x === "string" && (values as readonly string[]).includes(x);

function validateList(value: unknown): void {
  if (
    !record(value) ||
    !validId(value.id) ||
    !validText(value.title, 120) ||
    typeof value.revision !== "number" ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0
  )
    return fail();
}

function validateUser(value: unknown, ids: Set<string>): void {
  if (
    !record(value) ||
    !validId(value.id) ||
    ids.has(value.id) ||
    !validText(value.name, 120) ||
    !isIsoTimestamp(value.createdAt) ||
    !(
      value.notificationReadAt === undefined ||
      value.notificationReadAt === null ||
      isIsoTimestamp(value.notificationReadAt)
    )
  )
    return fail();
  ids.add(value.id);
}

// タグは旧API/旧バックアップでは存在しないため optional で受け、
// あるときはサーバーと同じ規則(1〜20文字・最大5個)を検証する。
const validateTags = (x: unknown): x is string[] | undefined => {
  if (x === undefined) return true;
  if (!Array.isArray(x) || x.length > MAX_TAGS) return false;
  return x.every(
    (tag) =>
      typeof tag === "string" && !!tag.trim() && tag.length <= MAX_TAG_LENGTH,
  );
};

function validateNote(value: unknown, ids: Set<string>): void {
  if (
    !record(value) ||
    !validId(value.id) ||
    ids.has(value.id) ||
    !validText(value.text, 2000) ||
    !isIsoTimestamp(value.createdAt) ||
    !(value.editedAt === undefined || isIsoTimestamp(value.editedAt)) ||
    !(
      value.userId === null ||
      (typeof value.userId === "string" && !!value.userId.trim())
    )
  )
    return fail();
  ids.add(value.id);
}

function validateSubtaskMemo(value: unknown, ids: Set<string>): void {
  if (
    !record(value) ||
    !validId(value.id) ||
    ids.has(value.id) ||
    !validText(value.text, 2000) ||
    !isIsoTimestamp(value.createdAt)
  )
    return fail();
  ids.add(value.id);
}

function validateSubtask(value: unknown, ids: Set<string>): void {
  if (
    !record(value) ||
    !validId(value.id) ||
    ids.has(value.id) ||
    !validText(value.title, 120) ||
    !oneOf(SUBTASK_STATUSES, value.status) ||
    !oneOf(PRIORITIES, value.priority) ||
    !(value.deadline === null || isIsoTimestamp(value.deadline)) ||
    !isIsoTimestamp(value.createdAt) ||
    !isIsoTimestamp(value.updatedAt) ||
    !Array.isArray(value.memos)
  )
    return fail();
  ids.add(value.id);
  const memoIds = new Set<string>();
  for (const memo of value.memos) validateSubtaskMemo(memo, memoIds);
}

function validateTodo(value: unknown, ids: Set<string>): void {
  if (
    !record(value) ||
    !validId(value.id) ||
    ids.has(value.id) ||
    !validText(value.title, 120) ||
    typeof value.description !== "string" ||
    value.description.length > 2000 ||
    !(value.deadline === null || isIsoTimestamp(value.deadline)) ||
    !oneOf(PRIORITIES, value.priority) ||
    !oneOf(STATUSES, value.status) ||
    !(value.assigneeId === null || validId(value.assigneeId)) ||
    !validateTags(value.tags) ||
    !(
      value.approvalStatus === undefined ||
      value.approvalStatus === null ||
      oneOf(APPROVAL_STATUSES, value.approvalStatus)
    ) ||
    !optionalString(value.approvalReason) ||
    !isIsoTimestamp(value.createdAt) ||
    !isIsoTimestamp(value.updatedAt) ||
    !Array.isArray(value.notes) ||
    !(value.subtasks === undefined || Array.isArray(value.subtasks))
  )
    return fail();
  ids.add(value.id);
  const noteIds = new Set<string>();
  for (const note of value.notes) validateNote(note, noteIds);
  const subtaskIds = new Set<string>();
  for (const subtask of value.subtasks ?? [])
    validateSubtask(subtask, subtaskIds);
}

function validateActivity(value: unknown, ids: Set<string>): void {
  if (
    !record(value) ||
    !validId(value.id) ||
    ids.has(value.id) ||
    !nullableString(value.todoId) ||
    !nullableString(value.userId) ||
    !oneOf(ACTIVITY_KINDS, value.kind) ||
    !nullableString(value.field) ||
    !nullableString(value.before) ||
    !nullableString(value.after) ||
    !isIsoTimestamp(value.createdAt)
  )
    return fail();
  ids.add(value.id);
}

function validateNotification(value: unknown, ids: Set<string>): void {
  if (
    !record(value) ||
    !validId(value.id) ||
    ids.has(value.id) ||
    !nullableString(value.todoId) ||
    !nullableString(value.userId) ||
    !oneOf(NOTIFICATION_KINDS, value.kind) ||
    !nullableString(value.body) ||
    !isIsoTimestamp(value.createdAt)
  )
    return fail();
  ids.add(value.id);
}

export function parseCloudState(input: unknown): CloudState {
  if (!record(input)) return fail();
  validateList(input.list);
  if (
    !Array.isArray(input.users) ||
    !Array.isArray(input.todos) ||
    input.todos.length > 10000 ||
    !Array.isArray(input.activities) ||
    !(input.notifications === undefined || Array.isArray(input.notifications))
  )
    return fail();
  const userIds = new Set<string>();
  for (const user of input.users) validateUser(user, userIds);
  const todoIds = new Set<string>();
  for (const todo of input.todos) validateTodo(todo, todoIds);
  const activityIds = new Set<string>();
  for (const activity of input.activities)
    validateActivity(activity, activityIds);
  const notificationIds = new Set<string>();
  for (const notification of input.notifications ?? [])
    validateNotification(notification, notificationIds);
  return {
    ...input,
    todos: input.todos.map((todo) => ({
      ...todo,
      // 旧API/旧モックに無い新フィールドは規定値へ補完する。
      tags: todo.tags ?? [],
      approvalStatus: todo.approvalStatus ?? null,
      approvalReason: todo.approvalReason ?? null,
      subtasks: todo.subtasks ?? [],
    })),
  } as unknown as CloudState;
}

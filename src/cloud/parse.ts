import { messages } from "../messages";
import { record, validDate } from "../model";
import type { Priority, Status } from "../model";
import type { ActivityKind, CloudState } from "./types";

const STATUSES: readonly Status[] = ["todo", "doing", "done"];
const PRIORITIES: readonly Priority[] = ["high", "medium", "low"];
const ACTIVITY_KINDS: readonly ActivityKind[] = [
  "todo.created",
  "todo.updated",
  "todo.deleted",
  "todo.restored",
  "user.joined",
  "user.renamed",
  "user.removed",
  "list.renamed",
];

const fail = (): never => {
  throw new Error(messages.errors.invalidState);
};

const validId = (x: unknown): x is string =>
  typeof x === "string" && !!x.trim();
const validText = (x: unknown, max: number): x is string =>
  typeof x === "string" && !!x.trim() && x.length <= max;
const nullableString = (x: unknown): x is string | null =>
  x === null || typeof x === "string";
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
    !isIsoTimestamp(value.createdAt)
  )
    return fail();
  ids.add(value.id);
}

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
    !isIsoTimestamp(value.createdAt) ||
    !isIsoTimestamp(value.updatedAt) ||
    !Array.isArray(value.notes)
  )
    return fail();
  ids.add(value.id);
  const noteIds = new Set<string>();
  for (const note of value.notes) validateNote(note, noteIds);
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

export function parseCloudState(input: unknown): CloudState {
  if (!record(input)) return fail();
  validateList(input.list);
  if (
    !Array.isArray(input.users) ||
    !Array.isArray(input.todos) ||
    input.todos.length > 10000 ||
    !Array.isArray(input.activities)
  )
    return fail();
  const userIds = new Set<string>();
  for (const user of input.users) validateUser(user, userIds);
  const todoIds = new Set<string>();
  for (const todo of input.todos) validateTodo(todo, todoIds);
  const activityIds = new Set<string>();
  for (const activity of input.activities)
    validateActivity(activity, activityIds);
  return input as unknown as CloudState;
}

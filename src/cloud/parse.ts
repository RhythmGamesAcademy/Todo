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

const validId = (x: unknown): x is string => typeof x === "string" && !!x;
const validText = (x: unknown, max: number): x is string =>
  typeof x === "string" && !!x.trim() && x.length <= max;
const nullableString = (x: unknown): x is string | null =>
  x === null || typeof x === "string";
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
    !validDate(value.createdAt)
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
    !validDate(value.createdAt) ||
    !(value.editedAt === undefined || validDate(value.editedAt))
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
    !(value.deadline === null || validDate(value.deadline)) ||
    !oneOf(PRIORITIES, value.priority) ||
    !oneOf(STATUSES, value.status) ||
    !(value.assigneeId === null || validId(value.assigneeId)) ||
    !validDate(value.createdAt) ||
    !validDate(value.updatedAt) ||
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
    !validDate(value.createdAt)
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

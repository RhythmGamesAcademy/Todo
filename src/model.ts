import { messages } from "./messages";
export type Status = "todo" | "doing" | "done";
export type Priority = "high" | "medium" | "low";
export type Filter = "all" | "overdue" | "active" | "today" | "doing" | "done";
export type Sort = "deadline" | "priority";
export interface Note {
  id: string;
  text: string;
  createdAt: string;
  editedAt?: string;
}
export interface Todo {
  id: string;
  title: string;
  description: string;
  deadline: string | null;
  priority: Priority;
  status: Status;
  createdAt: string;
  updatedAt: string;
  notes: Note[];
}
export interface TodoDraft {
  title: string;
  description: string;
  deadline: string | null;
  priority: Priority;
  status: Status;
}
export const STORAGE_KEY = "hitotsuzutsu.todos.v1";
export const TODO_LIMITS = { title: 120, description: 2000 } as const;
export const STATUS: Record<Status, string> = messages.status;
export const PRIORITY: Record<Priority, string> = messages.priority;
export const FILTER_LABEL: Record<Filter, string> = messages.filters.heading;
export const pad = (n: number) => String(n).padStart(2, "0");
export function clockText(date: Date) {
  return messages.dateTime.clock(date);
}
export function dateText(iso: string, year = false) {
  return messages.dateTime.deadline(new Date(iso), year);
}
export function toDateInput(iso: string) {
  const d = new Date(iso);
  return (
    d.getFullYear() +
    "-" +
    pad(d.getMonth() + 1) +
    "-" +
    pad(d.getDate()) +
    "T" +
    pad(d.getHours()) +
    ":" +
    pad(d.getMinutes())
  );
}
export function isToday(iso: string | null, now: Date) {
  return iso !== null && new Date(iso).toDateString() === now.toDateString();
}
export function isOverdue(todo: Todo, now: Date) {
  return (
    todo.status !== "done" &&
    todo.deadline !== null &&
    new Date(todo.deadline).getTime() < now.getTime()
  );
}
export function nextDeadlineId(todos: Todo[], now: Date): string | null {
  let next: Todo | undefined;
  for (const todo of todos) {
    if (todo.status === "done" || !todo.deadline) continue;
    const deadline = Date.parse(todo.deadline);
    if (deadline < now.getTime() || !Number.isFinite(deadline)) continue;
    if (
      !next ||
      deadline < Date.parse(next.deadline!) ||
      (deadline === Date.parse(next.deadline!) &&
        (todo.createdAt.localeCompare(next.createdAt) ||
          todo.id.localeCompare(next.id)) < 0)
    )
      next = todo;
  }
  return next?.id ?? null;
}
export function selectTodos(
  todos: Todo[],
  filter: Filter,
  search: string,
  sort: Sort,
  now: Date,
) {
  const query = search.trim().toLocaleLowerCase();
  const ranks = { high: 0, medium: 1, low: 2 };
  const deadlineRank = (t: Todo) =>
    t.deadline ? new Date(t.deadline).getTime() : Infinity;
  return todos
    .filter((t) => {
      const matches =
        filter === "all" ||
        (filter === "overdue" && isOverdue(t, now)) ||
        (filter === "active" && t.status !== "done") ||
        (filter === "today" &&
          t.status !== "done" &&
          isToday(t.deadline, now)) ||
        (filter === "doing" && t.status === "doing") ||
        (filter === "done" && t.status === "done");
      return (
        matches &&
        (!query ||
          [t.title, t.description, ...t.notes.map((n) => n.text)].some((s) =>
            s.toLocaleLowerCase().includes(query),
          ))
      );
    })
    .sort((a, b) => {
      const completionOrder =
        Number(a.status === "done") - Number(b.status === "done");
      if (filter === "all" && completionOrder) return completionOrder;
      const priorityOrder =
        sort === "priority" ? ranks[a.priority] - ranks[b.priority] : 0;
      if (priorityOrder) return priorityOrder;
      const aDue = deadlineRank(a),
        bDue = deadlineRank(b);
      if (aDue !== bDue) return aDue < bDue ? -1 : 1;
      if (sort === "deadline" && ranks[a.priority] !== ranks[b.priority])
        return ranks[a.priority] - ranks[b.priority];
      return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
    });
}
export function calendarUrl(todo: Todo, browser = false) {
  if (!todo.deadline) return null;
  const start = new Date(todo.deadline);
  const end = new Date(start.getTime() + 15 * 60 * 1000);
  const stamp = (d: Date) =>
    d
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}Z$/, "Z");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: messages.calendar.eventTitle(todo.title),
    dates: stamp(start) + "/" + stamp(end),
    details: todo.description,
  });
  return (
    (browser
      ? "https://www.google.com/calendar/render?"
      : "https://calendar.google.com/calendar/render?") + params.toString()
  );
}
export function serializeTodos(todos: Todo[]) {
  return JSON.stringify({ version: 1, todos });
}
const record = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);
const validDate = (x: unknown): x is string =>
  typeof x === "string" && Number.isFinite(Date.parse(x));
export function parseTodos(raw: string): Todo[] {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(messages.errors.invalidBackup);
  }
  if (
    !record(data) ||
    data.version !== 1 ||
    !Array.isArray(data.todos) ||
    data.todos.length > 10000
  )
    throw new Error(messages.errors.invalidBackup);
  const ids = new Set<string>();
  for (const t of data.todos) {
    if (
      !record(t) ||
      typeof t.id !== "string" ||
      !t.id ||
      ids.has(t.id) ||
      typeof t.title !== "string" ||
      !t.title.trim() ||
      t.title.length > TODO_LIMITS.title ||
      typeof t.description !== "string" ||
      t.description.length > TODO_LIMITS.description ||
      !(t.deadline === null || validDate(t.deadline)) ||
      !["high", "medium", "low"].includes(String(t.priority)) ||
      !["todo", "doing", "done"].includes(String(t.status)) ||
      !validDate(t.createdAt) ||
      !validDate(t.updatedAt) ||
      !Array.isArray(t.notes)
    )
      throw new Error(messages.errors.invalidTodo);
    ids.add(t.id);
    const noteIds = new Set<string>();
    for (const n of t.notes) {
      if (
        !record(n) ||
        typeof n.id !== "string" ||
        !n.id ||
        noteIds.has(n.id) ||
        typeof n.text !== "string" ||
        !n.text.trim() ||
        n.text.length > 2000 ||
        !validDate(n.createdAt) ||
        (n.editedAt !== undefined && !validDate(n.editedAt))
      )
        throw new Error(messages.errors.invalidNote);
      noteIds.add(n.id);
    }
  }
  return data.todos as Todo[];
}

export type RestoreMode = "replace" | "merge" | "add";
export interface RestorePlan {
  todos: Todo[];
  added: number;
  updated: number;
  removed: number;
  unchanged: number;
}
export function mergeNotes(existing: Note[], incoming: Note[]): Note[] {
  const notes = new Map(existing.map((note) => [note.id, note]));
  for (const note of incoming) notes.set(note.id, note);
  return [...notes.values()].sort(
    (a, b) =>
      Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
      a.id.localeCompare(b.id),
  );
}
export function planRestore(
  existing: Todo[],
  incoming: Todo[],
  mode: RestoreMode,
): RestorePlan {
  const oldById = new Map(existing.map((todo) => [todo.id, todo]));
  const newById = new Map(incoming.map((todo) => [todo.id, todo]));
  let todos: Todo[];
  if (mode === "replace") todos = [...incoming];
  else {
    todos = existing.map((todo) => {
      const imported = newById.get(todo.id);
      if (!imported || mode === "add") return todo;
      return {
        ...todo,
        title: imported.title,
        description: imported.description,
        deadline: imported.deadline,
        priority: imported.priority,
        status: imported.status,
        updatedAt: imported.updatedAt,
        notes: mergeNotes(todo.notes, imported.notes),
      };
    });
    todos.push(...incoming.filter((todo) => !oldById.has(todo.id)));
  }
  if (todos.length > 10000) throw new Error(messages.errors.tooManyTodos);
  const finalIds = new Set(todos.map((todo) => todo.id));
  const added = todos.filter((todo) => !oldById.has(todo.id)).length;
  const updated = todos.filter((todo) => {
    const old = oldById.get(todo.id);
    return old && JSON.stringify(old) !== JSON.stringify(todo);
  }).length;
  const removed = existing.filter((todo) => !finalIds.has(todo.id)).length;
  return {
    todos,
    added,
    updated,
    removed,
    unchanged: todos.length - added - updated,
  };
}

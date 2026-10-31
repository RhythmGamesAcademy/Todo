import { messages } from "./messages";
export type Status = "todo" | "doing" | "done";
export type SubtaskStatus = "todo" | "done";
export type Priority = "high" | "medium" | "low";
export type Filter = "all" | "overdue" | "active" | "today" | "doing" | "done";
export type Sort = "deadline" | "priority";
export type AssigneeFilter = "any" | "none" | string;
/** 承認フローの状態。「申請」タグが付いたTODOだけが値を持つ。 */
export type ApprovalStatus = "pending" | "approved" | "rejected";
/** 承認/否認フローの対象にする特別タグ。api/src/domain.ts と揃える。 */
export const REQUEST_TAG = "申請";
export const MAX_TAGS = 5;
export const MAX_TAG_LENGTH = 20;
export interface Note {
  id: string;
  text: string;
  createdAt: string;
  editedAt?: string;
  userId: string | null;
}
export interface SubtaskMemo {
  id: string;
  text: string;
  createdAt: string;
}
export interface Subtask {
  id: string;
  title: string;
  status: SubtaskStatus;
  priority: Priority;
  deadline: string | null;
  createdAt: string;
  updatedAt: string;
  memos: SubtaskMemo[];
}
export interface Todo {
  id: string;
  title: string;
  description: string;
  deadline: string | null;
  priority: Priority;
  status: Status;
  assigneeId: string | null;
  tags: string[];
  approvalStatus: ApprovalStatus | null;
  approvalReason: string | null;
  createdAt: string;
  updatedAt: string;
  notes: Note[];
  subtasks: Subtask[];
}
export interface TodoDraft {
  title: string;
  description: string;
  deadline: string | null;
  priority: Priority;
  status: Status;
  assigneeId: string | null;
  tags: string[];
}
export interface SubtaskDraft {
  title: string;
  status: SubtaskStatus;
  priority: Priority;
  deadline: string | null;
}
export type SubtaskPatch = Partial<SubtaskDraft>;
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
  assignee: AssigneeFilter,
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
        (assignee === "any" ||
          (assignee === "none"
            ? t.assigneeId === null
            : t.assigneeId === assignee)) &&
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
export const record = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);
export const validDate = (x: unknown): x is string =>
  typeof x === "string" && Number.isFinite(Date.parse(x));

/**
 * 入力 UI 用のタグ正規化。api/src/domain.ts の parseTags と同じ規則
 * (前後空白の除去・重複排除・最大個数/長さ)だが、API の 400 ではなく
 * エラーメッセージを返す。
 */
export function cleanTags(value: unknown): {
  tags: string[];
  error: string | null;
} {
  if (!Array.isArray(value)) return { tags: [], error: null };
  if (value.length > MAX_TAGS)
    return { tags: [], error: messages.tags.errorCount };
  const tags: string[] = [];
  for (const item of value) {
    if (typeof item !== "string")
      return { tags: [], error: messages.tags.errorLength };
    const tag = item.trim();
    if (!tag) continue;
    if (tag.length > MAX_TAG_LENGTH)
      return { tags: [], error: messages.tags.errorLength };
    if (!tags.includes(tag)) tags.push(tag);
  }
  return { tags, error: null };
}

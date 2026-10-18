export type Status = "todo" | "doing" | "done";
export type Priority = "high" | "medium" | "low";
export type Filter = "all" | "active" | "today" | "doing" | "done";
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
export const STATUS: Record<Status, string> = {
  todo: "未着手",
  doing: "進行中",
  done: "完了",
};
export const PRIORITY: Record<Priority, string> = {
  high: "高",
  medium: "中",
  low: "低",
};
export const FILTER_LABEL: Record<Filter, string> = {
  all: "すべてのTODO",
  active: "未完了",
  today: "今日が期限",
  doing: "進行中",
  done: "完了したTODO",
};
export const pad = (n: number) => String(n).padStart(2, "0");
export function clockText(date: Date) {
  return (
    date.getFullYear() +
    "年" +
    pad(date.getMonth() + 1) +
    "月" +
    pad(date.getDate()) +
    "日 " +
    pad(date.getHours()) +
    "時" +
    pad(date.getMinutes()) +
    "分" +
    pad(date.getSeconds()) +
    "秒"
  );
}
export function dateText(iso: string, year = false) {
  const date = new Date(iso);
  return (
    (year ? date.getFullYear() + "年" : "") +
    (date.getMonth() + 1) +
    "月" +
    date.getDate() +
    "日 " +
    pad(date.getHours()) +
    ":" +
    pad(date.getMinutes())
  );
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
export function calendarUrl(todo: Todo) {
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
    text: "【締切】" + todo.title,
    dates: stamp(start) + "/" + stamp(end),
    details: todo.description,
  });
  return (
    "https://calendar.google.com/calendar/r/eventedit?" + params.toString()
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
  const data: unknown = JSON.parse(raw);
  if (
    !record(data) ||
    data.version !== 1 ||
    !Array.isArray(data.todos) ||
    data.todos.length > 10000
  )
    throw new Error("対応するバックアップ形式ではありません。");
  const ids = new Set<string>();
  for (const t of data.todos) {
    if (
      !record(t) ||
      typeof t.id !== "string" ||
      !t.id ||
      ids.has(t.id) ||
      typeof t.title !== "string" ||
      !t.title.trim() ||
      t.title.length > 120 ||
      typeof t.description !== "string" ||
      t.description.length > 2000 ||
      !(t.deadline === null || validDate(t.deadline)) ||
      !["high", "medium", "low"].includes(String(t.priority)) ||
      !["todo", "doing", "done"].includes(String(t.status)) ||
      !validDate(t.createdAt) ||
      !validDate(t.updatedAt) ||
      !Array.isArray(t.notes)
    )
      throw new Error("TODOのデータが正しくありません。");
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
        throw new Error("メモのデータが正しくありません。");
      noteIds.add(n.id);
    }
  }
  return data.todos as Todo[];
}

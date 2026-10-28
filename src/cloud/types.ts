import type {
  Subtask,
  SubtaskDraft,
  SubtaskMemo,
  SubtaskPatch,
  Todo,
  TodoDraft,
} from "../model";
export type { Subtask, SubtaskDraft, SubtaskMemo, SubtaskPatch };
export type ActivityKind =
  | "todo.created"
  | "todo.updated"
  | "todo.deleted"
  | "todo.restored"
  | "user.joined"
  | "user.renamed"
  | "user.removed"
  | "list.renamed";
export interface CloudUser {
  id: string;
  name: string;
  createdAt: string;
}
export type CloudTodo = Todo; // assigneeId を含む拡張済み Todo
export interface Activity {
  id: string;
  todoId: string | null;
  userId: string | null;
  kind: ActivityKind;
  field: string | null;
  before: string | null;
  after: string | null;
  createdAt: string;
}
export interface CloudState {
  list: { id: string; title: string; revision: number };
  users: CloudUser[];
  todos: CloudTodo[];
  activities: Activity[];
}
export interface TodoPatch extends Partial<TodoDraft> {}

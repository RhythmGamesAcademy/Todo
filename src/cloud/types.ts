import type {
  ApprovalStatus,
  Subtask,
  SubtaskDraft,
  SubtaskMemo,
  SubtaskPatch,
  Todo,
  TodoDraft,
} from "../model";
export type {
  ApprovalStatus,
  Subtask,
  SubtaskDraft,
  SubtaskMemo,
  SubtaskPatch,
};
export type ActivityKind =
  | "todo.created"
  | "todo.updated"
  | "todo.deleted"
  | "todo.restored"
  | "user.joined"
  | "user.renamed"
  | "user.removed"
  | "list.renamed"
  | "approval.approved"
  | "approval.rejected";
export interface CloudUser {
  id: string;
  name: string;
  createdAt: string;
  /** 通知パネルを最後に開いた時刻。これ以降の通知が未読。旧APIでは undefined。 */
  notificationReadAt?: string | null;
}
export type CloudTodo = Todo; // assigneeId を含む拡張済み Todo
export type NotificationKind =
  "mention" | "todo.assigned" | "approval.approved" | "approval.rejected";
/** 自分宛の通知。user_id は宛先ではなく操作者(アクター)を指す。 */
export interface Notification {
  id: string;
  todoId: string | null;
  userId: string | null;
  kind: NotificationKind;
  /** プレビューに使う本文(メモ全文 / TODOタイトル / 否認理由)。 */
  body: string | null;
  createdAt: string;
}
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
  /** 自分宛の通知。?userId= 付き取得でのみ返る。旧APIでは undefined。 */
  notifications?: Notification[];
}
/** 変更履歴も含めて申請タグの脱着を出し分けるための承認系 patch。 */
export interface TodoPatch extends Partial<TodoDraft> {}

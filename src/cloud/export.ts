import type { Activity, CloudState, CloudTodo, CloudUser } from "./types";

export interface CloudExport {
  version: 2;
  exportedAt: string;
  list: { id: string; title: string };
  users: CloudUser[];
  todos: CloudTodo[];
  activities: Activity[];
}

/**
 * サーバーから取得した状態をそのまま書き出す。
 * activities はサーバーが返す昇順を保つため、並べ替えはしない。
 */
export function buildCloudExport(
  state: CloudState,
  exportedAt: string,
): CloudExport {
  return {
    version: 2,
    exportedAt,
    list: { id: state.list.id, title: state.list.title },
    users: state.users,
    todos: state.todos,
    activities: state.activities,
  };
}

export function serializeCloudExport(data: CloudExport): string {
  return JSON.stringify(data, null, 2);
}

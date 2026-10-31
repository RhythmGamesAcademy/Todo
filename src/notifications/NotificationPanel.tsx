import { useMemo } from "react";
import { AtSign, ClipboardCheck, ClipboardX, Inbox } from "lucide-react";
import { dateText } from "../model";
import type { CloudUser, Notification, NotificationKind } from "../cloud/types";
import { messages } from "../messages";

export interface NotificationPanelProps {
  notifications: Notification[];
  users: CloudUser[];
  meId: string | null;
}

/** 通知種別ごとの見出しテキスト。actor は名前解決できた場合のみ渡す。 */
function notificationText(
  kind: NotificationKind,
  actorName: string | null,
): string {
  if (kind === "mention") return messages.notifications.mention(actorName);
  if (kind === "todo.assigned")
    return messages.notifications.assigned(actorName);
  if (kind === "approval.approved")
    return messages.notifications.approved(actorName);
  return messages.notifications.rejected(actorName);
}

function notificationIcon(kind: NotificationKind) {
  if (kind === "mention")
    return { Icon: AtSign, className: "notification-mention" };
  if (kind === "todo.assigned")
    return { Icon: Inbox, className: "notification-assigned" };
  if (kind === "approval.approved")
    return { Icon: ClipboardCheck, className: "notification-approved" };
  return { Icon: ClipboardX, className: "notification-rejected" };
}

/**
 * 通知一覧。1行目に見出し、2行目に本文の1行プレビュー(line-clamp-1)を
 * 出す。TODO が削除済みでもプレビューから内容を追える。
 */
export function NotificationPanel({
  notifications,
  users,
  meId,
}: NotificationPanelProps) {
  const names = useMemo(
    () => new Map(users.map((user) => [user.id, user.name])),
    [users],
  );
  const actorName = (notification: Notification): string | null => {
    if (notification.userId === null) return null;
    if (notification.userId === meId) return messages.notifications.self;
    return names.get(notification.userId) ?? null;
  };
  return (
    <ul className="notification-list" aria-label={messages.notifications.title}>
      {notifications.map((notification) => {
        const { Icon, className } = notificationIcon(notification.kind);
        return (
          <li key={notification.id} className="notification-item">
            <span
              className={"notification-icon " + className}
              aria-hidden="true"
            >
              <Icon size={17} />
            </span>
            <div className="notification-content">
              <p className="notification-text">
                {notificationText(notification.kind, actorName(notification))}
              </p>
              {notification.body && (
                <p className="notification-preview line-clamp-1">
                  {notification.body}
                </p>
              )}
              <time
                className="notification-time"
                dateTime={notification.createdAt}
              >
                {dateText(notification.createdAt)}
              </time>
            </div>
          </li>
        );
      })}
      {!notifications.length && (
        <li className="notification-empty">{messages.notifications.empty}</li>
      )}
    </ul>
  );
}

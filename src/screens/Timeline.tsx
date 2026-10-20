import { useEffect, useMemo, useRef, useState } from "react";
import { UserRound } from "lucide-react";
import { dateText } from "../model";
import type { Note } from "../model";
import type { Activity, CloudUser } from "../cloud/types";
import { messages } from "../messages";

export interface TimelineProps {
  /** このTODOの activity だけを絞って渡す */
  activities: Activity[];
  memos: Note[];
  /** userId → 名前の解決に使う */
  users: CloudUser[];
  /** 送信直後のメモだけ点から本文へ演出する */
  revealingIds?: ReadonlySet<string>;
}

type Entry =
  | { type: "memo"; id: string; at: string; note: Note }
  | { type: "activity"; id: string; at: string; text: string };

function ChatMessage({ note, enter }: { note: Note; enter: boolean }) {
  const [pending, setPending] = useState(enter);
  const row = useRef<HTMLLIElement>(null);
  const followReveal = useRef(false);
  // 送信完了の応答でメモが届いてから印が付く場合も、点から本文へ演出する。
  useEffect(() => {
    if (enter) setPending(true);
  }, [enter]);
  useEffect(() => {
    if (!pending) {
      if (followReveal.current) {
        const list = row.current?.closest("ol");
        if (!list || !row.current) return;
        // Keep the unfolding text in view, but stop following if the reader scrolls.
        const follow = () => {
          if (followReveal.current)
            list.scrollTo({ top: list.scrollHeight, behavior: "auto" });
        };
        const stop = () => {
          followReveal.current = false;
        };
        const observer =
          typeof ResizeObserver === "undefined"
            ? null
            : new ResizeObserver(follow);
        observer?.observe(row.current);
        list.addEventListener("wheel", stop, { passive: true });
        list.addEventListener("touchstart", stop, { passive: true });
        list.addEventListener("keydown", stop);
        follow();
        const timer = window.setTimeout(() => {
          observer?.disconnect();
          stop();
        }, 520);
        return () => {
          window.clearTimeout(timer);
          observer?.disconnect();
          list.removeEventListener("wheel", stop);
          list.removeEventListener("touchstart", stop);
          list.removeEventListener("keydown", stop);
        };
      }
      return;
    }
    function reveal() {
      const list = row.current?.closest("ol");
      followReveal.current =
        !!list && list.scrollHeight - list.scrollTop - list.clientHeight < 80;
      setPending(false);
    }
    const timer = window.setTimeout(reveal, 420);
    return () => {
      window.clearTimeout(timer);
    };
  }, [pending]);
  return (
    <li
      ref={row}
      className={"chat-message " + (enter ? "chat-message-new" : "")}
    >
      <span className="avatar" aria-hidden="true">
        <UserRound size={21} strokeWidth={1.7} />
      </span>
      <div className="message-content">
        <span className="message-name">{messages.chat.self}</span>
        <time className="message-time" dateTime={note.createdAt}>
          {dateText(note.createdAt)}
        </time>
        <div
          className={
            "message-body " + (pending ? "message-pending" : "message-revealed")
          }
        >
          <span
            className="message-dots"
            role={pending ? "status" : undefined}
            aria-label={pending ? messages.chat.revealing : undefined}
            aria-hidden={!pending}
          >
            <span aria-hidden="true" />
            <span aria-hidden="true" />
            <span aria-hidden="true" />
          </span>
          <div className="message-reveal" aria-hidden={pending || undefined}>
            <div>
              <p className="message-text">{note.text}</p>
            </div>
          </div>
        </div>
      </div>
    </li>
  );
}

export function Timeline({
  activities,
  memos,
  users,
  revealingIds,
}: TimelineProps) {
  const thread = useRef<HTMLOListElement>(null);
  const entries = useMemo(() => {
    const names = new Map(users.map((user) => [user.id, user.name]));
    const rows: Entry[] = [
      ...memos.map((note) => ({
        type: "memo" as const,
        id: note.id,
        at: note.createdAt,
        note,
      })),
      ...activities.flatMap((activity) => {
        const text = messages.activity.line(
          activity.userId ? (names.get(activity.userId) ?? null) : null,
          activity.kind,
          activity.field,
          activity.before,
          activity.after,
        );
        return text
          ? [
              {
                type: "activity" as const,
                id: activity.id,
                at: activity.createdAt,
                text,
              },
            ]
          : [];
      }),
    ];
    return rows.sort((a, b) => {
      const byTime = a.at.localeCompare(b.at);
      if (byTime !== 0) return byTime;
      // 同じ時刻ならメモを先に置き、時系列の流れを読みやすくする。
      if (a.type === b.type) return 0;
      return a.type === "memo" ? -1 : 1;
    });
  }, [activities, memos, users]);
  const count = entries.length;
  const previousCount = useRef(count);
  useEffect(() => {
    if (count > previousCount.current && thread.current) {
      const reduce = window.matchMedia?.(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      thread.current.scrollTo({
        top: thread.current.scrollHeight,
        behavior: reduce ? "auto" : "smooth",
      });
    }
    previousCount.current = count;
  }, [count]);
  return (
    <ol
      ref={thread}
      className="chat-thread timeline"
      aria-label={messages.chat.history}
      tabIndex={count ? 0 : undefined}
    >
      {entries.map((entry) =>
        entry.type === "memo" ? (
          <ChatMessage
            key={"memo-" + entry.id}
            note={entry.note}
            enter={!!revealingIds?.has(entry.id)}
          />
        ) : (
          <li key={"activity-" + entry.id} className="timeline-activity">
            <div className="timeline-body">
              <p className="timeline-text">{entry.text}</p>
              <time className="timeline-time" dateTime={entry.at}>
                {dateText(entry.at)}
              </time>
            </div>
          </li>
        ),
      )}
      {!count && <li className="timeline-empty">{messages.activity.empty}</li>}
    </ol>
  );
}

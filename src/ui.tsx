import { messages } from "./messages";
import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  AlertCircle,
  ArrowUpRight,
  CalendarDays,
  Check,
  CheckCheck,
  Circle,
  ArrowUp,
  UserRound,
  Flag,
  MessageSquare,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import {
  calendarUrl,
  clockText,
  dateText,
  isOverdue,
  isToday,
  PRIORITY,
  STATUS,
  toDateInput,
} from "./model";
import type { Note, Priority, Status, Todo, TodoDraft } from "./model";
import type { CloudUser, TodoPatch } from "./cloud/types";
export function Mark() {
  return (
    <img
      className="brand-mark"
      src="./favicon.svg"
      alt=""
      width={44}
      height={44}
    />
  );
}
export function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
  alert = false,
  notice,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  alert?: boolean;
  notice?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const pointerOnBackdrop = useRef(false);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={id}
      aria-describedby={subtitle ? id + "-sub" : undefined}
      role={alert ? "alertdialog" : undefined}
      className={"modal " + (wide ? "modal-wide" : "")}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onPointerDown={(e) => {
        pointerOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && pointerOnBackdrop.current)
          onClose();
      }}
    >
      <div className="modal-header">
        <div>
          <h2 id={id}>{title}</h2>
          {subtitle && <p id={id + "-sub"}>{subtitle}</p>}
        </div>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label={messages.common.close}
        >
          <X size={21} />
        </button>
      </div>
      {notice && (
        <div className="modal-save-notice" role="status">
          <Check size={15} />
          {notice}
        </div>
      )}
      {children}
    </dialog>
  );
}
export function TodoCard({
  todo,
  now,
  users,
  onOpen,
  nextDue = false,
  compact = false,
}: {
  todo: Todo;
  now: Date;
  users: CloudUser[];
  onOpen: () => void;
  nextDue?: boolean;
  compact?: boolean;
}) {
  const overdue = isOverdue(todo, now);
  const latest = todo.notes.at(-1);
  const assignee = todo.assigneeId
    ? users.find((user) => user.id === todo.assigneeId)
    : undefined;
  const assigneeName = todo.assigneeId
    ? (assignee?.name ?? messages.todo.assigneeUnknown)
    : null;
  return (
    <button
      className={
        "todo-card group " +
        (compact ? "todo-compact " : "") +
        (todo.status === "done" ? "card-done " : "") +
        (nextDue ? "card-next-deadline" : "")
      }
      onClick={onOpen}
      aria-label={messages.todo.openLabel(todo.title)}
      aria-description={nextDue ? messages.todo.nextDeadline : undefined}
    >
      <div className="card-meta flex items-center justify-between gap-3">
        {!compact && (
          <span className={"status-badge status-" + todo.status}>
            {todo.status === "done" ? (
              <CheckCheck size={14} />
            ) : todo.status === "doing" ? (
              <span className="status-dot" />
            ) : (
              <Circle size={12} />
            )}{" "}
            {STATUS[todo.status]}
          </span>
        )}
        <span className="card-tags">
          {assigneeName && (
            <span className="assignee">
              <UserRound size={13} />
              {assigneeName}
            </span>
          )}
          <span className={"priority priority-" + todo.priority}>
            <Flag size={13} />
            {messages.todo.priorityLabel(PRIORITY[todo.priority])}
          </span>
        </span>
      </div>
      <div className="card-summary">
        <h3>{todo.title}</h3>
        <p
          className={
            "card-description " + (compact ? "line-clamp-1" : "line-clamp-2")
          }
        >
          {todo.description}
        </p>
      </div>
      <div
        className={
          "card-date " +
          (overdue ? "overdue" : nextDue ? "next-deadline-date" : "")
        }
      >
        <CalendarDays size={15} />
        <span>
          {todo.deadline
            ? dateText(
                todo.deadline,
                new Date(todo.deadline).getFullYear() !== now.getFullYear(),
              )
            : messages.todo.noDeadline}
        </span>
        {overdue ? (
          <span className="due-label">{messages.filters.heading.overdue}</span>
        ) : isToday(todo.deadline, now) && todo.status !== "done" ? (
          <span className="due-label today-label">{messages.todo.today}</span>
        ) : null}
      </div>
      {!compact && latest && (
        <div className="card-note">
          <MessageSquare size={15} />
          <span className="line-clamp-1">{latest.text}</span>
        </div>
      )}
      {!compact && (
        <div className="card-footer">
          <span>{messages.todo.noteCount(todo.notes.length)}</span>
          <span className="card-open">
            {messages.todo.open}
            <ArrowUpRight size={16} />
          </span>
        </div>
      )}
    </button>
  );
}
export function TodoForm({
  todo,
  users,
  setDeadline: focusDeadline = false,
  onSave,
  onCancel,
  onDirty,
  ask,
}: {
  todo?: Todo;
  users: CloudUser[];
  setDeadline?: boolean;
  onSave: (draft: TodoDraft) => Promise<boolean>;
  onCancel: () => void;
  onDirty: (dirty: boolean) => void;
  ask: (options: AskOptions) => Promise<boolean>;
}) {
  const [title, setTitle] = useState(todo?.title ?? "");
  const [description, setDescription] = useState(todo?.description ?? "");
  const [noDeadline, setNoDeadline] = useState(
    todo ? todo.deadline === null && !focusDeadline : false,
  );
  const [deadline, setDeadline] = useState(
    todo?.deadline ? toDateInput(todo.deadline) : "",
  );
  const [priority, setPriority] = useState<Priority>(
    todo?.priority ?? "medium",
  );
  const [status, setStatus] = useState<Status>(todo?.status ?? "todo");
  const [assigneeId, setAssigneeId] = useState<string | null>(
    todo?.assigneeId ?? null,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const assigneeMissing =
    assigneeId !== null && !users.some((user) => user.id === assigneeId);
  const dirty =
    title !== (todo?.title ?? "") ||
    description !== (todo?.description ?? "") ||
    noDeadline !== (todo ? todo.deadline === null : false) ||
    deadline !== (todo?.deadline ? toDateInput(todo.deadline) : "") ||
    priority !== (todo?.priority ?? "medium") ||
    status !== (todo?.status ?? "todo") ||
    assigneeId !== (todo?.assigneeId ?? null);
  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!title.trim()) {
      setError(messages.todo.titleRequired);
      return;
    }
    let deadlineIso: string | null = null;
    if (!noDeadline) {
      if (
        !deadline ||
        !Number.isFinite(new Date(deadline).getTime()) ||
        toDateInput(new Date(deadline).toISOString()) !== deadline
      ) {
        setError(messages.todo.invalidDeadline);
        return;
      }
      deadlineIso = new Date(deadline).toISOString();
    }
    if (noDeadline && (!todo || todo.deadline !== null)) {
      const confirmed = await ask({
        title: todo
          ? messages.todo.noDeadlineConfirm.saveTitle
          : messages.todo.noDeadlineConfirm.createTitle,
        description: messages.todo.noDeadlineConfirm.description,
        confirm: todo
          ? messages.todo.noDeadlineConfirm.save
          : messages.todo.noDeadlineConfirm.create,
        cancel: messages.todo.noDeadlineConfirm.set,
      });
      if (!confirmed) {
        setNoDeadline(false);
        requestAnimationFrame(() =>
          document.getElementById("todo-deadline")?.focus(),
        );
        return;
      }
    }
    setSaving(true);
    try {
      await onSave({
        title: title.trim(),
        description: description.trim(),
        deadline: deadlineIso,
        priority,
        status,
        assigneeId,
      });
    } finally {
      setSaving(false);
    }
  }
  return (
    <form onSubmit={submit} className="todo-form">
      <label className="field-label" htmlFor="todo-title">
        {messages.todo.title}
        <span className="required">{messages.common.required}</span>
      </label>
      <input
        autoFocus={!focusDeadline}
        id="todo-title"
        value={title}
        onChange={(e) => {
          setTitle(e.target.value);
          setError("");
        }}
        maxLength={120}
        required
        placeholder={messages.todo.title}
        className="field title-input"
      />
      <div className="field-heading">
        <label className="field-label" htmlFor="todo-description">
          {messages.todo.description}
          <span className="optional">{messages.common.optional}</span>
        </label>
        <span className="char-count">
          {messages.common.characters(description.length, 2000)}
        </span>
      </div>
      <textarea
        id="todo-description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        maxLength={2000}
        rows={3}
        placeholder={messages.todo.description}
        className="field"
      />
      <div className="field-heading">
        <label className="field-label" htmlFor="todo-deadline">
          {messages.todo.deadline}
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={noDeadline}
            onChange={(e) => setNoDeadline(e.target.checked)}
          />
          {messages.todo.omitDeadline}
        </label>
      </div>
      {noDeadline ? (
        <div className="inline-notice">
          <CalendarDays size={17} />
          <span>{messages.todo.noDeadline}</span>
        </div>
      ) : (
        <>
          <input
            autoFocus={focusDeadline}
            id="todo-deadline"
            type="datetime-local"
            className="field"
            value={deadline}
            onChange={(e) => {
              setDeadline(e.target.value);
              setError("");
            }}
            required
          />
        </>
      )}
      <fieldset className="priority-field">
        <legend className="field-label">{messages.todo.priority}</legend>
        <div className="priority-options">
          {(["low", "medium", "high"] as Priority[]).map((p) => (
            <label
              key={p}
              className={
                "priority-option priority-" +
                p +
                (priority === p ? " selected" : "")
              }
            >
              <input
                type="radio"
                name="priority"
                value={p}
                checked={priority === p}
                onChange={() => setPriority(p)}
              />
              <Flag size={15} />
              {PRIORITY[p]}
              {priority === p && <Check size={16} />}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="field-label" htmlFor="todo-assignee">
        {messages.todo.assignee}
      </label>
      <select
        id="todo-assignee"
        className="field"
        value={assigneeId ?? ""}
        onChange={(e) => setAssigneeId(e.target.value || null)}
      >
        <option value="">{messages.filters.assignment.none}</option>
        {assigneeMissing && assigneeId && (
          <option value={assigneeId}>{messages.todo.assigneeUnknown}</option>
        )}
        {users.map((user) => (
          <option key={user.id} value={user.id}>
            {user.name}
          </option>
        ))}
      </select>
      {todo && (
        <>
          <label className="field-label" htmlFor="edit-status">
            {messages.todo.state}
          </label>
          <select
            id="edit-status"
            className="field"
            value={status}
            onChange={(e) => setStatus(e.target.value as Status)}
          >
            {(Object.keys(STATUS) as Status[]).map((s) => (
              <option key={s} value={s}>
                {STATUS[s]}
              </option>
            ))}
          </select>
        </>
      )}
      {error && (
        <p className="form-error" role="alert">
          <AlertCircle size={17} />
          {error}
        </p>
      )}
      <div className="form-actions">
        <button
          type="button"
          className="button button-secondary"
          onClick={onCancel}
        >
          {messages.common.cancel}
        </button>
        <button
          type="submit"
          className="button button-primary"
          disabled={saving}
        >
          {todo ? <Check size={18} /> : <Plus size={18} />}{" "}
          {todo ? messages.todo.save : messages.todo.createAction}
        </button>
      </div>
    </form>
  );
}
export interface AskOptions {
  title: string;
  description: string;
  confirm: string;
  cancel?: string;
  danger?: boolean;
}
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
          {clockText(new Date(note.createdAt))}
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
export function TodoDetail({
  todo,
  now,
  users,
  onUpdate,
  onMemo,
  onEdit,
  onDelete,
  onDirty,
}: {
  todo: Todo;
  now: Date;
  users: CloudUser[];
  onUpdate: (patch: TodoPatch, message: string) => Promise<boolean>;
  onMemo: (body: string) => Promise<boolean>;
  onEdit: (setDeadline?: boolean) => void;
  onDelete: () => void;
  onDirty: (dirty: boolean) => void;
}) {
  const [text, setText] = useState("");
  const [sentIds, setSentIds] = useState<Set<string>>(() => new Set());
  const [pendingReveals, setPendingReveals] = useState(0);
  const thread = useRef<HTMLOListElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const scrollAfterSend = useRef(true);
  const previousNotes = useRef(todo.notes.length);
  const assignee = todo.assigneeId
    ? users.find((user) => user.id === todo.assigneeId)
    : undefined;
  const assigneeName = todo.assigneeId
    ? (assignee?.name ?? messages.todo.assigneeUnknown)
    : null;
  useEffect(() => {
    onDirty(!!text.trim());
  }, [text, onDirty]);
  useEffect(() => {
    if (scrollAfterSend.current && thread.current) {
      thread.current.scrollTo({
        top: thread.current.scrollHeight,
        behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)")
          .matches
          ? "auto"
          : "smooth",
      });
      scrollAfterSend.current = false;
    }
  }, [todo.notes]);
  useEffect(() => {
    const added = todo.notes.length - previousNotes.current;
    if (added > 0 && pendingReveals > 0) {
      const newIds = todo.notes.slice(-added).map((note) => note.id);
      const revealed = newIds.slice(0, pendingReveals);
      setSentIds((ids) => {
        const next = new Set(ids);
        for (const id of revealed) next.add(id);
        return next;
      });
      setPendingReveals((count) => Math.max(0, count - added));
    }
    previousNotes.current = todo.notes.length;
  }, [todo.notes, pendingReveals]);
  const url = calendarUrl(todo);
  async function post(e?: FormEvent) {
    e?.preventDefault();
    const body = text.trim();
    if (!body) return;
    // 応答の再取得でメモが届く前に印を付けておき、失敗時は取り消す。
    setPendingReveals((count) => count + 1);
    if (!(await onMemo(body))) {
      setPendingReveals((count) => Math.max(0, count - 1));
      return;
    }
    scrollAfterSend.current = true;
    setText("");
  }
  return (
    <div className="detail-content">
      <section className="detail-overview" aria-label={messages.todo.details}>
        <div className="detail-meta">
          <span className={"priority priority-" + todo.priority}>
            <Flag size={15} />
            {messages.todo.priorityLabel(PRIORITY[todo.priority])}
          </span>
          {assigneeName && (
            <span className="assignee">
              <UserRound size={15} />
              {assigneeName}
            </span>
          )}
          <span
            className={"detail-due " + (isOverdue(todo, now) ? "overdue" : "")}
          >
            <CalendarDays size={16} />
            {todo.deadline
              ? dateText(todo.deadline, true)
              : messages.todo.noDeadline}
            {isOverdue(todo, now) && (
              <strong>{messages.filters.heading.overdue}</strong>
            )}
          </span>
        </div>
        {todo.description && (
          <p className="detail-description">{todo.description}</p>
        )}
        <div className="detail-controls">
          <div className="status-control">
            <label className="field-label" htmlFor="detail-status">
              {messages.todo.state}
            </label>
            <select
              id="detail-status"
              className="field status-select"
              value={todo.status}
              onChange={(e) =>
                void onUpdate(
                  { status: e.target.value as Status },
                  messages.todo.stateUpdated,
                )
              }
            >
              {(Object.keys(STATUS) as Status[]).map((s) => (
                <option value={s} key={s}>
                  {STATUS[s]}
                </option>
              ))}
            </select>
          </div>
          <button className="button button-secondary" onClick={() => onEdit()}>
            <Pencil size={16} />
            {messages.todo.edit}
          </button>
        </div>
      </section>
      <section className="chat" aria-labelledby="notes-heading">
        <div className="chat-heading">
          <h3 id="notes-heading">{messages.chat.title}</h3>
          <span>{todo.notes.length}</span>
        </div>
        <div className="chat-well">
          <ol
            ref={thread}
            className="chat-thread"
            aria-label={messages.chat.history}
            tabIndex={todo.notes.length ? 0 : undefined}
          >
            {todo.notes.map((note) => (
              <ChatMessage
                key={note.id}
                note={note}
                enter={sentIds.has(note.id)}
              />
            ))}
          </ol>
          <form className="chat-composer" onSubmit={post}>
            <label htmlFor="new-note" className="sr-only">
              {messages.chat.input}
            </label>
            <textarea
              ref={composer}
              id="new-note"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={messages.chat.input}
              maxLength={2000}
              rows={2}
              onKeyDown={(e) => {
                if (
                  (e.ctrlKey || e.metaKey) &&
                  e.key === "Enter" &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  void post();
                }
              }}
            />
            <div className="composer-actions">
              <span className="char-count">
                {messages.common.characters(text.length, 2000)}
              </span>
              <button
                type="submit"
                className="send-button"
                disabled={!text.trim()}
                aria-label={messages.chat.send}
                title={messages.chat.sendShortcut}
                onClick={() => composer.current?.blur()}
              >
                <ArrowUp size={20} />
              </button>
            </div>
          </form>
        </div>
      </section>
      <footer className="detail-footer">
        <button className="text-button danger-text" onClick={onDelete}>
          <Trash2 size={16} />
          {messages.todo.delete}
        </button>
        <div className="calendar-action">
          {url ? (
            <>
              <a
                className="text-button calendar-web"
                href={calendarUrl(todo, true)!}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={messages.calendar.webOpenLabel}
              >
                {messages.calendar.webOpen}
                <ArrowUpRight size={13} />
              </a>
              <a
                className="button button-primary"
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={messages.calendar.openLabel}
              >
                <CalendarDays size={17} />
                {messages.calendar.register}
                <ArrowUpRight size={15} />
              </a>
            </>
          ) : (
            <>
              <span className="calendar-reason">
                {messages.calendar.deadlineMissing}
              </span>
              <button
                className="button button-secondary"
                onClick={() => onEdit(true)}
              >
                <CalendarDays size={17} />
                {messages.calendar.setDeadline}
              </button>
            </>
          )}
        </div>
      </footer>
    </div>
  );
}

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
        <button className="icon-button" onClick={onClose} aria-label="閉じる">
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
  onOpen,
}: {
  todo: Todo;
  now: Date;
  onOpen: () => void;
}) {
  const overdue = isOverdue(todo, now);
  const latest = todo.notes.at(-1);
  return (
    <button
      className={
        "todo-card group " + (todo.status === "done" ? "card-done" : "")
      }
      onClick={onOpen}
      aria-label={todo.title + "の詳細を開く"}
    >
      <div className="flex items-center justify-between gap-3">
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
        <span className={"priority priority-" + todo.priority}>
          <Flag size={13} />
          優先度 {PRIORITY[todo.priority]}
        </span>
      </div>
      <h3>{todo.title}</h3>
      <p className="card-description line-clamp-2">{todo.description}</p>
      <div className={"card-date " + (overdue ? "overdue" : "")}>
        <CalendarDays size={15} />
        <span>
          {todo.deadline
            ? dateText(
                todo.deadline,
                new Date(todo.deadline).getFullYear() !== now.getFullYear(),
              )
            : "期限なし"}
        </span>
        {overdue ? (
          <span className="due-label">期限超過</span>
        ) : isToday(todo.deadline, now) && todo.status !== "done" ? (
          <span className="due-label today-label">今日</span>
        ) : null}
      </div>
      {latest && (
        <div className="card-note">
          <MessageSquare size={15} />
          <span className="line-clamp-1">{latest.text}</span>
        </div>
      )}
      <div className="card-footer">
        <span>{todo.notes.length}件のメモ</span>
        <span className="card-open">
          詳細を開く
          <ArrowUpRight size={16} />
        </span>
      </div>
    </button>
  );
}
export function TodoForm({
  todo,
  setDeadline: focusDeadline = false,
  onSave,
  onCancel,
  onDirty,
  ask,
}: {
  todo?: Todo;
  setDeadline?: boolean;
  onSave: (draft: TodoDraft) => boolean;
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
  const [error, setError] = useState("");
  const dirty =
    title !== (todo?.title ?? "") ||
    description !== (todo?.description ?? "") ||
    noDeadline !== (todo ? todo.deadline === null : false) ||
    deadline !== (todo?.deadline ? toDateInput(todo.deadline) : "") ||
    priority !== (todo?.priority ?? "medium") ||
    status !== (todo?.status ?? "todo");
  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!title.trim()) {
      setError("タイトルを入力してください。");
      return;
    }
    let deadlineIso: string | null = null;
    if (!noDeadline) {
      if (
        !deadline ||
        !Number.isFinite(new Date(deadline).getTime()) ||
        toDateInput(new Date(deadline).toISOString()) !== deadline
      ) {
        setError("有効な期限日時を入力してください。");
        return;
      }
      deadlineIso = new Date(deadline).toISOString();
    }
    if (noDeadline && (!todo || todo.deadline !== null)) {
      const confirmed = await ask({
        title: "期限なしで" + (todo ? "保存" : "作成") + "しますか？",
        description:
          "期限なしのTODOは期限順の最後に表示されます。期限はあとから設定できます。",
        confirm: "期限なしで" + (todo ? "保存" : "作成"),
        cancel: "期限を設定する",
      });
      if (!confirmed) {
        setNoDeadline(false);
        requestAnimationFrame(() =>
          document.getElementById("todo-deadline")?.focus(),
        );
        return;
      }
    }
    onSave({
      title: title.trim(),
      description: description.trim(),
      deadline: deadlineIso,
      priority,
      status,
    });
  }
  return (
    <form onSubmit={submit} className="todo-form">
      <label className="field-label" htmlFor="todo-title">
        タイトル<span className="required">必須</span>
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
        placeholder="タイトル"
        className="field title-input"
      />
      <div className="field-heading">
        <label className="field-label" htmlFor="todo-description">
          説明<span className="optional">任意</span>
        </label>
        <span className="char-count">{description.length} / 2000</span>
      </div>
      <textarea
        id="todo-description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        maxLength={2000}
        rows={3}
        placeholder="説明"
        className="field"
      />
      <div className="field-heading">
        <label className="field-label" htmlFor="todo-deadline">
          期限
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={noDeadline}
            onChange={(e) => setNoDeadline(e.target.checked)}
          />
          期限を設定しない
        </label>
      </div>
      {noDeadline ? (
        <div className="inline-notice">
          <CalendarDays size={17} />
          <span>期限なし</span>
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
        <legend className="field-label">優先度</legend>
        <div className="priority-options">
          {(["high", "medium", "low"] as Priority[]).map((p) => (
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
      {todo && (
        <>
          <label className="field-label" htmlFor="edit-status">
            状態
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
          キャンセル
        </button>
        <button type="submit" className="button button-primary">
          {todo ? <Check size={18} /> : <Plus size={18} />}{" "}
          {todo ? "変更を保存" : "TODOを作成"}
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
export function TodoDetail({
  todo,
  now,
  onUpdate,
  onEdit,
  onDelete,
  onDirty,
}: {
  todo: Todo;
  now: Date;
  onUpdate: (todo: Todo, message: string) => boolean;
  onEdit: (setDeadline?: boolean) => void;
  onDelete: () => void;
  onDirty: (dirty: boolean) => void;
}) {
  const [text, setText] = useState("");
  const thread = useRef<HTMLOListElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const scrollAfterSend = useRef(true);
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
  const url = calendarUrl(todo);
  function post(e?: FormEvent) {
    e?.preventDefault();
    if (!text.trim()) return;
    const note: Note = {
      id: crypto.randomUUID(),
      text: text.trim(),
      createdAt: new Date().toISOString(),
    };
    if (
      onUpdate(
        { ...todo, notes: [...todo.notes, note], updatedAt: note.createdAt },
        "送信しました",
      )
    ) {
      scrollAfterSend.current = true;
      setText("");
      composer.current?.focus();
    }
  }
  return (
    <div className="detail-content">
      <section className="detail-overview" aria-label="TODOの内容">
        <div className="detail-meta">
          <span className={"priority priority-" + todo.priority}>
            <Flag size={15} />
            優先度 {PRIORITY[todo.priority]}
          </span>
          <span
            className={"detail-due " + (isOverdue(todo, now) ? "overdue" : "")}
          >
            <CalendarDays size={16} />
            {todo.deadline ? dateText(todo.deadline, true) : "期限なし"}
            {isOverdue(todo, now) && <strong>期限超過</strong>}
          </span>
        </div>
        {todo.description && (
          <p className="detail-description">{todo.description}</p>
        )}
        <div className="detail-controls">
          <div className="status-control">
            <label className="field-label" htmlFor="detail-status">
              状態
            </label>
            <select
              id="detail-status"
              className="field status-select"
              value={todo.status}
              onChange={(e) =>
                onUpdate(
                  {
                    ...todo,
                    status: e.target.value as Status,
                    updatedAt: new Date().toISOString(),
                  },
                  "状態を更新しました",
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
            TODOを編集
          </button>
        </div>
      </section>
      <section className="chat" aria-labelledby="notes-heading">
        <div className="chat-heading">
          <h3 id="notes-heading">メモ</h3>
          <span>{todo.notes.length}</span>
        </div>
        <ol
          ref={thread}
          className="chat-thread"
          aria-label="メモの履歴"
          tabIndex={todo.notes.length ? 0 : undefined}
        >
          {todo.notes.map((note) => (
            <li key={note.id} className="chat-message">
              <span className="avatar" aria-hidden="true">
                <UserRound size={21} strokeWidth={1.7} />
              </span>
              <div className="message-content">
                <span className="message-name">自分</span>
                <time className="message-time" dateTime={note.createdAt}>
                  {clockText(new Date(note.createdAt))}
                </time>
                <p className="message-text">{note.text}</p>
              </div>
            </li>
          ))}
        </ol>
        <form className="chat-composer" onSubmit={post}>
          <label htmlFor="new-note" className="sr-only">
            メモを入力
          </label>
          <textarea
            ref={composer}
            id="new-note"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="メモを入力"
            maxLength={2000}
            rows={2}
            onKeyDown={(e) => {
              if (
                (e.ctrlKey || e.metaKey) &&
                e.key === "Enter" &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                post();
              }
            }}
          />
          <div className="composer-actions">
            <span className="char-count">{text.length} / 2000</span>
            <button
              type="submit"
              className="send-button"
              disabled={!text.trim()}
              aria-label="送信"
              title="送信（Ctrl+Enter / ⌘+Enter）"
            >
              <ArrowUp size={20} />
            </button>
          </div>
        </form>
      </section>
      <footer className="detail-footer">
        <button className="text-button danger-text" onClick={onDelete}>
          <Trash2 size={16} />
          TODOを削除
        </button>
        <div className="calendar-action">
          {url ? (
            <a
              className="button button-primary"
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Googleカレンダーに登録（別タブで開く）"
            >
              <CalendarDays size={17} />
              Googleカレンダーに登録
              <ArrowUpRight size={15} />
            </a>
          ) : (
            <>
              <span className="calendar-reason">期限未設定</span>
              <button
                className="button button-secondary"
                onClick={() => onEdit(true)}
              >
                <CalendarDays size={17} />
                期限を設定
              </button>
            </>
          )}
        </div>
      </footer>
    </div>
  );
}

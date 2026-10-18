import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  AlertCircle,
  ArrowUpRight,
  CalendarDays,
  Check,
  CheckCheck,
  Circle,
  Clock3,
  Flag,
  MessageSquare,
  Pencil,
  Plus,
  Send,
  Trash2,
  X,
} from "lucide-react";
import {
  calendarUrl,
  dateText,
  isOverdue,
  isToday,
  PRIORITY,
  STATUS,
  toDateInput,
} from "./model";
import type { Note, Priority, Status, Todo, TodoDraft } from "./model";
export function Mark({ small = false }: { small?: boolean }) {
  return (
    <span className={"brand-mark " + (small ? "small" : "")} aria-hidden="true">
      <Check size={small ? 20 : 26} strokeWidth={2.5} />
    </span>
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
      <p className="card-description line-clamp-2">
        {todo.description || "説明はまだありません。詳細から追加できます。"}
      </p>
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
      <div className="card-note">
        <MessageSquare size={15} />
        <span className="line-clamp-1">
          {latest ? latest.text : "進んだことをメモに残そう"}
        </span>
      </div>
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
  onSave,
  onCancel,
  onDirty,
  ask,
}: {
  todo?: Todo;
  onSave: (draft: TodoDraft) => boolean;
  onCancel: () => void;
  onDirty: (dirty: boolean) => void;
  ask: (options: AskOptions) => Promise<boolean>;
}) {
  const [title, setTitle] = useState(todo?.title ?? "");
  const [description, setDescription] = useState(todo?.description ?? "");
  const [noDeadline, setNoDeadline] = useState(
    todo ? todo.deadline === null : false,
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
        autoFocus
        id="todo-title"
        value={title}
        onChange={(e) => {
          setTitle(e.target.value);
          setError("");
        }}
        maxLength={120}
        required
        placeholder="何をしますか？"
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
        placeholder="やることの詳細や、覚えておきたいこと"
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
          <span>期限なしで作成します。あとから設定できます。</span>
        </div>
      ) : (
        <>
          <input
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
          <p className="field-hint">
            この端末の時刻で設定します。期限を過ぎたTODOも登録できます。
          </p>
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
  ask,
}: {
  todo: Todo;
  now: Date;
  onUpdate: (todo: Todo, message: string) => boolean;
  onEdit: () => void;
  onDelete: () => void;
  onDirty: (dirty: boolean) => void;
  ask: (options: AskOptions) => Promise<boolean>;
}) {
  const [text, setText] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const notesEnd = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const [shouldScroll, setShouldScroll] = useState(false);
  const original = todo.notes.find((n) => n.id === editingId)?.text ?? "";
  const dirty = !!text.trim() || (editingId !== null && editText !== original);
  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);
  useEffect(() => {
    if (shouldScroll) {
      notesEnd.current?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
      setShouldScroll(false);
    }
  }, [todo.notes, shouldScroll]);
  const url = calendarUrl(todo);
  const overdue = isOverdue(todo, now);
  function updateNotes(notes: Note[], message: string) {
    return onUpdate(
      { ...todo, notes, updatedAt: new Date().toISOString() },
      message,
    );
  }
  function post(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    if (
      updateNotes(
        [
          ...todo.notes,
          {
            id: crypto.randomUUID(),
            text: text.trim(),
            createdAt: new Date().toISOString(),
          },
        ],
        "メモを保存しました",
      )
    ) {
      setText("");
      setShouldScroll(true);
      composer.current?.focus();
    }
  }
  async function editNote(note: Note) {
    if (
      editingId &&
      editText !== original &&
      !(await ask({
        title: "編集中のメモを破棄しますか？",
        description: "保存していないメモの変更が失われます。",
        confirm: "変更を破棄",
        cancel: "編集を続ける",
        danger: true,
      }))
    )
      return;
    setEditingId(note.id);
    setEditText(note.text);
  }
  return (
    <div className="detail-content">
      <section className="detail-overview">
        <div className="flex items-center gap-3 flex-wrap">
          <span className={"priority priority-" + todo.priority}>
            <Flag size={14} />
            優先度 {PRIORITY[todo.priority]}
          </span>
          <span className={"detail-due " + (overdue ? "overdue" : "")}>
            <CalendarDays size={16} />
            {todo.deadline ? dateText(todo.deadline, true) : "期限なし"}
            {overdue && <strong>期限超過</strong>}
          </span>
        </div>
        <p
          className={"detail-description " + (!todo.description ? "muted" : "")}
        >
          {todo.description || "説明はまだありません。編集から追加できます。"}
        </p>
        <div className="detail-controls">
          <div>
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
          <button className="button button-secondary" onClick={onEdit}>
            <Pencil size={16} />
            TODOを編集
          </button>
        </div>
        <div className="calendar-box">
          {url ? (
            <>
              <a
                className="calendar-link"
                href={url}
                target="_blank"
                rel="noopener noreferrer"
              >
                <CalendarDays size={17} />
                Googleカレンダーに追加
                <ArrowUpRight size={16} />
              </a>
              <p>
                別タブで締切の予定を開きます。最後に保存してください。
                <br />
                締切時刻から15分間の予定です。変更の自動同期はありません。
              </p>
            </>
          ) : (
            <>
              <div className="calendar-unavailable">
                <CalendarDays size={17} />
                Googleカレンダーへの追加
              </div>
              <p>期限を設定すると、締切の予定を追加できます。</p>
              <button className="text-button" onClick={onEdit}>
                期限を設定する
                <ArrowUpRight size={14} />
              </button>
            </>
          )}
        </div>
      </section>
      <section className="notes-section" aria-labelledby="notes-heading">
        <div className="notes-heading">
          <h3 id="notes-heading">
            <MessageSquare size={19} />
            進捗メモ<span>{todo.notes.length}</span>
          </h3>
          <span>ここまでと、これから。</span>
        </div>
        {todo.notes.length === 0 ? (
          <div className="notes-empty">
            <span className="note-empty-icon">
              <MessageSquare size={23} />
            </span>
            <p>小さな進捗も、残しておこう。</p>
            <span>
              「資料を読み終えた」「次はここから」など、自由にどうぞ。
            </span>
          </div>
        ) : (
          <ol className="note-list">
            {todo.notes.map((note) => (
              <li key={note.id} className="note-item">
                <div className="note-top">
                  <time dateTime={note.createdAt}>
                    {dateText(note.createdAt, true)}
                    {note.editedAt && <span> · 編集済み</span>}
                  </time>
                  <div className="note-actions">
                    <button
                      className="icon-button"
                      aria-label="メモを編集"
                      onClick={() => editNote(note)}
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      className="icon-button danger-icon"
                      aria-label="メモを削除"
                      onClick={async () => {
                        if (
                          await ask({
                            title: "このメモを削除しますか？",
                            description: "削除したメモは元に戻せません。",
                            confirm: "メモを削除",
                            danger: true,
                          })
                        ) {
                          if (
                            updateNotes(
                              todo.notes.filter((n) => n.id !== note.id),
                              "メモを削除しました",
                            ) &&
                            editingId === note.id
                          )
                            setEditingId(null);
                        }
                      }}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
                {editingId === note.id ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (
                        editText.trim() &&
                        updateNotes(
                          todo.notes.map((n) =>
                            n.id === note.id
                              ? {
                                  ...n,
                                  text: editText.trim(),
                                  editedAt: new Date().toISOString(),
                                }
                              : n,
                          ),
                          "メモを更新しました",
                        )
                      )
                        setEditingId(null);
                    }}
                  >
                    <label className="sr-only" htmlFor="edit-note">
                      メモを編集
                    </label>
                    <textarea
                      autoFocus
                      id="edit-note"
                      className="field"
                      rows={3}
                      maxLength={2000}
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      required
                    />
                    <div className="note-edit-actions">
                      <button
                        type="button"
                        className="text-button"
                        onClick={async () => {
                          if (
                            editText === original ||
                            (await ask({
                              title: "メモの変更を破棄しますか？",
                              description: "保存前の内容に戻ります。",
                              confirm: "変更を破棄",
                              cancel: "編集を続ける",
                            }))
                          )
                            setEditingId(null);
                        }}
                      >
                        キャンセル
                      </button>
                      <button
                        type="submit"
                        className="button button-primary button-small"
                        disabled={!editText.trim()}
                      >
                        保存する
                      </button>
                    </div>
                  </form>
                ) : (
                  <p className="note-text">{note.text}</p>
                )}
              </li>
            ))}
          </ol>
        )}
        <div ref={notesEnd} />
        <form className="note-composer" onSubmit={post}>
          <label className="field-label" htmlFor="new-note">
            メモを残す
          </label>
          <textarea
            ref={composer}
            id="new-note"
            className="field"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="進んだこと、次にやること…"
            maxLength={2000}
            rows={3}
          />
          <div className="composer-bottom">
            <span>{text.length} / 2000</span>
            <button
              type="submit"
              className="button button-primary button-small"
              disabled={!text.trim()}
            >
              <Send size={15} />
              メモを保存
            </button>
          </div>
        </form>
      </section>
      <div className="detail-bottom">
        <span>
          <Clock3 size={13} />
          作成：{dateText(todo.createdAt, true)}
        </span>
        <button className="text-button danger-text" onClick={onDelete}>
          <Trash2 size={15} />
          TODOを削除
        </button>
      </div>
    </div>
  );
}

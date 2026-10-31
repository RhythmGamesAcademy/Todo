import { messages } from "./messages";
import { useEffect, useId, useMemo, useRef, useState } from "react";
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
  dateText,
  isOverdue,
  isToday,
  MAX_TAGS,
  MAX_TAG_LENGTH,
  PRIORITY,
  REQUEST_TAG,
  STATUS,
  toDateInput,
} from "./model";
import type {
  Priority,
  Status,
  Subtask,
  SubtaskDraft,
  SubtaskPatch,
  Todo,
  TodoDraft,
} from "./model";
import type { Activity, CloudUser, TodoPatch } from "./cloud/types";
import { computeEntries, Timeline } from "./screens/Timeline";
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
        {!compact && todo.tags.includes(REQUEST_TAG) && todo.approvalStatus && (
          <span className={"approval-badge approval-" + todo.approvalStatus}>
            {messages.approval[todo.approvalStatus]}
          </span>
        )}
        <span className="card-tags">
          {compact && todo.subtasks.length > 0 && (
            <span className="subtask-card-count">
              {messages.subtask.count(
                todo.subtasks.filter((subtask) => subtask.status === "done")
                  .length,
                todo.subtasks.length,
              )}
            </span>
          )}
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
      {!compact && todo.tags.length > 0 && (
        <ul className="card-tag-row" aria-label={messages.tags.label}>
          {todo.tags.map((tag) => (
            <li
              key={tag}
              className={
                "tag-chip" + (tag === REQUEST_TAG ? " tag-request" : "")
              }
            >
              {tag}
            </li>
          ))}
        </ul>
      )}
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
          <span className="card-counts">
            <span>{messages.todo.noteCount(todo.notes.length)}</span>
            {todo.subtasks.length > 0 && (
              <span>
                {messages.subtask.count(
                  todo.subtasks.filter((subtask) => subtask.status === "done")
                    .length,
                  todo.subtasks.length,
                )}
              </span>
            )}
          </span>
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
  tagSuggestions = [],
  setDeadline: focusDeadline = false,
  onSave,
  onCancel,
  onDirty,
  ask,
}: {
  todo?: Todo;
  users: CloudUser[];
  tagSuggestions?: string[];
  setDeadline?: boolean;
  onSave: (draft: TodoDraft) => Promise<boolean>;
  onCancel: () => void;
  onDirty: (dirty: boolean) => void;
  ask: (options: AskOptions) => Promise<boolean>;
}) {
  const [title, setTitle] = useState(todo?.title ?? "");
  const [description, setDescription] = useState(todo?.description ?? "");
  const [tags, setTags] = useState<string[]>(todo?.tags ?? []);
  const [tagDraft, setTagDraft] = useState("");
  const [tagError, setTagError] = useState("");
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
    tags.join("\n") !== (todo?.tags ?? []).join("\n") ||
    noDeadline !== (todo ? todo.deadline === null : false) ||
    deadline !== (todo?.deadline ? toDateInput(todo.deadline) : "") ||
    priority !== (todo?.priority ?? "medium") ||
    status !== (todo?.status ?? "todo") ||
    assigneeId !== (todo?.assigneeId ?? null);
  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);
  function commitTag(raw: string): boolean {
    const tag = raw.trim();
    if (!tag) return true;
    if (tags.includes(tag)) {
      setTagDraft("");
      return true;
    }
    if (tag.length > MAX_TAG_LENGTH) {
      setTagError(messages.tags.errorLength);
      return false;
    }
    if (tags.length >= MAX_TAGS) {
      setTagError(messages.tags.errorCount);
      return false;
    }
    setTags((current) => [...current, tag]);
    setTagDraft("");
    return true;
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!title.trim()) {
      setError(messages.todo.titleRequired);
      return;
    }
    // 入力途中のタグも保存対象に取り込む(チップ未確定のまま保存を許す)。
    let savedTags = tags;
    const pendingTag = tagDraft.trim();
    if (pendingTag) {
      if (!commitTag(pendingTag)) return; // commitTag 側でエラーを設定済み
      savedTags = [...tags, ...[pendingTag]].filter(
        (tag, index, all) => all.indexOf(tag) === index,
      );
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
        tags: savedTags,
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
      <fieldset className="tags-field">
        <legend className="field-label">
          {messages.tags.label}
          <span className="optional">{messages.common.optional}</span>
          <span className="char-count">{messages.tags.max(tags.length)}</span>
        </legend>
        {tags.length > 0 && (
          <ul className="tag-chips" aria-label={messages.tags.label}>
            {tags.map((tag) => (
              <li
                key={tag}
                className={
                  "tag-chip" + (tag === REQUEST_TAG ? " tag-request" : "")
                }
              >
                {tag}
                <button
                  type="button"
                  className="icon-button tag-remove"
                  aria-label={messages.tags.removeLabel(tag)}
                  onClick={() => {
                    setTags((current) => current.filter((t) => t !== tag));
                    setTagError("");
                  }}
                >
                  <X size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <input
          id="todo-tags"
          list="todo-tag-suggestions"
          value={tagDraft}
          maxLength={MAX_TAG_LENGTH}
          placeholder={messages.tags.input}
          className="field"
          onChange={(e) => {
            setTagDraft(e.target.value);
            setTagError("");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              commitTag(e.currentTarget.value);
            }
          }}
          onBlur={(e) => commitTag(e.currentTarget.value)}
        />
        <datalist id="todo-tag-suggestions">
          {tagSuggestions
            .filter((tag) => !tags.includes(tag))
            .map((tag) => (
              <option key={tag} value={tag} />
            ))}
        </datalist>
        {tagError && (
          <p className="form-error" role="alert">
            <AlertCircle size={17} />
            {tagError}
          </p>
        )}
      </fieldset>
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
function SubtaskForm({
  subtask,
  onSave,
  onCancel,
  onDirty,
  ask,
}: {
  subtask?: Subtask;
  onSave: (draft: SubtaskDraft) => Promise<boolean>;
  onCancel: () => void;
  onDirty: (dirty: boolean) => void;
  ask: (options: AskOptions) => Promise<boolean>;
}) {
  const [title, setTitle] = useState(subtask?.title ?? "");
  const [noDeadline, setNoDeadline] = useState(
    subtask ? subtask.deadline === null : false,
  );
  const [deadline, setDeadline] = useState(
    subtask?.deadline ? toDateInput(subtask.deadline) : "",
  );
  const [priority, setPriority] = useState<Priority>(
    subtask?.priority ?? "medium",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dirty =
    title !== (subtask?.title ?? "") ||
    noDeadline !== (subtask ? subtask.deadline === null : false) ||
    deadline !== (subtask?.deadline ? toDateInput(subtask.deadline) : "") ||
    priority !== (subtask?.priority ?? "medium");
  const prefix = subtask ? "edit-subtask-" : "new-subtask-";

  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!title.trim()) {
      setError(messages.subtask.titleRequired);
      return;
    }
    let deadlineIso: string | null = null;
    if (!noDeadline) {
      if (
        !deadline ||
        !Number.isFinite(new Date(deadline).getTime()) ||
        toDateInput(new Date(deadline).toISOString()) !== deadline
      ) {
        setError(messages.subtask.invalidDeadline);
        return;
      }
      deadlineIso = new Date(deadline).toISOString();
    }
    if (noDeadline && (!subtask || subtask.deadline !== null)) {
      const confirmed = await ask({
        title: messages.subtask.noDeadlineConfirm.title,
        description: messages.subtask.noDeadlineConfirm.description,
        confirm: messages.subtask.noDeadlineConfirm.save,
        cancel: messages.subtask.noDeadlineConfirm.set,
      });
      if (!confirmed) {
        setNoDeadline(false);
        requestAnimationFrame(() =>
          document.getElementById(prefix + "deadline")?.focus(),
        );
        return;
      }
    }
    setSaving(true);
    try {
      if (
        await onSave({
          title: title.trim(),
          status: subtask?.status ?? "todo",
          priority,
          deadline: deadlineIso,
        })
      )
        setError("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="subtask-form" onSubmit={submit}>
      <label className="field-label" htmlFor={prefix + "title"}>
        {messages.subtask.title}
        <span className="required">{messages.common.required}</span>
      </label>
      <input
        autoFocus
        id={prefix + "title"}
        className="field"
        value={title}
        onChange={(e) => {
          setTitle(e.target.value);
          setError("");
        }}
        maxLength={120}
        required
      />
      <div className="field-heading">
        <label className="field-label" htmlFor={prefix + "deadline"}>
          {messages.subtask.deadline}
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={noDeadline}
            onChange={(e) => {
              setNoDeadline(e.target.checked);
              setError("");
            }}
          />
          {messages.subtask.noDeadline}
        </label>
      </div>
      {noDeadline ? (
        <div className="inline-notice">
          <CalendarDays size={17} />
          <span>{messages.todo.noDeadline}</span>
        </div>
      ) : (
        <input
          id={prefix + "deadline"}
          type="datetime-local"
          className="field"
          value={deadline}
          onChange={(e) => {
            setDeadline(e.target.value);
            setError("");
          }}
          required
        />
      )}
      <fieldset className="priority-field">
        <legend className="field-label">{messages.subtask.priority}</legend>
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
                name={prefix + "priority"}
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
          <Check size={18} />
          {subtask ? messages.subtask.save : messages.subtask.add}
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
/** 申請タグ付きTODOの承認/否認。否認は理由入力を必須にする。 */
function ApprovalPanel({
  todo,
  ask,
  onApprove,
  onReject,
}: {
  todo: Todo;
  ask: (options: AskOptions) => Promise<boolean>;
  onApprove: () => Promise<boolean>;
  onReject: (reason: string) => Promise<boolean>;
}) {
  const [deciding, setDeciding] = useState<"" | "reject">("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function approve() {
    const confirmed = await ask({
      title: messages.approval.approveConfirmTitle,
      description: messages.approval.approveConfirmDescription(todo.title),
      confirm: messages.approval.approve,
    });
    if (!confirmed) return;
    setSaving(true);
    try {
      if (await onApprove()) {
        setReason("");
        setError("");
      }
    } finally {
      setSaving(false);
    }
  }
  async function reject(e: FormEvent) {
    e.preventDefault();
    const body = reason.trim();
    if (!body) {
      setError(messages.approval.reasonRequired);
      return;
    }
    setSaving(true);
    try {
      if (await onReject(body)) {
        setReason("");
        setError("");
        setDeciding("");
      }
    } finally {
      setSaving(false);
    }
  }
  const status = todo.approvalStatus;
  return (
    <section className="approval" aria-label={messages.approval.label}>
      <div className="approval-heading">
        <span
          className={
            "approval-badge approval-" + (status === null ? "none" : status)
          }
        >
          {status === null
            ? messages.approval.pending
            : messages.approval[status]}
        </span>
        {status !== "approved" && (
          <div className="approval-actions">
            <button
              type="button"
              className="button button-primary"
              disabled={saving}
              onClick={() => void approve()}
            >
              <Check size={16} />
              {messages.approval.approve}
            </button>
            <button
              type="button"
              className="button button-danger"
              disabled={saving}
              onClick={() => setDeciding("reject")}
            >
              <X size={16} />
              {messages.approval.reject}
            </button>
          </div>
        )}
      </div>
      {status === "rejected" && todo.approvalReason && (
        <p className="approval-reason">
          <strong>{messages.approval.reasonHeading}</strong>
          {todo.approvalReason}
        </p>
      )}
      {deciding === "reject" && (
        <form className="approval-reject-form" onSubmit={(e) => void reject(e)}>
          <label className="field-label" htmlFor="approval-reason">
            {messages.approval.reasonLabel}
            <span className="required">{messages.common.required}</span>
          </label>
          <textarea
            id="approval-reason"
            className="field"
            rows={2}
            autoFocus
            maxLength={2000}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setError("");
            }}
            placeholder={messages.approval.reasonPlaceholder}
          />
          <div className="field-heading">
            <span className="char-count">
              {messages.common.characters(reason.length, 2000)}
            </span>
          </div>
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
              onClick={() => {
                setDeciding("");
                setReason("");
                setError("");
              }}
            >
              {messages.common.cancel}
            </button>
            <button
              type="submit"
              className="button button-danger"
              disabled={saving || !reason.trim()}
            >
              {messages.approval.reject}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
export function TodoDetail({
  todo,
  now,
  users,
  meId,
  activities,
  onUpdate,
  onMemo,
  onSubtaskAdd,
  onSubtaskUpdate,
  onSubtaskDelete,
  onSubtaskMemo,
  onApprove,
  onReject,
  onEdit,
  onDelete,
  onDirty,
  ask,
}: {
  todo: Todo;
  now: Date;
  users: CloudUser[];
  meId: string | null;
  activities: Activity[];
  onUpdate: (patch: TodoPatch, message: string) => Promise<boolean>;
  onMemo: (body: string) => Promise<boolean>;
  onSubtaskAdd: (draft: SubtaskDraft) => Promise<boolean>;
  onSubtaskUpdate: (
    subtaskId: string,
    patch: SubtaskPatch,
    message: string,
  ) => Promise<boolean>;
  onSubtaskDelete: (subtask: Subtask) => void;
  onSubtaskMemo: (subtaskId: string, body: string) => Promise<boolean>;
  onApprove: () => Promise<boolean>;
  onReject: (reason: string) => Promise<boolean>;
  onEdit: (setDeadline?: boolean) => void;
  onDelete: () => void;
  onDirty: (dirty: boolean) => void;
  ask: (options: AskOptions) => Promise<boolean>;
}) {
  const [text, setText] = useState("");
  const [sentIds, setSentIds] = useState<Set<string>>(() => new Set());
  const [pendingReveals, setPendingReveals] = useState(0);
  const [editingSubtaskId, setEditingSubtaskId] = useState<string | "new">("");
  const [subtaskFormDirty, setSubtaskFormDirty] = useState(false);
  const [subtaskMemos, setSubtaskMemos] = useState<Record<string, string>>({});
  const composer = useRef<HTMLTextAreaElement>(null);
  const previousNotes = useRef(todo.notes.length);
  const timelineCount = useMemo(
    () => computeEntries(activities, todo.notes, users).length,
    [activities, todo.notes, users],
  );
  const assignee = todo.assigneeId
    ? users.find((user) => user.id === todo.assigneeId)
    : undefined;
  const assigneeName = todo.assigneeId
    ? (assignee?.name ?? messages.todo.assigneeUnknown)
    : null;
  useEffect(() => {
    onDirty(
      !!text.trim() ||
        subtaskFormDirty ||
        Object.values(subtaskMemos).some((memo) => !!memo.trim()),
    );
  }, [text, subtaskFormDirty, subtaskMemos, onDirty]);
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
    setText("");
  }
  async function saveSubtask(draft: SubtaskDraft) {
    const saved =
      editingSubtaskId === "new"
        ? await onSubtaskAdd(draft)
        : await onSubtaskUpdate(
            editingSubtaskId,
            draft,
            messages.subtask.saved,
          );
    if (saved) {
      setEditingSubtaskId("");
      setSubtaskFormDirty(false);
    }
    return saved;
  }
  async function cancelSubtaskForm() {
    if (
      subtaskFormDirty &&
      !(await ask({
        title: messages.discard.title,
        description: messages.discard.description,
        confirm: messages.discard.detail,
        cancel: messages.discard.keep,
        danger: true,
      }))
    )
      return;
    setEditingSubtaskId("");
    setSubtaskFormDirty(false);
  }
  async function editSubtask(subtask: Subtask) {
    if (
      (subtaskFormDirty ||
        Object.values(subtaskMemos).some((memo) => !!memo.trim())) &&
      !(await ask({
        title: messages.discard.title,
        description: messages.discard.description,
        confirm: messages.discard.detail,
        cancel: messages.discard.keep,
        danger: true,
      }))
    )
      return;
    setSubtaskMemos({});
    setSubtaskFormDirty(false);
    setEditingSubtaskId(subtask.id);
  }
  async function submitSubtaskMemo(subtaskId: string) {
    const body = subtaskMemos[subtaskId]?.trim() ?? "";
    if (!body) return;
    if (await onSubtaskMemo(subtaskId, body))
      setSubtaskMemos((memos) => ({ ...memos, [subtaskId]: "" }));
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
        {todo.tags.length > 0 && (
          <ul className="detail-tag-row" aria-label={messages.tags.label}>
            {todo.tags.map((tag) => (
              <li
                key={tag}
                className={
                  "tag-chip" + (tag === REQUEST_TAG ? " tag-request" : "")
                }
              >
                {tag}
              </li>
            ))}
          </ul>
        )}
        {todo.tags.includes(REQUEST_TAG) && (
          <ApprovalPanel
            todo={todo}
            ask={ask}
            onApprove={onApprove}
            onReject={onReject}
          />
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
      <section className="subtasks" aria-labelledby="subtasks-heading">
        <div className="subtasks-heading">
          <div className="subtasks-title">
            <h3 id="subtasks-heading">{messages.subtask.heading}</h3>
            <span>
              {messages.subtask.count(
                todo.subtasks.filter((subtask) => subtask.status === "done")
                  .length,
                todo.subtasks.length,
              )}
            </span>
          </div>
          {editingSubtaskId === "" && (
            <button
              className="button button-secondary subtask-add"
              onClick={() => setEditingSubtaskId("new")}
            >
              <Plus size={16} />
              {messages.subtask.add}
            </button>
          )}
        </div>
        {editingSubtaskId === "new" && (
          <SubtaskForm
            onSave={saveSubtask}
            onCancel={() => void cancelSubtaskForm()}
            onDirty={setSubtaskFormDirty}
            ask={ask}
          />
        )}
        {todo.subtasks.length > 0 && (
          <ul className="subtask-list">
            {todo.subtasks.map((subtask) => {
              const subtaskDeadline = subtask.deadline
                ? dateText(subtask.deadline, true)
                : messages.todo.noDeadline;
              return (
                <li
                  className={
                    "subtask-item " +
                    (subtask.status === "done" ? "subtask-done" : "")
                  }
                  key={subtask.id}
                >
                  {editingSubtaskId === subtask.id ? (
                    <SubtaskForm
                      subtask={subtask}
                      onSave={saveSubtask}
                      onCancel={() => void cancelSubtaskForm()}
                      onDirty={setSubtaskFormDirty}
                      ask={ask}
                    />
                  ) : (
                    <>
                      <div className="subtask-row">
                        <input
                          type="checkbox"
                          checked={subtask.status === "done"}
                          aria-label={messages.subtask.toggleLabel(
                            subtask.title,
                          )}
                          onChange={(e) =>
                            void onSubtaskUpdate(
                              subtask.id,
                              { status: e.target.checked ? "done" : "todo" },
                              messages.subtask.stateUpdated,
                            )
                          }
                        />
                        <div className="subtask-main">
                          <strong>{subtask.title}</strong>
                          <div className="subtask-meta">
                            <span
                              className={
                                "priority priority-" + subtask.priority
                              }
                            >
                              <Flag size={13} />
                              {messages.todo.priorityLabel(
                                PRIORITY[subtask.priority],
                              )}
                            </span>
                            <span className="subtask-deadline">
                              <CalendarDays size={13} />
                              {subtaskDeadline}
                            </span>
                            <span className="subtask-memo-count">
                              <MessageSquare size={13} />
                              {messages.subtask.memoCount(subtask.memos.length)}
                            </span>
                          </div>
                        </div>
                        <div className="subtask-actions">
                          <button
                            className="icon-button"
                            onClick={() => void editSubtask(subtask)}
                            aria-label={messages.subtask.editLabel(
                              subtask.title,
                            )}
                          >
                            <Pencil size={16} />
                          </button>
                          <button
                            className="icon-button danger-icon"
                            onClick={() => onSubtaskDelete(subtask)}
                            aria-label={messages.subtask.deleteLabel(
                              subtask.title,
                            )}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                      <form
                        className="subtask-memo"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void submitSubtaskMemo(subtask.id);
                        }}
                      >
                        <label
                          className="sr-only"
                          htmlFor={"subtask-memo-" + subtask.id}
                        >
                          {messages.subtask.memoInput}
                        </label>
                        <input
                          id={"subtask-memo-" + subtask.id}
                          value={subtaskMemos[subtask.id] ?? ""}
                          maxLength={2000}
                          placeholder={messages.subtask.memoInput}
                          onChange={(e) =>
                            setSubtaskMemos((memos) => ({
                              ...memos,
                              [subtask.id]: e.target.value,
                            }))
                          }
                        />
                        <button
                          type="submit"
                          className="button button-secondary"
                          disabled={!subtaskMemos[subtask.id]?.trim()}
                        >
                          {messages.subtask.memoSend}
                        </button>
                      </form>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {todo.subtasks.length === 0 && editingSubtaskId === "" && (
          <p className="subtask-empty">{messages.subtask.empty}</p>
        )}
      </section>
      <section className="chat" aria-labelledby="notes-heading">
        <div className="chat-heading">
          <h3 id="notes-heading">{messages.activity.heading}</h3>
          <span>{timelineCount}</span>
        </div>
        <div className="chat-well">
          <Timeline
            activities={activities}
            memos={todo.notes}
            users={users}
            meId={meId}
            revealingIds={sentIds}
          />
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

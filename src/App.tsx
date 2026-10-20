import { messages } from "./messages";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowDownUp,
  Check,
  ChevronRight,
  LayoutGrid,
  List,
  LockKeyhole,
  Plus,
  Search,
  Settings,
  UserRound,
  X,
} from "lucide-react";
import {
  FILTER_LABEL,
  isOverdue,
  isToday,
  nextDeadlineId,
  selectTodos,
} from "./model";
import type {
  AssigneeFilter,
  Filter,
  Sort,
  Status,
  Todo,
  TodoDraft,
} from "./model";
import type { TodoPatch } from "./cloud/types";
import { useBoard } from "./cloud/useBoard";
import { resolveSession, writeSession } from "./cloud/session";
import type { Session } from "./cloud/session";
import { useTodoLayout } from "./storage";
import { DataPanel } from "./DataPanel";
import { Mark, Modal, TodoCard, TodoDetail, TodoForm } from "./ui";
import type { AskOptions } from "./ui";
import { LoginScreen } from "./screens/LoginScreen";
import { ManageScreen } from "./screens/ManageScreen";
import { TodoNavigation } from "./components/TodoNavigation";
import { CompletionCelebration } from "./completion/CompletionCelebration";
import { useCompletionQueue } from "./completion/useCompletionQueue";
import { CompletionNotice } from "./completion/CompletionNotice";
type View =
  | { type: "create" }
  | { type: "detail" | "edit"; id: string; setDeadline?: boolean }
  | { type: "data" }
  | { type: "manage" }
  | null;
type Confirm = AskOptions & { resolve: (answer: boolean) => void };
type Undo = { id: string };
export default function App() {
  // resolveSession() はハッシュのトークンを URL から消すため、初回だけ実行する。
  const bootRef = useRef<ReturnType<typeof resolveSession> | null>(null);
  if (bootRef.current === null) bootRef.current = resolveSession();
  const boot = bootRef.current;
  const [currentSession, setCurrentSession] = useState<Session | null>(
    boot.session,
  );
  const [prefillToken, setPrefillToken] = useState<string | null>(boot.token);
  const onSessionLost = useCallback(() => {
    // 404 が重なって複数回呼ばれても同じ状態に収束させる。
    writeSession(null);
    setCurrentSession(null);
    setPrefillToken(null);
    setView(null);
    setConfirmation(null);
    setActionError(null);
    setDirty(false);
    setToast(null);
    setPendingCompletion(null);
  }, []);
  const board = useBoard(currentSession, onSessionLost);
  const state = board.phase === "ready" ? board.state : null;
  const todos = state ? state.todos : [];
  const users = state ? state.users : [];
  const activities = state ? state.activities : [];
  const meId = board.phase === "ready" ? board.me.userId : null;
  const [layout, changeLayout] = useTodoLayout();
  const [now, setNow] = useState(() => new Date());
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("deadline");
  const [assigneeFilter, setAssigneeFilter] = useState<AssigneeFilter>("any");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<View>(null);
  const [dirty, setDirty] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirm | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingCompletion, setPendingCompletion] = useState<{
    id: string;
    status: Status;
  } | null>(null);
  const [toast, setToast] = useState<{ message: string; undo?: Undo } | null>(
    null,
  );
  const completionTodos = useMemo(
    () =>
      pendingCompletion
        ? todos.map((todo) =>
            todo.id === pendingCompletion.id
              ? { ...todo, status: pendingCompletion.status }
              : todo,
          )
        : todos,
    [todos, pendingCompletion],
  );
  const prepareCompletion = useCallback(() => {
    setFilter("active");
    setSearch("");
    setToast(null);
  }, []);
  const completion = useCompletionQueue(
    completionTodos,
    !!view || !!confirmation,
    prepareCompletion,
  );
  const ask = useCallback(
    (options: AskOptions) =>
      new Promise<boolean>((resolve) =>
        setConfirmation({ ...options, resolve }),
      ),
    [],
  );
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!toast || toast.undo) return;
    const timer = window.setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const counts: Record<Filter, number> = {
    all: todos.length,
    overdue: todos.filter((todo) => isOverdue(todo, now)).length,
    active: todos.filter((t) => t.status !== "done").length,
    today: todos.filter((t) => t.status !== "done" && isToday(t.deadline, now))
      .length,
    doing: todos.filter((t) => t.status === "doing").length,
    done: todos.filter((t) => t.status === "done").length,
  };
  const visible = useMemo(
    () => selectTodos(todos, filter, search, sort, now, assigneeFilter),
    [todos, filter, search, sort, now, assigneeFilter],
  );
  const selected =
    view && (view.type === "detail" || view.type === "edit")
      ? todos.find((t) => t.id === view.id)
      : undefined;
  const nextDueId = useMemo(() => nextDeadlineId(todos, now), [todos, now]);
  useEffect(() => {
    if (board.phase !== "ready") return;
    if (view && (view.type === "detail" || view.type === "edit") && !selected) {
      setView(null);
      setDirty(false);
    }
  }, [board.phase, view, selected]);
  useEffect(() => {
    // 別端末で自分が削除された場合も、セッションを失効させて参加画面へ戻す。
    if (board.phase !== "ready") return;
    if (!board.state.users.some((user) => user.id === board.me.userId))
      onSessionLost();
  }, [board, onSessionLost]);
  async function act(call: () => Promise<unknown>) {
    setActionError(null);
    try {
      await call();
      return true;
    } catch {
      setActionError(messages.errors.api.general);
      return false;
    }
  }
  async function allowDiscard(action: string = messages.discard.close) {
    if (!dirty) return true;
    return ask({
      title: messages.discard.title,
      description: messages.discard.description,
      confirm: action,
      cancel: messages.discard.keep,
      danger: true,
    });
  }
  async function closeView() {
    if (await allowDiscard()) {
      setDirty(false);
      setView(null);
    }
  }
  function openCreate() {
    setToast(null);
    setDirty(false);
    setView({ type: "create" });
  }
  async function updateTodo(id: string, patch: TodoPatch, message: string) {
    const previous = todos.find((t) => t.id === id);
    const completing =
      !!previous && previous.status !== "done" && patch.status === "done";
    // 再取得で先に done になっても、演出の順番待ちに並ぶまでは件数を増やさない。
    if (previous && completing)
      setPendingCompletion({ id, status: previous.status });
    if (!(await act(() => board.updateTodo(id, patch)))) {
      if (completing) setPendingCompletion(null);
      return false;
    }
    setToast({ message });
    if (previous && completing) {
      completion.enqueue({ ...previous, ...patch, status: "done" });
      setPendingCompletion(null);
    }
    return true;
  }
  async function addMemo(todoId: string, body: string) {
    if (!(await act(() => board.addMemo(todoId, body)))) return false;
    setToast({ message: messages.chat.sent });
    return true;
  }
  async function saveDraft(draft: TodoDraft) {
    if (view?.type === "create") {
      if (!(await act(() => board.addTodo(draft)))) return false;
      setSearch("");
      setFilter("all");
      setDirty(false);
      // 作成直後の詳細表示に必要な ID は API 応答に含まれないため一覧へ戻る。
      setView(null);
      setToast({ message: messages.todo.created });
      return true;
    }
    if (!selected) return false;
    const patch: TodoPatch = {};
    if (draft.title !== selected.title) patch.title = draft.title;
    if (draft.description !== selected.description)
      patch.description = draft.description;
    if (draft.deadline !== selected.deadline) patch.deadline = draft.deadline;
    if (draft.priority !== selected.priority) patch.priority = draft.priority;
    if (draft.status !== selected.status) patch.status = draft.status;
    if (draft.assigneeId !== selected.assigneeId)
      patch.assigneeId = draft.assigneeId;
    const fields = Object.keys(patch);
    if (fields.length === 0) {
      setActionError(null);
      setToast({ message: messages.todo.saved });
    } else if (fields.length === 1 && fields[0] === "assigneeId") {
      if (
        !(await act(() =>
          board.setAssignee(selected.id, patch.assigneeId ?? null),
        ))
      )
        return false;
      setToast({ message: messages.todo.saved });
    } else if (!(await updateTodo(selected.id, patch, messages.todo.saved))) {
      return false;
    }
    setDirty(false);
    setView({ type: "detail", id: selected.id });
    return true;
  }
  async function deleteTodo(todo: Todo) {
    if (
      await ask({
        title: messages.todo.deleteTitle,
        description: messages.todo.deleteDescription(
          todo.title,
          todo.notes.length,
        ),
        confirm: messages.todo.delete,
        danger: true,
      })
    ) {
      if (await act(() => board.removeTodo(todo.id))) {
        setView(null);
        setDirty(false);
        setToast({
          message: messages.todo.deleted,
          undo: { id: todo.id },
        });
      }
    }
  }
  if (board.phase === "login") {
    return (
      <div className="app-shell login-shell">
        <LoginScreen
          prefillToken={prefillToken}
          onJoined={(session) => {
            writeSession(session);
            setCurrentSession(session);
            setPrefillToken(null);
          }}
        />
      </div>
    );
  }
  if (board.phase === "loading") {
    return (
      <div className="app-shell board-status" role="status">
        <Mark />
        <p>{messages.board.loading}</p>
      </div>
    );
  }
  if (board.phase === "error") {
    return (
      <div className="app-shell board-status" role="alert">
        <AlertCircle size={23} />
        <p>{board.message}</p>
        <button className="button button-primary" onClick={board.refresh}>
          {messages.common.retry}
        </button>
      </div>
    );
  }
  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">
        {messages.app.skipToMain}
      </a>
      <header className="topbar">
        <span className="header-glass" aria-hidden="true" />
        <svg
          className="header-waves"
          viewBox="0 0 1600 32"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path d="M-20 20C180 20 280 5 480 13S790 31 1030 15 1380 7 1620 20" />
          <path
            className="header-wave-fine"
            d="M-20 10C180 10 280-5 480 3S790 21 1030 5 1380-3 1620 10"
          />
        </svg>
        <div className="brand">
          <Mark />
          <span className="brand-name">{messages.app.title}</span>
        </div>
        <div className="header-tools">
          <div className="clock" aria-label={messages.app.currentTime}>
            <time dateTime={now.toISOString()}>
              <span className="clock-date">
                {messages.dateTime.headerDate(now)}
              </span>{" "}
              <span className="clock-time">
                {messages.dateTime.headerTime(now)}
              </span>
            </time>
          </div>
          <button
            className="mobile-data icon-button"
            onClick={() => setView({ type: "manage" })}
            aria-label={messages.manage.title}
          >
            <Settings size={21} />
          </button>
        </div>
      </header>
      <aside className="sidebar">
        <TodoNavigation
          filter={filter}
          counts={{ ...counts, done: completion.displayedCount }}
          onSelect={(key) => {
            setFilter(key);
            setSearch("");
          }}
          doneTarget={completion.target}
          doneCounter={completion.counter}
          arrival={completion.arrival}
        />
        <div className="sidebar-bottom">
          <button
            className="storage-nav"
            onClick={() => {
              setView({ type: "manage" });
            }}
          >
            <Settings size={18} />
            <span>{messages.manage.title}</span>
            <ChevronRight size={15} />
          </button>
        </div>
      </aside>
      <div className="workspace">
        <main id="main" className="main-content" tabIndex={-1}>
          {actionError && (
            <div className="storage-error" role="alert">
              <AlertCircle size={19} />
              <div>
                <p>{actionError}</p>
              </div>
            </div>
          )}
          <div className="page-heading">
            <h1 id="list-heading">
              {FILTER_LABEL[filter]}
              <span className="heading-count">{visible.length}</span>
            </h1>
            <button
              className="button button-primary create-button"
              onClick={openCreate}
            >
              <Plus size={19} />
              {messages.todo.create}
            </button>
          </div>
          <section className="todo-section" aria-labelledby="list-heading">
            <div className="toolbar">
              <div className="search-wrap">
                <Search size={18} />
                <label htmlFor="todo-search" className="sr-only">
                  {messages.search.label}
                </label>
                <input
                  id="todo-search"
                  type="search"
                  placeholder={messages.search.label}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {search && (
                  <button
                    className="icon-button"
                    onClick={() => setSearch("")}
                    aria-label={messages.search.clear}
                  >
                    <X size={17} />
                  </button>
                )}
              </div>
              <div className="list-controls">
                <div className="sort-wrap assignee-filter">
                  <UserRound size={16} />
                  <label htmlFor="todo-assignee-filter">
                    {messages.search.assignee}
                  </label>
                  <select
                    id="todo-assignee-filter"
                    value={assigneeFilter}
                    onChange={(e) =>
                      setAssigneeFilter(e.target.value as AssigneeFilter)
                    }
                  >
                    <option value="any">
                      {messages.filters.assignment.any}
                    </option>
                    <option value="none">
                      {messages.filters.assignment.none}
                    </option>
                    {users.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sort-wrap">
                  <ArrowDownUp size={17} />
                  <label htmlFor="todo-sort">{messages.search.sort}</label>
                  <select
                    id="todo-sort"
                    value={sort}
                    onChange={(e) => setSort(e.target.value as Sort)}
                  >
                    <option value="deadline">
                      {messages.search.deadlineOrder}
                    </option>
                    <option value="priority">
                      {messages.search.priorityOrder}
                    </option>
                  </select>
                </div>
                <div
                  className="layout-switch"
                  role="group"
                  aria-label={messages.layout.label}
                >
                  <button
                    type="button"
                    aria-pressed={layout === "cards"}
                    onClick={() => changeLayout("cards")}
                  >
                    <LayoutGrid size={16} />
                    {messages.layout.cards}
                  </button>
                  <button
                    type="button"
                    aria-pressed={layout === "compact"}
                    onClick={() => changeLayout("compact")}
                  >
                    <List size={17} />
                    {messages.layout.compact}
                  </button>
                </div>
              </div>
            </div>
            {visible.length ? (
              <div className={layout === "compact" ? "todo-list" : "todo-grid"}>
                {visible.map((todo) => (
                  <TodoCard
                    key={todo.id}
                    todo={todo}
                    now={now}
                    users={users}
                    compact={layout === "compact"}
                    nextDue={todo.id === nextDueId}
                    onOpen={() => {
                      setToast(null);
                      setDirty(false);
                      setView({ type: "detail", id: todo.id });
                    }}
                  />
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <p>
                  {search ? messages.filters.noResults : messages.filters.empty}
                </p>
                {!todos.length || (!search && counts.all === 0) ? (
                  <button
                    className="button button-primary"
                    onClick={openCreate}
                  >
                    <Plus size={18} />
                    {messages.todo.createAction}
                  </button>
                ) : (
                  <button
                    className="button button-secondary"
                    onClick={() => {
                      setSearch("");
                      setFilter("all");
                    }}
                  >
                    {messages.filters.showAll}
                  </button>
                )}
              </div>
            )}
          </section>
        </main>
      </div>
      {view?.type === "create" && (
        <Modal
          title={messages.todo.create}
          onClose={closeView}
          notice={toast?.message}
        >
          {actionError && (
            <p className="modal-error" role="alert">
              {actionError}
            </p>
          )}
          <TodoForm
            users={users}
            onSave={saveDraft}
            onCancel={closeView}
            onDirty={setDirty}
            ask={ask}
          />
        </Modal>
      )}
      {view?.type === "edit" && selected && (
        <Modal
          title={messages.todo.edit}
          onClose={closeView}
          notice={toast?.message}
        >
          {actionError && (
            <p className="modal-error" role="alert">
              {actionError}
            </p>
          )}
          <TodoForm
            key={selected.id}
            todo={selected}
            users={users}
            setDeadline={view.setDeadline}
            onSave={saveDraft}
            onCancel={async () => {
              if (await allowDiscard(messages.discard.detail)) {
                setDirty(false);
                setView({ type: "detail", id: selected.id });
              }
            }}
            onDirty={setDirty}
            ask={ask}
          />
        </Modal>
      )}
      {view?.type === "detail" && selected && (
        <Modal
          title={selected.title}
          onClose={closeView}
          wide
          notice={toast?.message}
        >
          {actionError && (
            <p className="modal-error" role="alert">
              {actionError}
            </p>
          )}
          <TodoDetail
            key={selected.id}
            todo={selected}
            now={now}
            users={users}
            meId={meId}
            activities={activities.filter(
              (activity) => activity.todoId === selected.id,
            )}
            onUpdate={(patch, message) =>
              updateTodo(selected.id, patch, message)
            }
            onMemo={(body) => addMemo(selected.id, body)}
            onDirty={setDirty}
            onEdit={async (setDeadline = false) => {
              if (await allowDiscard(messages.discard.edit)) {
                setDirty(false);
                setView({ type: "edit", id: selected.id, setDeadline });
              }
            }}
            onDelete={() => deleteTodo(selected)}
          />
        </Modal>
      )}
      {view?.type === "manage" && (
        <Modal
          title={messages.manage.title}
          onClose={closeView}
          notice={toast?.message}
          wide
        >
          {actionError && (
            <p className="modal-error" role="alert">
              {actionError}
            </p>
          )}
          <ManageScreen
            state={board.state}
            meId={board.me.userId}
            token={board.me.token}
            ask={ask}
            onRenameList={(title) => act(() => board.renameBoard(title))}
            onRemoveList={() => act(() => board.removeBoard())}
            onRenameMember={(id, name) =>
              act(() => board.renameMember(id, name))
            }
            onRemoveMember={(id) => act(() => board.removeMember(id))}
            onSessionLost={onSessionLost}
            onNotify={(message) => setToast({ message })}
            onOpenData={() => {
              setToast(null);
              setView({ type: "data" });
            }}
          />
        </Modal>
      )}
      {view?.type === "data" && (
        <Modal
          title={messages.data.title}
          onClose={closeView}
          notice={toast?.message}
        >
          <div className="data-content">
            <div className="data-notice">
              <LockKeyhole size={21} />
              <div>
                <h3>{messages.data.location}</h3>
                <p>{messages.data.storageNotice}</p>
              </div>
            </div>
            <DataPanel
              state={board.state}
              notify={(message) => setToast({ message })}
            />
          </div>
        </Modal>
      )}
      {confirmation && (
        <Modal
          title={confirmation.title}
          onClose={() => {
            confirmation.resolve(false);
            setConfirmation(null);
          }}
          alert
        >
          <div className="confirm-content">
            <p>{confirmation.description}</p>
            <div className="form-actions">
              <button
                autoFocus
                className="button button-secondary"
                onClick={() => {
                  confirmation.resolve(false);
                  setConfirmation(null);
                }}
              >
                {confirmation.cancel ?? messages.common.cancel}
              </button>
              <button
                className={
                  "button " +
                  (confirmation.danger ? "button-danger" : "button-primary")
                }
                onClick={() => {
                  confirmation.resolve(true);
                  setConfirmation(null);
                }}
              >
                {confirmation.confirm}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {completion.current && (
        <CompletionCelebration
          key={completion.current.id}
          todo={completion.current}
          target={completion.target}
          counter={completion.counter}
          onArrive={completion.arrive}
        />
      )}
      {completion.receipt && !view && !completion.current && (
        <CompletionNotice
          key={completion.receipt.id}
          receipt={completion.receipt}
          onDismiss={completion.dismissReceipt}
        />
      )}
      <div
        className="toast-region"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {toast && !view && !completion.current && !completion.receipt && (
          <div className="toast">
            <span className="toast-icon">
              <Check size={17} />
            </span>
            <span>{toast.message}</span>
            {toast.undo && (
              <button
                className="toast-undo"
                onClick={async () => {
                  const undo = toast.undo;
                  if (!undo) return;
                  if (await act(() => board.undoRemove(undo.id)))
                    setToast({ message: messages.todo.restored });
                }}
              >
                {messages.common.undo}
              </button>
            )}
            <button
              className="icon-button"
              onClick={() => setToast(null)}
              aria-label={messages.common.closeNotification}
            >
              <X size={16} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

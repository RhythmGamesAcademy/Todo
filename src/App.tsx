import { messages } from "./messages";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowDownUp,
  ArrowRight,
  CalendarDays,
  Check,
  ChevronRight,
  Circle,
  CircleCheck,
  CalendarClock,
  HardDrive,
  LayoutGrid,
  List,
  LoaderCircle,
  LockKeyhole,
  Plus,
  Search,
  X,
} from "lucide-react";
import {
  FILTER_LABEL,
  isOverdue,
  isToday,
  nextDeadlineId,
  selectTodos,
} from "./model";
import type { Filter, Sort, Todo, TodoDraft } from "./model";
import { useTodoLayout, useTodoStore } from "./storage";
import { DataPanel } from "./DataPanel";
import { Mark, Modal, TodoCard, TodoDetail, TodoForm } from "./ui";
import type { AskOptions } from "./ui";
type View =
  | { type: "create" }
  | { type: "detail" | "edit"; id: string; setDeadline?: boolean }
  | { type: "data" }
  | null;
type Confirm = AskOptions & { resolve: (answer: boolean) => void };
export default function App() {
  const store = useTodoStore();
  const { todos } = store;
  const [layout, changeLayout] = useTodoLayout();
  const [now, setNow] = useState(() => new Date());
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("deadline");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<View>(null);
  const [dirty, setDirty] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirm | null>(null);
  const [toast, setToast] = useState<{ message: string; undo?: Todo } | null>(
    null,
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
    () => selectTodos(todos, filter, search, sort, now),
    [todos, filter, search, sort, now],
  );
  const selected =
    view && (view.type === "detail" || view.type === "edit")
      ? todos.find((t) => t.id === view.id)
      : undefined;
  const nextDueId = useMemo(() => nextDeadlineId(todos, now), [todos, now]);
  useEffect(() => {
    if (view && (view.type === "detail" || view.type === "edit") && !selected) {
      setView(null);
      setDirty(false);
    }
  }, [view, selected]);
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
  function update(todo: Todo, message: string) {
    if (!store.save(todos.map((t) => (t.id === todo.id ? todo : t))))
      return false;
    setToast({ message });
    return true;
  }
  function saveDraft(draft: TodoDraft) {
    const timestamp = new Date().toISOString();
    if (view?.type === "create") {
      const todo: Todo = {
        ...draft,
        id: crypto.randomUUID(),
        notes: [],
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      if (!store.save([...todos, todo])) return false;
      setSearch("");
      setFilter("all");
      setDirty(false);
      setView({ type: "detail", id: todo.id });
      setToast({ message: messages.todo.created });
      return true;
    }
    if (
      selected &&
      update(
        { ...selected, ...draft, updatedAt: timestamp },
        messages.todo.saved,
      )
    ) {
      setDirty(false);
      setView({ type: "detail", id: selected.id });
      return true;
    }
    return false;
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
      if (store.save(todos.filter((t) => t.id !== todo.id))) {
        setView(null);
        setDirty(false);
        setToast({ message: messages.todo.deleted, undo: todo });
      }
    }
  }
  const filters: { key: Filter; icon: typeof LayoutGrid }[] = [
    { key: "all", icon: LayoutGrid },
    { key: "overdue", icon: CalendarClock },
    { key: "active", icon: Circle },
    { key: "today", icon: CalendarDays },
    { key: "doing", icon: LoaderCircle },
    { key: "done", icon: CircleCheck },
  ];
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
            onClick={() => setView({ type: "data" })}
            aria-label={messages.data.title}
          >
            <HardDrive size={21} />
          </button>
        </div>
      </header>
      <aside className="sidebar">
        <nav aria-label={messages.app.navigation}>
          <div className="nav-items">
            {filters.map(({ key, icon: Icon }) => (
              <button
                key={key}
                className={"nav-item " + (filter === key ? "active" : "")}
                aria-current={filter === key ? "page" : undefined}
                onClick={() => {
                  setFilter(key);
                  setSearch("");
                }}
              >
                <Icon size={19} />
                <span>{messages.filters.navigation[key]}</span>
                <span className="nav-count">{counts[key]}</span>
              </button>
            ))}
          </div>
        </nav>
        <div className="sidebar-bottom">
          <button
            className="storage-nav"
            onClick={() => {
              setView({ type: "data" });
            }}
          >
            <HardDrive size={18} />
            <span>{messages.data.title}</span>
            <ChevronRight size={15} />
          </button>
        </div>
      </aside>
      <div className="workspace">
        <main id="main" className="main-content" tabIndex={-1}>
          {store.error && (
            <div className="storage-error" role="alert">
              <AlertCircle size={19} />
              <div>
                <p>{store.error}</p>
                {store.recovery && (
                  <button
                    className="text-button"
                    onClick={() => setView({ type: "data" })}
                  >
                    {messages.data.open}
                    <ArrowRight size={14} />
                  </button>
                )}
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
              disabled={!!store.recovery}
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
                {!todos.length ? (
                  <button
                    className="button button-primary"
                    onClick={openCreate}
                    disabled={!!store.recovery}
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
          {store.error && (
            <p className="modal-error" role="alert">
              {store.error}
            </p>
          )}
          <TodoForm
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
          {store.error && (
            <p className="modal-error" role="alert">
              {store.error}
            </p>
          )}
          <TodoForm
            key={selected.id}
            todo={selected}
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
          {store.error && (
            <p className="modal-error" role="alert">
              {store.error}
            </p>
          )}
          <TodoDetail
            key={selected.id}
            todo={selected}
            now={now}
            onUpdate={update}
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
      {view?.type === "data" && (
        <Modal
          title={messages.data.title}
          onClose={closeView}
          notice={toast?.message}
        >
          <div className="data-content">
            {store.error && (
              <p className="modal-error" role="alert">
                {store.error}
              </p>
            )}
            <div className="data-notice">
              <LockKeyhole size={21} />
              <div>
                <h3>{messages.data.location}</h3>
                <p>{messages.data.storageNotice}</p>
              </div>
            </div>
            <DataPanel
              todos={todos}
              recovery={store.recovery}
              save={store.save}
              ask={ask}
              notify={(message) => setToast({ message })}
              onRestored={() => {
                setSearch("");
                setFilter("all");
              }}
            />
            {store.recovery && (
              <div className="recovery-section">
                <h3>{messages.data.recovery.title}</h3>
                <p>{messages.data.recovery.description}</p>
                <button
                  className="button button-danger"
                  onClick={async () => {
                    if (
                      await ask({
                        title: messages.data.recovery.confirmTitle,
                        description: messages.data.recovery.confirmDescription,
                        confirm: messages.data.recovery.confirm,
                        danger: true,
                      })
                    ) {
                      if (store.save([], true)) {
                        setView(null);
                        setToast({ message: messages.data.recovery.done });
                      }
                    }
                  }}
                >
                  {messages.data.recovery.action}
                </button>
              </div>
            )}
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
      <div
        className="toast-region"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {toast && !view && (
          <div className="toast">
            <span className="toast-icon">
              <Check size={17} />
            </span>
            <span>{toast.message}</span>
            {toast.undo && (
              <button
                className="toast-undo"
                onClick={() => {
                  if (
                    toast.undo &&
                    !todos.some((t) => t.id === toast.undo!.id) &&
                    store.save([...todos, toast.undo])
                  )
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

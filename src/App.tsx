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
  Clock3,
  HardDrive,
  LayoutGrid,
  LoaderCircle,
  LockKeyhole,
  Plus,
  Search,
  X,
} from "lucide-react";
import { clockText, FILTER_LABEL, isToday, selectTodos } from "./model";
import type { Filter, Sort, Todo, TodoDraft } from "./model";
import { useTodoStore } from "./storage";
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
  useEffect(() => {
    if (view && (view.type === "detail" || view.type === "edit") && !selected) {
      setView(null);
      setDirty(false);
    }
  }, [view, selected]);
  async function allowDiscard(action = "破棄して閉じる") {
    if (!dirty) return true;
    return ask({
      title: "入力中の内容を破棄しますか？",
      description: "保存していない入力内容が失われます。",
      confirm: action,
      cancel: "入力を続ける",
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
      setToast({ message: "TODOを作成しました" });
      return true;
    }
    if (
      selected &&
      update(
        { ...selected, ...draft, updatedAt: timestamp },
        "変更を保存しました",
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
        title: "このTODOを削除しますか？",
        description:
          "「" +
          todo.title +
          "」と、" +
          todo.notes.length +
          "件のメモを削除します。入力中のメモも破棄されます。",
        confirm: "TODOを削除",
        danger: true,
      })
    ) {
      if (store.save(todos.filter((t) => t.id !== todo.id))) {
        setView(null);
        setDirty(false);
        setToast({ message: "TODOを削除しました", undo: todo });
      }
    }
  }
  const filters: { key: Filter; label: string; icon: typeof LayoutGrid }[] = [
    { key: "all", label: "すべてのTODO", icon: LayoutGrid },
    { key: "active", label: "未完了", icon: Circle },
    { key: "today", label: "今日が期限", icon: CalendarDays },
    { key: "doing", label: "進行中", icon: LoaderCircle },
    { key: "done", label: "完了", icon: CircleCheck },
  ];
  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">
        メインコンテンツへ
      </a>
      <aside className="sidebar">
        <div className="sidebar-top">
          <div className="brand">
            <Mark />
            <span className="brand-name">TODO</span>
          </div>
          <button
            className="mobile-data icon-button"
            onClick={() => {
              setView({ type: "data" });
            }}
            aria-label="データの保存・復元"
          >
            <HardDrive size={21} />
          </button>
        </div>
        <nav aria-label="TODOの表示">
          <div className="nav-items">
            {filters.map(({ key, label, icon: Icon }) => (
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
                <span>{label}</span>
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
            <span>データの保存・復元</span>
            <ChevronRight size={15} />
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <svg
            className="header-waves"
            viewBox="0 0 1440 140"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path
              d="M0 72C220 138 400 5 670 69S1110 128 1440 66V140H0Z"
              fill="#e2f0ff"
            />
            <path
              d="M0 106C300 30 470 139 780 100S1170 30 1440 103V140H0Z"
              fill="#cfe6ff"
            />
            <path
              d="M0 125C260 81 480 153 790 120S1170 84 1440 119V140H0Z"
              fill="#b8d9fa"
            />
          </svg>
          <div className="clock" aria-label="現在の日時">
            <Clock3 size={23} />
            <time dateTime={now.toISOString()}>{clockText(now)}</time>
          </div>
        </header>
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
                    データの保存・復元を開く
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
              新しいTODO
            </button>
          </div>
          <section className="todo-section" aria-labelledby="list-heading">
            <div className="toolbar">
              <div className="search-wrap">
                <Search size={18} />
                <label htmlFor="todo-search" className="sr-only">
                  TODO・メモを検索
                </label>
                <input
                  id="todo-search"
                  type="search"
                  placeholder="TODO・メモを検索"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {search && (
                  <button
                    className="icon-button"
                    onClick={() => setSearch("")}
                    aria-label="検索をクリア"
                  >
                    <X size={17} />
                  </button>
                )}
              </div>
              <div className="sort-wrap">
                <ArrowDownUp size={17} />
                <label htmlFor="todo-sort">並べ替え</label>
                <select
                  id="todo-sort"
                  value={sort}
                  onChange={(e) => setSort(e.target.value as Sort)}
                >
                  <option value="deadline">期限が近い順</option>
                  <option value="priority">優先度が高い順</option>
                </select>
              </div>
            </div>
            {visible.length ? (
              <div className="todo-grid">
                {visible.map((todo) => (
                  <TodoCard
                    key={todo.id}
                    todo={todo}
                    now={now}
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
                <p>{search ? "検索結果なし" : "TODOなし"}</p>
                {!todos.length ? (
                  <button
                    className="button button-primary"
                    onClick={openCreate}
                    disabled={!!store.recovery}
                  >
                    <Plus size={18} />
                    TODOを作成
                  </button>
                ) : (
                  <button
                    className="button button-secondary"
                    onClick={() => {
                      setSearch("");
                      setFilter("all");
                    }}
                  >
                    すべてのTODOを見る
                  </button>
                )}
              </div>
            )}
          </section>
        </main>
      </div>
      {view?.type === "create" && (
        <Modal title="新しいTODO" onClose={closeView} notice={toast?.message}>
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
        <Modal title="TODOを編集" onClose={closeView} notice={toast?.message}>
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
              if (await allowDiscard("破棄して詳細に戻る")) {
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
              if (await allowDiscard("破棄して編集する")) {
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
          title="データの保存・復元"
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
                <h3>保存先：このブラウザ</h3>
                <p>
                  ブラウザのサイトデータを削除すると、TODOとメモも消去されます。
                </p>
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
                <h3>読み込めないデータを初期化</h3>
                <p>
                  先に書き出しを行ってください。初期化すると、現在の保存データは削除されます。
                </p>
                <button
                  className="button button-danger"
                  onClick={async () => {
                    if (
                      await ask({
                        title: "保存データを初期化しますか？",
                        description:
                          "この操作で保存されているTODOとメモをすべて削除します。元に戻せません。",
                        confirm: "初期化する",
                        danger: true,
                      })
                    ) {
                      if (store.save([], true)) {
                        setView(null);
                        setToast({ message: "保存データを初期化しました" });
                      }
                    }
                  }}
                >
                  保存データを初期化
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
                {confirmation.cancel ?? "キャンセル"}
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
                    setToast({ message: "TODOを元に戻しました" });
                }}
              >
                元に戻す
              </button>
            )}
            <button
              className="icon-button"
              onClick={() => setToast(null)}
              aria-label="通知を閉じる"
            >
              <X size={16} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

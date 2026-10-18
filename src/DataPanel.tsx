import { useMemo, useRef, useState } from "react";
import { AlertCircle, Download, Trash2, Upload } from "lucide-react";
import { parseTodos, planRestore, serializeTodos, STORAGE_KEY } from "./model";
import type { RestoreMode, Todo } from "./model";
import type { AskOptions } from "./ui";
interface Props {
  todos: Todo[];
  recovery: string | null;
  save: (todos: Todo[], recover?: boolean) => boolean;
  ask: (options: AskOptions) => Promise<boolean>;
  notify: (message: string) => void;
  onRestored: () => void;
}
const MODES: { value: RestoreMode; label: string; description: string }[] = [
  {
    value: "replace",
    label: "完全上書き",
    description: "現在のTODOとメモを、ファイルの内容に置き換えます。",
  },
  {
    value: "merge",
    label: "更新＋新規追加",
    description:
      "同じIDは読み込んだ値で更新し、メモを時系列に統合。新しいIDも追加します。",
  },
  {
    value: "add",
    label: "ないTODOだけ追加",
    description: "新しいIDだけ追加します。同じIDのTODOとメモは変更しません。",
  },
];
export function DataPanel({
  todos,
  recovery,
  save,
  ask,
  notify,
  onRestored,
}: Props) {
  const latest = useRef({ todos, recovery });
  latest.current = { todos, recovery };
  const fileInput = useRef<HTMLInputElement>(null);
  const [chosenMode, setMode] = useState<RestoreMode>("add");
  const mode = recovery ? "replace" : chosenMode;
  const [candidate, setCandidate] = useState<{
    name: string;
    todos: Todo[];
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [bulkScope, setBulkScope] = useState<"done" | "all">("done");
  const [busy, setBusy] = useState(false);
  const preview = useMemo(() => {
    if (!candidate) return { plan: null, error: "" };
    try {
      return { plan: planRestore(todos, candidate.todos, mode), error: "" };
    } catch (e) {
      return {
        plan: null,
        error: e instanceof Error ? e.message : "復元できません。",
      };
    }
  }, [todos, candidate, mode]);
  const countNotes = (list: Todo[]) =>
    list.reduce((sum, todo) => sum + todo.notes.length, 0);
  const targets = todos.filter(
    (todo) => bulkScope === "all" || todo.status === "done",
  );
  const storageBytes = useMemo(
    () => ((recovery ?? serializeTodos(todos)).length + STORAGE_KEY.length) * 2,
    [todos, recovery],
  );
  const changed = preview.plan
    ? preview.plan.added + preview.plan.updated + preview.plan.removed
    : 0;
  async function readFile(file?: File) {
    if (!file) return;
    setLoading(true);
    setError("");
    setCandidate(null);
    try {
      if (file.size > 10 * 1024 * 1024)
        throw new Error("10MB以下のJSONファイルを選択してください。");
      setCandidate({ name: file.name, todos: parseTodos(await file.text()) });
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "ファイルを読み込めませんでした。",
      );
    } finally {
      setLoading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  async function restore() {
    const plan = preview.plan;
    if (!plan || !changed || busy || (recovery && mode !== "replace")) return;
    setBusy(true);
    setError("");
    try {
      const confirmed = await ask({
        title:
          MODES.find((option) => option.value === mode)!.label +
          "で復元しますか？",
        description:
          "追加 " +
          plan.added +
          "件、更新 " +
          plan.updated +
          "件、削除 " +
          plan.removed +
          "件。" +
          (mode === "replace"
            ? "現在のTODOとメモを置き換えます。元に戻せません。"
            : mode === "merge"
              ? "同じIDの項目は読み込んだ値を採用します。メモは日時順に統合し、同じメモIDは読み込んだ内容を採用します。"
              : "既存のTODOとメモは変更しません。"),
        confirm: "復元する",
        danger: mode !== "add",
      });
      if (!confirmed) return;
      if (
        latest.current.todos !== todos ||
        latest.current.recovery !== recovery
      ) {
        setError(
          "確認中に保存データが更新されました。変更件数を確認し、もう一度実行してください。",
        );
        return;
      }
      if (save(plan.todos, mode === "replace")) {
        setCandidate(null);
        notify(
          "復元しました（追加 " +
            plan.added +
            "件・更新 " +
            plan.updated +
            "件・削除 " +
            plan.removed +
            "件）",
        );
        onRestored();
      }
    } finally {
      setBusy(false);
    }
  }
  async function bulkDelete() {
    if (!targets.length || recovery || busy) return;
    setBusy(true);
    setError("");
    try {
      if (
        await ask({
          title:
            bulkScope === "done"
              ? "完了済みのTODOを削除しますか？"
              : "すべてのTODOを削除しますか？",
          description:
            "TODO " +
            targets.length +
            "件とメモ " +
            countNotes(targets) +
            "件を削除します。元に戻せません。必要なデータは先に書き出してください。",
          confirm: "まとめて削除",
          danger: true,
        })
      ) {
        if (
          latest.current.todos !== todos ||
          latest.current.recovery !== recovery
        ) {
          setError(
            "確認中に保存データが更新されました。削除対象を確認し、もう一度実行してください。",
          );
          return;
        }
        if (
          save(
            todos.filter(
              (todo) => bulkScope !== "all" && todo.status !== "done",
            ),
          )
        )
          notify("TODO " + targets.length + "件を削除しました");
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {error && (
        <p className="form-error" role="alert">
          <AlertCircle size={17} />
          {error}
        </p>
      )}
      <p className="storage-summary">
        TODO {todos.length}件・メモ {countNotes(todos)}件
        <span>保存量（概算）{(storageBytes / 1024).toFixed(1)} KiB</span>
      </p>
      <section className="data-action" aria-labelledby="export-title">
        <h3 id="export-title">バックアップを書き出す</h3>
        <button
          className="button button-secondary"
          onClick={() => {
            const raw = recovery ?? serializeTodos(todos);
            const url = URL.createObjectURL(
              new Blob([raw], { type: "application/json;charset=utf-8" }),
            );
            const link = document.createElement("a");
            link.href = url;
            link.download =
              "todo-" + new Date().toISOString().slice(0, 10) + ".json";
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            notify("バックアップの書き出しを開始しました");
          }}
        >
          <Download size={17} />
          書き出す
        </button>
      </section>
      <section
        className="data-action restore-section"
        aria-labelledby="restore-title"
      >
        <h3 id="restore-title">バックアップから復元する</h3>
        <fieldset className="restore-modes" disabled={loading || busy}>
          <legend className="sr-only">復元方法</legend>
          {MODES.map((option) => (
            <label
              className={
                "restore-option " + (mode === option.value ? "selected" : "")
              }
              key={option.value}
            >
              <input
                type="radio"
                name="restore-mode"
                value={option.value}
                checked={mode === option.value}
                onChange={() => setMode(option.value)}
                disabled={!!recovery && option.value !== "replace"}
              />
              <span>
                <strong>{option.label}</strong>
                <span>{option.description}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {recovery && (
          <p className="field-hint">
            保存データを読み込めないため、完全上書きのみ利用できます。
          </p>
        )}
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          hidden
          aria-label="復元するJSONファイル"
          onChange={(e) => readFile(e.target.files?.[0])}
        />
        <button
          className="button button-secondary"
          disabled={loading || busy}
          onClick={() => fileInput.current?.click()}
        >
          <Upload size={17} />
          {loading ? "読み込み中…" : "ファイルを選ぶ"}
        </button>
        {candidate && (
          <div className="restore-preview" aria-live="polite">
            <p className="import-filename">
              {candidate.name}
              <span>{candidate.todos.length}件</span>
            </p>
            {preview.plan && (
              <>
                <dl>
                  <div>
                    <dt>追加</dt>
                    <dd>{preview.plan.added}件</dd>
                  </div>
                  <div>
                    <dt>更新</dt>
                    <dd>{preview.plan.updated}件</dd>
                  </div>
                  <div>
                    <dt>削除</dt>
                    <dd>{preview.plan.removed}件</dd>
                  </div>
                  <div>
                    <dt>復元後</dt>
                    <dd>{preview.plan.todos.length}件</dd>
                  </div>
                </dl>
                {!changed && (
                  <p className="field-hint">変更対象がありません。</p>
                )}
              </>
            )}
          </div>
        )}
        {preview.error && (
          <p className="form-error" role="alert">
            <AlertCircle size={17} />
            {preview.error}
          </p>
        )}
        {candidate && (
          <button
            className="button button-primary"
            onClick={restore}
            disabled={!changed || !preview.plan || busy || loading}
          >
            復元する
          </button>
        )}
      </section>
      <section
        className="data-action bulk-section"
        aria-labelledby="bulk-title"
      >
        <h3 id="bulk-title">TODOの一括削除</h3>
        <label className="field-label" htmlFor="bulk-scope">
          削除対象
        </label>
        <select
          className="field"
          id="bulk-scope"
          value={bulkScope}
          onChange={(e) => setBulkScope(e.target.value as "done" | "all")}
          disabled={!!recovery || busy}
        >
          <option value="done">完了済みのTODO</option>
          <option value="all">すべてのTODO</option>
        </select>
        <p className="bulk-count">
          TODO {targets.length}件・メモ {countNotes(targets)}件
        </p>
        <p className="field-hint">メモも削除されます。元に戻せません。</p>
        <button
          className="button button-danger"
          disabled={!targets.length || !!recovery || busy}
          onClick={bulkDelete}
        >
          <Trash2 size={17} />
          まとめて削除
        </button>
      </section>
    </>
  );
}

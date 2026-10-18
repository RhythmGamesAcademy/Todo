import { messages } from "./messages";
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
const MODES: RestoreMode[] = ["replace", "merge", "add"];
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
        error: e instanceof Error ? e.message : messages.errors.restore,
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
        throw new Error(messages.errors.fileTooLarge);
      setCandidate({ name: file.name, todos: parseTodos(await file.text()) });
    } catch (e) {
      setError(e instanceof Error ? e.message : messages.errors.readFile);
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
        title: messages.data.restoreConfirmTitle(
          messages.data.modes[mode].label,
        ),
        description: messages.data.restoreConfirmDescription(
          plan.added,
          plan.updated,
          plan.removed,
          messages.data.modes[mode].confirmation,
        ),
        confirm: messages.data.restore,
        danger: mode !== "add",
      });
      if (!confirmed) return;
      if (
        latest.current.todos !== todos ||
        latest.current.recovery !== recovery
      ) {
        setError(messages.errors.changedBeforeRestore);
        return;
      }
      if (save(plan.todos, mode === "replace")) {
        setCandidate(null);
        notify(messages.data.restored(plan.added, plan.updated, plan.removed));
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
              ? messages.data.bulk.doneTitle
              : messages.data.bulk.allTitle,
          description: messages.data.bulk.confirmation(
            targets.length,
            countNotes(targets),
          ),
          confirm: messages.data.bulk.action,
          danger: true,
        })
      ) {
        if (
          latest.current.todos !== todos ||
          latest.current.recovery !== recovery
        ) {
          setError(messages.errors.changedBeforeDelete);
          return;
        }
        if (
          save(
            todos.filter(
              (todo) => bulkScope !== "all" && todo.status !== "done",
            ),
          )
        )
          notify(messages.data.bulk.deleted(targets.length));
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
        {messages.data.summary(todos.length, countNotes(todos))}
        <span>
          {messages.data.storageSize((storageBytes / 1024).toFixed(1))}
        </span>
      </p>
      <section className="data-action" aria-labelledby="export-title">
        <h3 id="export-title">{messages.data.exportTitle}</h3>
        <button
          className="button button-secondary"
          onClick={() => {
            const raw = recovery ?? serializeTodos(todos);
            const url = URL.createObjectURL(
              new Blob([raw], { type: "application/json;charset=utf-8" }),
            );
            const link = document.createElement("a");
            link.href = url;
            link.download = messages.data.backupFilename(
              new Date().toISOString().slice(0, 10),
            );
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            notify(messages.data.exportStarted);
          }}
        >
          <Download size={17} />
          {messages.data.export}
        </button>
      </section>
      <section
        className="data-action restore-section"
        aria-labelledby="restore-title"
      >
        <h3 id="restore-title">{messages.data.restoreTitle}</h3>
        <fieldset className="restore-modes" disabled={loading || busy}>
          <legend className="sr-only">{messages.data.method}</legend>
          {MODES.map((option) => (
            <label
              className={
                "restore-option " + (mode === option ? "selected" : "")
              }
              key={option}
            >
              <input
                type="radio"
                name="restore-mode"
                value={option}
                checked={mode === option}
                onChange={() => setMode(option)}
                disabled={!!recovery && option !== "replace"}
              />
              <span>
                <strong>{messages.data.modes[option].label}</strong>
                <span>{messages.data.modes[option].description}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {recovery && <p className="field-hint">{messages.data.replaceOnly}</p>}
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          hidden
          aria-label={messages.data.fileLabel}
          onChange={(e) => readFile(e.target.files?.[0])}
        />
        <button
          className="button button-secondary"
          disabled={loading || busy}
          onClick={() => fileInput.current?.click()}
        >
          <Upload size={17} />
          {loading ? messages.data.loading : messages.data.chooseFile}
        </button>
        {candidate && (
          <div className="restore-preview" aria-live="polite">
            <p className="import-filename">
              {candidate.name}
              <span>{messages.common.items(candidate.todos.length)}</span>
            </p>
            {preview.plan && (
              <>
                <dl>
                  <div>
                    <dt>{messages.data.preview.added}</dt>
                    <dd>{messages.common.items(preview.plan.added)}</dd>
                  </div>
                  <div>
                    <dt>{messages.data.preview.updated}</dt>
                    <dd>{messages.common.items(preview.plan.updated)}</dd>
                  </div>
                  <div>
                    <dt>{messages.data.preview.removed}</dt>
                    <dd>{messages.common.items(preview.plan.removed)}</dd>
                  </div>
                  <div>
                    <dt>{messages.data.preview.total}</dt>
                    <dd>{messages.common.items(preview.plan.todos.length)}</dd>
                  </div>
                </dl>
                {!changed && (
                  <p className="field-hint">
                    {messages.data.preview.unchanged}
                  </p>
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
            {messages.data.restore}
          </button>
        )}
      </section>
      <section
        className="data-action bulk-section"
        aria-labelledby="bulk-title"
      >
        <h3 id="bulk-title">{messages.data.bulk.title}</h3>
        <label className="field-label" htmlFor="bulk-scope">
          {messages.data.bulk.target}
        </label>
        <select
          className="field"
          id="bulk-scope"
          value={bulkScope}
          onChange={(e) => setBulkScope(e.target.value as "done" | "all")}
          disabled={!!recovery || busy}
        >
          <option value="done">{messages.data.bulk.done}</option>
          <option value="all">{messages.data.bulk.all}</option>
        </select>
        <p className="bulk-count">
          {messages.data.summary(targets.length, countNotes(targets))}
        </p>
        <p className="field-hint">{messages.data.bulk.notice}</p>
        <button
          className="button button-danger"
          disabled={!targets.length || !!recovery || busy}
          onClick={bulkDelete}
        >
          <Trash2 size={17} />
          {messages.data.bulk.action}
        </button>
      </section>
    </>
  );
}

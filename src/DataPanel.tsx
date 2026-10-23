import { Download } from "lucide-react";
import { messages } from "./messages";
import { buildCloudExport, serializeCloudExport } from "./cloud/export";
import type { CloudState } from "./cloud/types";

interface Props {
  state: CloudState;
  notify: (message: string) => void;
}

export function DataPanel({ state, notify }: Props) {
  const notes = state.todos.reduce((sum, todo) => sum + todo.notes.length, 0);

  function exportData() {
    const now = new Date();
    const raw = serializeCloudExport(
      buildCloudExport(state, now.toISOString()),
    );
    const url = URL.createObjectURL(
      new Blob([raw], { type: "application/json;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = messages.data.exportFilename(
      now.toISOString().slice(0, 10),
    );
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify(messages.data.exportStarted);
  }

  return (
    <>
      <p className="storage-summary">
        {messages.data.cloudSummary(state.list.title, state.users.length)}
        <span>{messages.data.summary(state.todos.length, notes)}</span>
      </p>
      <section className="data-action" aria-labelledby="export-title">
        <h3 id="export-title">{messages.data.exportTitle}</h3>
        <button className="button button-secondary" onClick={exportData}>
          <Download size={17} />
          {messages.data.export}
        </button>
      </section>
    </>
  );
}

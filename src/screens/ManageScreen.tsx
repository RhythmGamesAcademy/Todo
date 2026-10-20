import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Copy } from "lucide-react";
import type { CloudState, CloudUser } from "../cloud/types";
import { messages } from "../messages";
import type { AskOptions } from "../ui";

export interface ManageScreenProps {
  state: CloudState;
  meId: string;
  token: string;
  ask(options: AskOptions): Promise<boolean>;
  onRenameList(title: string): Promise<boolean>;
  onRemoveList(): Promise<boolean>;
  onRenameMember(id: string, name: string): Promise<boolean>;
  onRemoveMember(id: string): Promise<boolean>;
  onSessionLost(): void;
  onNotify(message: string): void;
  onOpenData(): void;
}

export function ManageScreen({
  state,
  meId,
  token,
  ask,
  onRenameList,
  onRemoveList,
  onRenameMember,
  onRemoveMember,
  onSessionLost,
  onNotify,
  onOpenData,
}: ManageScreenProps) {
  const [title, setTitle] = useState(state.list.title);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const shareUrl =
    window.location.origin + window.location.pathname + "#token=" + token;

  // 他の端末からの変更を、編集中の入力より優先しない形で反映する。
  useEffect(() => {
    setTitle(state.list.title);
  }, [state.list.title]);

  const draftOf = (user: CloudUser) => drafts[user.id] ?? user.name;
  const titleChanged = title.trim() !== state.list.title && title.trim() !== "";

  async function saveTitle(event: FormEvent) {
    event.preventDefault();
    const next = title.trim();
    if (!next || next === state.list.title) return;
    if (await onRenameList(next)) setTitle(next);
  }

  async function saveMember(event: FormEvent, user: CloudUser) {
    event.preventDefault();
    const next = draftOf(user).trim();
    if (!next || next === user.name) return;
    if (await onRenameMember(user.id, next)) {
      setDrafts((current) => {
        const copy = { ...current };
        delete copy[user.id];
        return copy;
      });
    }
  }

  async function removeMember(user: CloudUser) {
    const isSelf = user.id === meId;
    const confirmed = await ask({
      title: messages.manage.removeMemberTitle(user.name),
      description:
        messages.manage.removeMemberDescription(user.name) +
        (isSelf ? " " + messages.manage.removeSelfHint : ""),
      confirm: messages.manage.removeMember,
      cancel: messages.common.cancel,
      danger: true,
    });
    if (!confirmed) return;
    if ((await onRemoveMember(user.id)) && isSelf) onSessionLost();
  }

  async function removeList() {
    const warned = await ask({
      title: messages.manage.deleteListTitle,
      description: messages.manage.deleteListWarning,
      confirm: messages.manage.deleteListAction,
      cancel: messages.common.cancel,
      danger: true,
    });
    if (!warned) return;
    const confirmed = await ask({
      title: messages.manage.deleteListConfirmTitle,
      description: messages.manage.deleteListConfirmDescription,
      confirm: messages.manage.deleteListConfirm,
      cancel: messages.common.cancel,
      danger: true,
    });
    if (!confirmed) return;
    if (await onRemoveList()) onSessionLost();
  }

  async function copyShare() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("unavailable");
      await navigator.clipboard.writeText(shareUrl);
    } catch {
      // クリップボード API が使えない環境では選択コピーへフォールバックする。
      const area = document.createElement("textarea");
      area.value = shareUrl;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      document.execCommand?.("copy");
      document.body.removeChild(area);
    }
    onNotify(messages.manage.copied);
  }

  return (
    <div className="manage-screen">
      <section className="manage-section" aria-labelledby="manage-list-heading">
        <h3 id="manage-list-heading">{messages.manage.listTitleLabel}</h3>
        <form className="manage-inline-form" onSubmit={saveTitle}>
          <label className="sr-only" htmlFor="manage-list-title">
            {messages.manage.listTitleLabel}
          </label>
          <input
            id="manage-list-title"
            className="field"
            value={title}
            maxLength={120}
            onChange={(event) => setTitle(event.target.value)}
          />
          <button
            type="submit"
            className="button button-primary"
            disabled={!titleChanged}
          >
            {messages.manage.save}
          </button>
        </form>
      </section>
      <section
        className="manage-section"
        aria-labelledby="manage-members-heading"
      >
        <h3 id="manage-members-heading">{messages.manage.membersTitle}</h3>
        <ul className="manage-members">
          {state.users.map((user) => {
            const isSelf = user.id === meId;
            const assigned = state.todos.filter(
              (todo) => todo.assigneeId === user.id,
            ).length;
            const draft = draftOf(user);
            return (
              <li className="manage-member" key={user.id}>
                <div className="manage-member-main">
                  <form
                    className="manage-inline-form"
                    onSubmit={(event) => saveMember(event, user)}
                  >
                    <label
                      className="sr-only"
                      htmlFor={"manage-member-" + user.id}
                    >
                      {messages.manage.memberNameLabel(user.name)}
                    </label>
                    <input
                      id={"manage-member-" + user.id}
                      className="field"
                      value={draft}
                      maxLength={120}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [user.id]: event.target.value,
                        }))
                      }
                    />
                    <button
                      type="submit"
                      className="button button-secondary"
                      disabled={!draft.trim() || draft.trim() === user.name}
                    >
                      {messages.manage.save}
                    </button>
                  </form>
                  <div className="manage-member-meta">
                    {isSelf && (
                      <span className="manage-you">{messages.manage.you}</span>
                    )}
                    <span>{messages.manage.assignedCount(assigned)}</span>
                    <span>
                      {messages.manage.joinedAt}{" "}
                      <time dateTime={user.createdAt}>
                        {messages.dateTime.headerDate(new Date(user.createdAt))}
                      </time>
                    </span>
                  </div>
                  {isSelf && (
                    <p className="manage-hint">
                      {messages.manage.removeSelfHint}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  className="text-button danger-text"
                  onClick={() => removeMember(user)}
                >
                  {messages.manage.removeMember}
                </button>
              </li>
            );
          })}
        </ul>
      </section>
      <section
        className="manage-section"
        aria-labelledby="manage-share-heading"
      >
        <h3 id="manage-share-heading">{messages.manage.shareLabel}</h3>
        <div className="manage-share">
          <input
            className="field"
            readOnly
            value={shareUrl}
            aria-label={messages.manage.shareLabel}
            onFocus={(event) => event.currentTarget.select()}
          />
          <button
            type="button"
            className="button button-secondary"
            onClick={copyShare}
          >
            <Copy size={16} />
            {messages.manage.copyShare}
          </button>
        </div>
      </section>
      <section
        className="manage-section manage-danger"
        aria-labelledby="manage-danger-heading"
      >
        <h3 id="manage-danger-heading">{messages.manage.dangerTitle}</h3>
        <p>{messages.manage.deleteListWarning}</p>
        <button
          type="button"
          className="button button-danger"
          onClick={removeList}
        >
          {messages.manage.deleteList}
        </button>
      </section>
      <section className="manage-section" aria-labelledby="manage-data-heading">
        <h3 id="manage-data-heading">{messages.manage.dataTitle}</h3>
        <button
          type="button"
          className="button button-secondary"
          onClick={onOpenData}
        >
          {messages.manage.dataExport}
        </button>
      </section>
    </div>
  );
}

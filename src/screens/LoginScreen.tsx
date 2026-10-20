import { useState } from "react";
import type { FormEvent } from "react";
import { ApiError, createList, join } from "../cloud/client";
import type { Session } from "../cloud/session";
import { writeSession } from "../cloud/session";
import { messages } from "../messages";

export interface LoginScreenProps {
  prefillToken: string | null;
  onJoined(session: Session): void;
}

type Mode = "join" | "create";

// 404 はトークン誤りとして案内し、それ以外(通信断・500)は共通の通信エラーにする。
const errorMessage = (error: unknown): string =>
  error instanceof ApiError && error.status === 404
    ? messages.login.invalidToken
    : messages.errors.api.general;

export function LoginScreen({ prefillToken, onJoined }: LoginScreenProps) {
  const [mode, setMode] = useState<Mode>("join");
  const [token, setToken] = useState(prefillToken ?? "");
  const [joinName, setJoinName] = useState("");
  const [listTitle, setListTitle] = useState("");
  const [createName, setCreateName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const switchMode = (next: Mode) => {
    if (busy) return;
    setMode(next);
    setError("");
  };

  const joinReady = token.trim() !== "" && joinName.trim() !== "";
  const createReady = listTitle.trim() !== "" && createName.trim() !== "";
  const busyHint =
    mode === "join" ? messages.login.joining : messages.login.creating;

  const submitJoin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const invitedToken = token.trim();
    const name = joinName.trim();
    if (!invitedToken || !name) return;
    setError("");
    setBusy(true);
    try {
      const session = await join(invitedToken, name);
      writeSession(session);
      onJoined(session);
    } catch (caught) {
      // 失敗時は入力を残したまま、フォーム内に行としてエラーを出す。
      setError(errorMessage(caught));
      setBusy(false);
    }
  };

  const submitCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const title = listTitle.trim();
    const name = createName.trim();
    if (!title || !name) return;
    setError("");
    setBusy(true);
    try {
      const created = await createList(title, name);
      const session = await join(created.token, name);
      writeSession(session);
      onJoined(session);
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  };

  return (
    <div className="login-screen">
      <h1>{messages.login.heading}</h1>
      <div className="login-tabs">
        <button
          type="button"
          className={
            mode === "join"
              ? "button button-primary"
              : "button button-secondary"
          }
          aria-pressed={mode === "join"}
          disabled={busy}
          onClick={() => switchMode("join")}
        >
          {messages.login.joinTab}
        </button>
        <button
          type="button"
          className={
            mode === "create"
              ? "button button-primary"
              : "button button-secondary"
          }
          aria-pressed={mode === "create"}
          disabled={busy}
          onClick={() => switchMode("create")}
        >
          {messages.login.createTab}
        </button>
      </div>
      {mode === "join" ? (
        <form onSubmit={submitJoin} className="login-form">
          <label className="field-label" htmlFor="login-token">
            {messages.login.joinToken}
          </label>
          <input
            id="login-token"
            className="field"
            value={token}
            maxLength={120}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              setToken(event.target.value);
              setError("");
            }}
          />
          <label className="field-label" htmlFor="login-name">
            {messages.login.joinName}
          </label>
          <input
            id="login-name"
            className="field"
            value={joinName}
            maxLength={120}
            autoComplete="nickname"
            onChange={(event) => {
              setJoinName(event.target.value);
              setError("");
            }}
          />
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="form-actions">
            <button
              type="submit"
              className="button button-primary"
              disabled={busy || !joinReady}
            >
              {messages.login.joinAction}
            </button>
            {busy ? (
              <span className="field-hint" role="status">
                {busyHint}
              </span>
            ) : null}
          </div>
        </form>
      ) : (
        <form onSubmit={submitCreate} className="login-form">
          <label className="field-label" htmlFor="login-list-title">
            {messages.login.createListTitle}
          </label>
          <input
            id="login-list-title"
            className="field"
            value={listTitle}
            maxLength={120}
            onChange={(event) => {
              setListTitle(event.target.value);
              setError("");
            }}
          />
          <label className="field-label" htmlFor="login-create-name">
            {messages.login.createListName}
          </label>
          <input
            id="login-create-name"
            className="field"
            value={createName}
            maxLength={120}
            autoComplete="nickname"
            onChange={(event) => {
              setCreateName(event.target.value);
              setError("");
            }}
          />
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="form-actions">
            <button
              type="submit"
              className="button button-primary"
              disabled={busy || !createReady}
            >
              {messages.login.createAction}
            </button>
            {busy ? (
              <span className="field-hint" role="status">
                {busyHint}
              </span>
            ) : null}
          </div>
        </form>
      )}
    </div>
  );
}

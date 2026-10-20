import { useCallback, useEffect, useRef, useState } from "react";
import { messages } from "../messages";
import type { TodoDraft } from "../model";
import {
  ApiError,
  createTodo,
  deleteList,
  deleteTodo,
  fetchRevision,
  fetchState,
  patchTodo,
  removeUser,
  renameList,
  renameUser,
  restoreTodo,
  sendMemo,
} from "./client";
import type { Session } from "./session";
import type { CloudState, TodoPatch } from "./types";

export const POLL_INTERVAL_MS = 3000;

export type Board =
  | { phase: "login"; sessionError?: string }
  | { phase: "loading" }
  | { phase: "error"; message: string; retryable: true }
  | { phase: "ready"; state: CloudState; me: Session };

export type BoardActions = {
  addTodo: (draft: TodoDraft & { assigneeId: string | null }) => Promise<void>;
  updateTodo: (id: string, patch: TodoPatch) => Promise<void>;
  removeTodo: (id: string) => Promise<void>;
  undoRemove: (id: string) => Promise<void>;
  addMemo: (todoId: string, body: string) => Promise<void>;
  renameBoard: (title: string) => Promise<void>;
  removeBoard: () => Promise<void>;
  renameMember: (id: string, name: string) => Promise<void>;
  removeMember: (id: string) => Promise<void>;
  setAssignee: (id: string, assigneeId: string | null) => Promise<void>;
};

export type UseBoardResult = Board & BoardActions & { refresh: () => void };

export function useBoard(
  session: Session | null,
  onSessionLost: () => void,
): UseBoardResult {
  const [board, setBoard] = useState<Board>(() =>
    session ? { phase: "loading" } : { phase: "login" },
  );

  const token = session?.token ?? null;
  const userId = session?.userId ?? null;
  const name = session?.name ?? null;

  const sessionRef = useRef<Session | null>(session);
  sessionRef.current = session;
  const lostRef = useRef(onSessionLost);
  lostRef.current = onSessionLost;
  const reloadRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    if (token === null || userId === null || name === null) {
      setBoard({ phase: "login" });
      return;
    }
    const me: Session = { token, userId, name };
    let cancelled = false;
    let polling = false;
    let revision = -1;

    const fail = (error: unknown) => {
      if (cancelled) return;
      // ポーリングはエラー画面で止め、refresh() で再開する。
      polling = false;
      if (error instanceof ApiError && error.status === 404) {
        setBoard({ phase: "login" });
        lostRef.current();
        return;
      }
      setBoard({
        phase: "error",
        message: messages.errors.api.general,
        retryable: true,
      });
    };

    const load = async () => {
      try {
        const state = await fetchState(me.token);
        if (cancelled) return;
        // 遅れて届いた古い応答で新しい state を上書きしない。
        if (state.list.revision < revision) return;
        revision = state.list.revision;
        polling = true;
        setBoard({ phase: "ready", state, me });
      } catch (error) {
        fail(error);
      }
    };

    const tick = async () => {
      if (!polling) return;
      try {
        const next = await fetchRevision(me.token);
        if (cancelled || !polling || next <= revision) return;
        const state = await fetchState(me.token);
        if (cancelled || state.list.revision < revision) return;
        revision = state.list.revision;
        setBoard({ phase: "ready", state, me });
      } catch (error) {
        fail(error);
      }
    };

    reloadRef.current = load;
    polling = false;
    revision = -1;
    setBoard({ phase: "loading" });
    void load();
    const timer = window.setInterval(() => {
      void tick();
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [token, userId, name]);

  const refresh = useCallback(() => {
    void reloadRef.current();
  }, []);

  const run = useCallback(async (call: (token: string) => Promise<unknown>) => {
    const current = sessionRef.current;
    if (!current) return;
    // 変更操作の失敗は呼び出し元へ返し、一覧の表示やセッションを保つ。
    // セッション失効の判定は初回取得とポーリングの 404 だけに限る。
    await call(current.token);
    await reloadRef.current();
  }, []);

  const addTodo = useCallback(
    (draft: TodoDraft & { assigneeId: string | null }) =>
      run((current) => createTodo(current, draft)),
    [run],
  );
  const updateTodo = useCallback(
    (id: string, patch: TodoPatch) =>
      run((current) => patchTodo(current, id, patch)),
    [run],
  );
  const removeTodo = useCallback(
    (id: string) => run((current) => deleteTodo(current, id)),
    [run],
  );
  const undoRemove = useCallback(
    (id: string) => run((current) => restoreTodo(current, id)),
    [run],
  );
  const addMemo = useCallback(
    (todoId: string, body: string) =>
      run((current) => sendMemo(current, todoId, body)),
    [run],
  );
  const renameBoard = useCallback(
    (title: string) => run((current) => renameList(current, title)),
    [run],
  );
  const removeBoard = useCallback(
    () => run((current) => deleteList(current)),
    [run],
  );
  const renameMember = useCallback(
    (id: string, nextName: string) =>
      run((current) => renameUser(current, id, nextName)),
    [run],
  );
  const removeMember = useCallback(
    (id: string) => run((current) => removeUser(current, id)),
    [run],
  );
  const setAssignee = useCallback(
    (id: string, assigneeId: string | null) => updateTodo(id, { assigneeId }),
    [updateTodo],
  );

  return {
    ...board,
    refresh,
    addTodo,
    updateTodo,
    removeTodo,
    undoRemove,
    addMemo,
    renameBoard,
    removeBoard,
    renameMember,
    removeMember,
    setAssignee,
  };
}

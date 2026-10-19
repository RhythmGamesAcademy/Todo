import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Todo } from "../model";
import type { CompletionReceipt } from "./CompletionNotice";

/** Only explicit, successfully saved status changes are queued. Imports never play. */
export function useCompletionQueue(
  todos: Todo[],
  blocked: boolean,
  onPrepare: () => void,
) {
  const [queue, setQueue] = useState<string[]>([]);
  const [prepared, setPrepared] = useState<string | null>(null);
  const [arrival, setArrival] = useState(0);
  const [receipt, setReceipt] = useState<CompletionReceipt | null>(null);
  const sequence = useRef(0);
  const remaining = useRef(0);
  remaining.current = todos.filter((todo) => todo.status !== "done").length;
  const queuedIds = useRef(queue);
  queuedIds.current = queue;
  const target = useRef<HTMLButtonElement>(null);
  const counter = useRef<HTMLSpanElement>(null);
  const completed = useMemo(
    () =>
      new Map(todos.filter((t) => t.status === "done").map((t) => [t.id, t])),
    [todos],
  );
  const pending = queue.filter((id) => completed.has(id));
  const nextId = pending[0] ?? null;

  // Stage the navigation change first, so measurement starts on the unfinished tab.
  useEffect(() => {
    if (blocked || !nextId) {
      setPrepared(null);
    } else if (prepared !== nextId) {
      onPrepare();
      setReceipt(null);
      setPrepared(nextId);
    }
  }, [blocked, nextId, prepared, onPrepare]);

  useEffect(() => {
    setQueue((current) =>
      current.every((id) => completed.has(id))
        ? current
        : current.filter((id) => completed.has(id)),
    );
  }, [completed]);

  const enqueue = useCallback((todo: Todo) => {
    setQueue((current) =>
      current.includes(todo.id) ? current : [...current, todo.id],
    );
  }, []);
  const arrive = useCallback((id: string) => {
    if (!queuedIds.current.includes(id)) return;
    queuedIds.current = queuedIds.current.filter((queued) => queued !== id);
    setQueue((current) => current.filter((queued) => queued !== id));
    const arrivalId = ++sequence.current;
    setArrival(arrivalId);
    setReceipt({ id: arrivalId, remaining: remaining.current });
  }, []);
  const dismissReceipt = useCallback((id: number) => {
    setReceipt((current) => (current?.id === id ? null : current));
  }, []);

  return {
    enqueue,
    arrive,
    current:
      blocked || !nextId || prepared !== nextId ? null : completed.get(nextId)!,
    displayedCount: completed.size - pending.length,
    arrival,
    target,
    counter,
    receipt,
    dismissReceipt,
  };
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Todo } from "../model";

/** Only explicit, successfully saved status changes are queued. Imports never play. */
export function useCompletionQueue(todos: Todo[], blocked: boolean) {
  const [queue, setQueue] = useState<string[]>([]);
  const [arrival, setArrival] = useState(0);
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
    setArrival((current) => current + 1);
  }, []);

  return {
    enqueue,
    arrive,
    current: blocked || !pending.length ? null : completed.get(pending[0])!,
    displayedCount: completed.size - pending.length,
    arrival,
    target,
    counter,
  };
}

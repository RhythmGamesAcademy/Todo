import { messages } from "./messages";
import { useEffect, useState } from "react";
import { parseTodos, serializeTodos, STORAGE_KEY } from "./model";
import type { Todo } from "./model";
type TodoLayout = "cards" | "compact";
const LAYOUT_KEY = "todo:layout";
export function useTodoLayout() {
  const [layout, setLayout] = useState<TodoLayout>(() => {
    try {
      return localStorage.getItem(LAYOUT_KEY) === "compact"
        ? "compact"
        : "cards";
    } catch {
      return "cards";
    }
  });
  function changeLayout(value: TodoLayout) {
    setLayout(value);
    try {
      localStorage.setItem(LAYOUT_KEY, value);
    } catch {
      // A display preference must not prevent using the TODO data.
    }
  }
  return [layout, changeLayout] as const;
}
interface Stored {
  todos: Todo[];
  recovery: string | null;
  error: string | null;
}
function load(): Stored {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
    return { todos: raw ? parseTodos(raw) : [], recovery: null, error: null };
  } catch {
    return {
      todos: [],
      recovery: raw,
      error: raw
        ? messages.errors.corruptStorage
        : messages.errors.storageUnavailable,
    };
  }
}
export function useTodoStore() {
  const [stored, setStored] = useState(load);
  useEffect(() => {
    const sync = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY || e.key === null) setStored(load());
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  function save(todos: Todo[], recover = false) {
    if (stored.recovery && !recover) return false;
    try {
      localStorage.setItem(STORAGE_KEY, serializeTodos(todos));
      setStored({ todos, recovery: null, error: null });
      return true;
    } catch {
      setStored((s) => ({
        ...s,
        error: messages.errors.save,
      }));
      return false;
    }
  }
  return { ...stored, save };
}

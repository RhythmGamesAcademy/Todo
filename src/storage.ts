import { useState } from "react";

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

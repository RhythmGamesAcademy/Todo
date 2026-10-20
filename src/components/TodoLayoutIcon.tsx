import { LayoutGrid, List } from "lucide-react";
import type { TodoLayout } from "../storage";

const icons = { cards: LayoutGrid, compact: List };

export function TodoLayoutIcon({
  layout,
  size,
}: {
  layout: TodoLayout;
  size: number;
}) {
  const Icon = icons[layout];
  return <Icon size={size} aria-hidden="true" />;
}

import type { Ref } from "react";
import {
  CalendarClock,
  CalendarDays,
  SquareDashed,
  CircleCheck,
  LoaderCircle,
} from "lucide-react";
import type { Filter } from "../model";
import { messages } from "../messages";
import { CompletionSplash } from "../completion/CompletionSplash";
import { TodoLayoutIcon } from "./TodoLayoutIcon";
import type { TodoLayout } from "../storage";

const filters = [
  { key: "all", icon: null },
  { key: "active", icon: SquareDashed },
  { key: "overdue", icon: CalendarClock },
  { key: "today", icon: CalendarDays },
  { key: "doing", icon: LoaderCircle },
  { key: "done", icon: CircleCheck },
] as const;

interface Props {
  filter: Filter;
  layout: TodoLayout;
  counts: Record<Filter, number>;
  onSelect: (filter: Filter) => void;
  doneTarget: Ref<HTMLButtonElement>;
  doneCounter: Ref<HTMLSpanElement>;
  arrival: number;
}
export function TodoNavigation({
  filter,
  layout,
  counts,
  onSelect,
  doneTarget,
  doneCounter,
  arrival,
}: Props) {
  return (
    <nav aria-label={messages.app.navigation}>
      <div className="nav-items">
        {filters.map(({ key, icon: Icon }) => (
          <button
            key={key}
            ref={key === "done" ? doneTarget : undefined}
            className={"nav-item " + (filter === key ? "active" : "")}
            aria-current={filter === key ? "page" : undefined}
            onClick={() => onSelect(key)}
          >
            {Icon ? (
              <Icon size={19} aria-hidden="true" />
            ) : (
              <TodoLayoutIcon layout={layout} size={19} />
            )}
            <span>{messages.filters.navigation[key]}</span>
            <span className="nav-counter-anchor">
              <span
                key={key === "done" ? `count-${arrival}` : key}
                ref={key === "done" ? doneCounter : undefined}
                className={
                  "nav-count " +
                  (key === "done" && arrival ? "nav-count-arrived" : "")
                }
              >
                {counts[key]}
              </span>
              {key === "done" && arrival > 0 && (
                <CompletionSplash key={`splash-${arrival}`} />
              )}
            </span>
          </button>
        ))}
      </div>
    </nav>
  );
}

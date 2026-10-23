import type { Ref } from "react";
import {
  CalendarClock,
  CalendarDays,
  Circle,
  CircleCheck,
  LayoutGrid,
  LoaderCircle,
} from "lucide-react";
import type { Filter } from "../model";
import { messages } from "../messages";

const filters = [
  { key: "all", icon: LayoutGrid },
  { key: "overdue", icon: CalendarClock },
  { key: "active", icon: Circle },
  { key: "today", icon: CalendarDays },
  { key: "doing", icon: LoaderCircle },
  { key: "done", icon: CircleCheck },
] as const;

interface Props {
  filter: Filter;
  counts: Record<Filter, number>;
  onSelect: (filter: Filter) => void;
  doneTarget: Ref<HTMLButtonElement>;
  doneCounter: Ref<HTMLSpanElement>;
  arrival: number;
}
export function TodoNavigation({
  filter,
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
            <Icon size={19} />
            <span>{messages.filters.navigation[key]}</span>
            <span
              key={key === "done" ? arrival : key}
              ref={key === "done" ? doneCounter : undefined}
              className={
                "nav-count " +
                (key === "done" && arrival ? "nav-count-arrived" : "")
              }
            >
              {counts[key]}
            </span>
          </button>
        ))}
      </div>
    </nav>
  );
}

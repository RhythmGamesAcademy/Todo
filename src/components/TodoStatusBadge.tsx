import { CheckCheck, Circle } from "lucide-react";
import { STATUS } from "../model";
import type { Status } from "../model";

export function TodoStatusBadge({ status }: { status: Status }) {
  return (
    <span className={"status-badge status-" + status}>
      {status === "done" ? (
        <CheckCheck size={14} aria-hidden="true" />
      ) : status === "doing" ? (
        <span className="status-dot" />
      ) : (
        <Circle size={12} aria-hidden="true" />
      )}{" "}
      {STATUS[status]}
    </span>
  );
}

import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { messages } from "../messages";
import "./completionNotice.css";

export interface CompletionReceipt {
  id: number;
  remaining: number;
}

function noticeContent(remaining: number) {
  if (remaining === 0)
    return { tone: "green", detail: messages.completion.allDone };
  if (remaining === 1)
    return { tone: "orange", detail: messages.completion.oneLeft };
  return { tone: "blue", detail: messages.completion.keepGoing };
}

export function CompletionNotice({
  receipt,
  onDismiss,
}: {
  receipt: CompletionReceipt;
  onDismiss: (id: number) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const paused = hovered || focused;
  const content = noticeContent(receipt.remaining);
  useEffect(() => {
    if (paused) return;
    const timer = window.setTimeout(() => onDismiss(receipt.id), 6000);
    return () => window.clearTimeout(timer);
  }, [receipt.id, paused, onDismiss]);

  return (
    <div
      className={"completion-notice completion-notice-" + content.tone}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setFocused(false);
      }}
    >
      <span className="completion-notice-check" aria-hidden="true">
        <Check size={23} strokeWidth={2.5} />
      </span>
      <div role="status" aria-atomic="true">
        <p className="completion-notice-title">{messages.completion.title}</p>
        <p className="completion-notice-detail">{content.detail}</p>
      </div>
      <button
        type="button"
        className="completion-notice-close"
        onClick={() => onDismiss(receipt.id)}
        aria-label={messages.common.closeNotification}
      >
        <X size={17} />
      </button>
    </div>
  );
}

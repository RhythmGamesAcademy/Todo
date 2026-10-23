import { CalendarDays, Check, Flag, X } from "lucide-react";
import { dateText, PRIORITY } from "../model";
import type { Todo } from "../model";
import { messages } from "../messages";
import { useCompletionAnimation } from "./useCompletionAnimation";
import type { CompletionAnimationProps } from "./useCompletionAnimation";
import { SeaLion } from "./SeaLion";
import type { CSSProperties } from "react";
import { motion } from "./completionMotion";
import "./completion.css";

interface Props extends CompletionAnimationProps {
  todo: Todo;
}

export function CompletionCelebration({
  todo,
  target,
  counter,
  onArrive,
}: Props) {
  const { layer, card, swimmer, body, features, face, stage } =
    useCompletionAnimation(todo.id, {
      target,
      counter,
      onArrive,
    });

  return (
    <div className="completion-layer" ref={layer}>
      <div className="completion-shade" aria-hidden="true" />
      <div className="completion-announcement sr-only" role="status">
        {messages.completion.announced(todo.title)}
      </div>
      <div
        className="completion-swimmer"
        ref={swimmer}
        data-stage={stage}
        style={
          { "--morph-duration": `${motion.morph.duration}ms` } as CSSProperties
        }
        aria-hidden="true"
      >
        <SeaLion body={body} features={features} face={face} />
        <div className="completion-paper" ref={card}>
          <span className="completion-seal">
            <Check size={29} strokeWidth={3} />
          </span>
          <span className="completion-label">{messages.status.done}</span>
          <h2>{todo.title}</h2>
          {todo.description && <p>{todo.description}</p>}
          <div className="completion-card-meta">
            <span>
              <CalendarDays size={15} />
              {todo.deadline
                ? dateText(todo.deadline)
                : messages.todo.noDeadline}
            </span>
            <span className={"priority priority-" + todo.priority}>
              <Flag size={14} />
              {messages.todo.priorityLabel(PRIORITY[todo.priority])}
            </span>
          </div>
        </div>
      </div>
      <button
        type="button"
        className="completion-skip"
        onClick={() => onArrive(todo.id)}
        aria-label={messages.completion.skip}
      >
        <X size={17} />
        {messages.completion.skip}
      </button>
    </div>
  );
}

import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { CalendarDays, Check, Flag, X } from "lucide-react";
import { dateText, PRIORITY } from "../model";
import type { Todo } from "../model";
import { messages } from "../messages";
import { centerOf, flightKeyframes } from "./flightGeometry";
import "./completion.css";

interface Props {
  todo: Todo;
  target: RefObject<HTMLButtonElement | null>;
  counter: RefObject<HTMLSpanElement | null>;
  onArrive: (id: string) => void;
}

const motion = {
  present: { duration: 640, easing: "cubic-bezier(.16,1,.3,1)" },
  crumple: { duration: 380, easing: "cubic-bezier(.4,0,.7,1)" },
  unfold: { duration: 150, easing: "ease-out" },
  fly: { duration: 720, easing: "cubic-bezier(.4,0,.65,1)" },
} as const;

export function CompletionCelebration({
  todo,
  target,
  counter,
  onArrive,
}: Props) {
  const layer = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const plane = useRef<HTMLDivElement>(null);
  const latest = useRef({ target, counter, onArrive });
  latest.current = { target, counter, onArrive };

  useEffect(() => {
    const paper = card.current;
    const aircraft = plane.current;
    if (!paper || !aircraft) return;
    let cancelled = false;
    let delivered = false;
    const animations: Animation[] = [];
    const arrive = () => {
      if (!cancelled && !delivered) {
        delivered = true;
        latest.current.onArrive(todo.id);
      }
    };
    const play = async (
      element: HTMLElement,
      frames: Keyframe[],
      options: KeyframeAnimationOptions,
    ) => {
      const animation = element.animate(frames, {
        ...options,
        fill: "forwards",
      });
      animations.push(animation);
      await animation.finished;
      if (cancelled) throw new DOMException("Cancelled", "AbortError");
    };
    const revealTarget = () => {
      latest.current.target.current?.scrollIntoView({
        block: "nearest",
        inline: "center",
        behavior: "instant",
      });
    };
    const resized = () => {
      revealTarget();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") arrive();
    };
    // Suspended rendering must never leave the saved count waiting indefinitely.
    const maximumDuration =
      Object.values(motion).reduce((sum, phase) => sum + phase.duration, 0) +
      1000;
    const watchdog = window.setTimeout(arrive, maximumDuration);
    const backgrounded = () => {
      if (document.hidden) arrive();
    };
    window.addEventListener("keydown", escape);
    document.addEventListener("visibilitychange", backgrounded);
    window.addEventListener("resize", resized);
    window.visualViewport?.addEventListener("resize", resized);

    async function run() {
      if (!paper || !aircraft || typeof paper.animate !== "function") {
        arrive();
        return;
      }
      revealTarget();
      await play(
        paper,
        [
          { opacity: 0, transform: "scale(.72) translateY(24px)", offset: 0 },
          {
            opacity: 1,
            transform: "scale(1.04) translateY(-4px)",
            offset: 0.55,
          },
          { opacity: 1, transform: "scale(1) translateY(0)", offset: 1 },
        ],
        motion.present,
      );
      await play(
        paper,
        [
          {
            transform: "scale(1) rotate(0)",
            borderRadius: "24px",
            clipPath: "polygon(0 0,100% 0,100% 100%,0 100%)",
            opacity: 1,
          },
          {
            transform: "scale(.65,.82) rotate(-8deg)",
            borderRadius: "40px",
            clipPath: "polygon(12% 8%,85% 0,100% 82%,15% 100%)",
            offset: 0.45,
          },
          {
            transform: "scale(.12,.18) rotate(18deg)",
            borderRadius: "65px",
            clipPath: "polygon(18% 12%,90% 20%,82% 92%,8% 72%)",
            opacity: 0,
          },
        ],
        motion.crumple,
      );
      await play(
        aircraft,
        [
          {
            opacity: 0,
            transform: "translate(-50%, -50%) scale(.2) rotate(-25deg)",
          },
          {
            opacity: 1,
            transform: flightKeyframes(
              centerOf(layer.current!.getBoundingClientRect()),
              centerOf(
                (
                  latest.current.counter.current ??
                  latest.current.target.current ??
                  layer.current!
                ).getBoundingClientRect(),
              ),
            )[0].transform,
          },
        ],
        motion.unfold,
      );

      // Measure after unfolding: scrolling, font sizing and the mobile menu may have changed.
      revealTarget();
      const destination =
        latest.current.counter.current ?? latest.current.target.current;
      if (!destination) {
        arrive();
        return;
      }
      let origin = centerOf(layer.current!.getBoundingClientRect());
      let landing = centerOf(destination.getBoundingClientRect());
      const animation = aircraft.animate(flightKeyframes(origin, landing), {
        ...motion.fly,
        fill: "forwards",
      });
      animations.push(animation);
      const track = () => {
        const element =
          latest.current.counter.current ?? latest.current.target.current;
        if (!element) return;
        const next = centerOf(element.getBoundingClientRect());
        const nextOrigin = centerOf(layer.current!.getBoundingClientRect());
        if (
          Math.hypot(next.x - landing.x, next.y - landing.y) > 1 ||
          Math.hypot(nextOrigin.x - origin.x, nextOrigin.y - origin.y) > 1
        ) {
          landing = next;
          origin = nextOrigin;
          (animation.effect as KeyframeEffect).setKeyframes(
            flightKeyframes(origin, landing),
          );
        }
      };
      const tracking = window.setInterval(track, 32);
      try {
        await animation.finished;
      } finally {
        window.clearInterval(tracking);
      }
      arrive();
    }
    void run().catch(() => {
      arrive();
    });
    return () => {
      cancelled = true;
      window.clearTimeout(watchdog);
      animations.forEach((animation) => animation.cancel());
      window.removeEventListener("keydown", escape);
      document.removeEventListener("visibilitychange", backgrounded);
      window.removeEventListener("resize", resized);
      window.visualViewport?.removeEventListener("resize", resized);
    };
  }, [todo.id]);

  return (
    <div className="completion-layer" ref={layer}>
      <div className="completion-shade" aria-hidden="true" />
      <div className="completion-announcement sr-only" role="status">
        {messages.completion.announced(todo.title)}
      </div>
      <div className="completion-paper" ref={card} aria-hidden="true">
        <span className="completion-seal">
          <Check size={29} strokeWidth={3} />
        </span>
        <span className="completion-label">{messages.status.done}</span>
        <h2>{todo.title}</h2>
        {todo.description && <p>{todo.description}</p>}
        <div className="completion-card-meta">
          <span>
            <CalendarDays size={15} />
            {todo.deadline ? dateText(todo.deadline) : messages.todo.noDeadline}
          </span>
          <span className={"priority priority-" + todo.priority}>
            <Flag size={14} />
            {messages.todo.priorityLabel(PRIORITY[todo.priority])}
          </span>
        </div>
        <span className="completion-crease" />
      </div>
      <div className="completion-plane" ref={plane} aria-hidden="true">
        <svg viewBox="0 0 120 90" fill="none">
          <path
            d="M5 8 116 44 5 82 32 44Z"
            fill="white"
            stroke="#1767d7"
            strokeWidth="3"
            strokeLinejoin="round"
          />
          <path d="M5 8 116 44 32 44Z" fill="#e5efff" />
          <path d="M32 44 5 82 116 44 43 56Z" fill="#c6dcff" />
          <path
            d="m32 44 84 0-73 12-11-12L5 8m38 48-7 18 23-24"
            stroke="#1767d7"
            strokeWidth="2"
            strokeLinejoin="round"
          />
        </svg>
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

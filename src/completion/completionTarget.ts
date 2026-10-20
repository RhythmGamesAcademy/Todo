import { centerOf, swimKeyframes } from "./swimGeometry";
import { motion } from "./completionMotion";
import type { AnimationSession } from "./AnimationSession";

export function completionTarget(
  layer: HTMLElement,
  readTarget: () => HTMLElement | null,
) {
  return {
    reveal() {
      readTarget()?.scrollIntoView({
        block: "nearest",
        inline: "center",
        behavior: "instant",
      });
    },
    measure() {
      const target = readTarget();
      return target
        ? {
            origin: centerOf(layer.getBoundingClientRect()),
            destination: centerOf(target.getBoundingClientRect()),
          }
        : null;
    },
  };
}
export type CompletionTarget = ReturnType<typeof completionTarget>;

/** Re-measure the rendered destination while swimming, including viewport changes. */
export async function swimToTarget(
  session: AnimationSession,
  swimmer: HTMLElement,
  target: CompletionTarget,
) {
  target.reveal();
  let position = target.measure();
  if (!position) return;
  const animation = session.start(
    swimmer,
    swimKeyframes(position.origin, position.destination),
    motion.swim,
  );
  const timer = window.setInterval(() => {
    const next = target.measure();
    if (!next || !position) return;
    const moved =
      Math.hypot(
        next.origin.x - position.origin.x,
        next.origin.y - position.origin.y,
      ) > 1 ||
      Math.hypot(
        next.destination.x - position.destination.x,
        next.destination.y - position.destination.y,
      ) > 1;
    if (moved) {
      position = next;
      (animation.effect as KeyframeEffect).setKeyframes(
        swimKeyframes(next.origin, next.destination),
      );
    }
  }, 32);
  const stopTracking = session.own(() => window.clearInterval(timer));
  try {
    await animation.finished;
    session.assertActive();
  } finally {
    stopTracking();
  }
}

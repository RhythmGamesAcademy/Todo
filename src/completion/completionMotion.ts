import type { Point } from "./swimGeometry";
export type CompletionStage =
  "present" | "morph" | "turn" | "anticipate" | "swim";

export const motion = {
  present: { duration: 450, easing: "cubic-bezier(.16,1,.3,1)" },
  morph: { duration: 650, easing: "linear" },
  turn: { duration: 880, easing: "cubic-bezier(.4,0,.25,1)" },
  anticipate: { duration: 190, easing: "cubic-bezier(.3,0,.7,1)" },
  swim: { duration: 500, easing: "cubic-bezier(.5,.05,.72,.35)" },
} as const;
export const maximumDuration =
  Object.values(motion).reduce((sum, phase) => sum + phase.duration, 0) + 1000;

export const swimming = {
  pullback: 18,
  turnRadius: 86,
  turnWidthRatio: 0.19,
  retreat: 140,
  approach: 55,
  yaw: 55,
  samples: 24,
  finalScale: 0.14,
  fadeStart: 0.9,
} as const;

export function launchOffset(origin: Point, destination: Point): Point {
  const dx = destination.x - origin.x,
    dy = destination.y - origin.y;
  const distance = Math.hypot(dx, dy);
  return distance
    ? {
        x: (-dx / distance) * swimming.pullback,
        y: (-dy / distance) * swimming.pullback,
      }
    : { x: 0, y: 0 };
}
export function anticipationFrames(
  origin: Point,
  destination: Point,
): Keyframe[] {
  const back = launchOffset(origin, destination);
  return [
    { transform: centered + " translate(0px, 0px) scale(1, 1)", offset: 0 },
    {
      transform:
        centered + ` translate(${back.x}px, ${back.y}px) scale(.84, 1.12)`,
      offset: 1,
    },
  ];
}

const centered = "translate(-50%, -50%)";
export const presentFrames: Keyframe[] = [
  { opacity: 0, transform: centered + " scale(.68)", offset: 0 },
  { opacity: 1, transform: centered + " scale(1.075)", offset: 0.55 },
  { opacity: 1, transform: centered + " scale(1)", offset: 1 },
];
export function morphSizeFrames(
  width: number,
  height: number,
  availableWidth: number,
): Keyframe[] {
  const creatureWidth = Math.min(160, availableWidth * 0.44);
  // Sample the same easing as the outline, using a shared animation clock.
  return Array.from({ length: 21 }, (_, index) => {
    const t = index / 20,
      eased = t * t * (3 - 2 * t);
    return {
      offset: t,
      width: `${width + (creatureWidth - width) * eased}px`,
      height: `${height + ((creatureWidth * 100) / 160 - height) * eased}px`,
      opacity: 1,
      transform: centered + " scale(1)",
    };
  });
}
export const contentFadeFrames: Keyframe[] = [
  { opacity: 1, offset: 0 },
  { opacity: 0, offset: 0.3 },
  { opacity: 0, offset: 1 },
];

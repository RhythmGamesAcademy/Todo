export const motion = {
  present: { duration: 640, easing: "cubic-bezier(.16,1,.3,1)" },
  morph: { duration: 850, easing: "linear" },
  turn: { duration: 1250, easing: "linear" },
  swim: { duration: 650, easing: "cubic-bezier(.55,0,.8,.65)" },
} as const;

const centered = "translate(-50%, -50%)";
export const presentFrames: Keyframe[] = [
  { opacity: 0, transform: centered + " scale(.72)", offset: 0 },
  { opacity: 1, transform: centered + " scale(1.04)", offset: 0.55 },
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

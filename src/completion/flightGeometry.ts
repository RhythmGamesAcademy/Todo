export interface Point {
  x: number;
  y: number;
}
export interface Bounds {
  left: number;
  top: number;
  width: number;
  height: number;
}
export const centerOf = (bounds: Bounds): Point => ({
  x: bounds.left + bounds.width / 2,
  y: bounds.top + bounds.height / 2,
});

// Visual tuning only; neither the viewport size nor the destination is fixed here.
const curve = {
  liftRatio: 0.28,
  maximumLift: 140,
  controlRatio: 0.35,
  samples: 12,
  finalScale: 0.14,
  fadeStart: 0.85,
} as const;

/** A viewport-independent curve: the destination comes from the rendered counter. */
export function flightKeyframes(origin: Point, destination: Point): Keyframe[] {
  const dx = destination.x - origin.x;
  const dy = destination.y - origin.y;
  const distance = Math.hypot(dx, dy);
  const lift = Math.min(distance * curve.liftRatio, curve.maximumLift);
  const control = {
    x: origin.x + dx * curve.controlRatio,
    y: Math.min(origin.y, destination.y) - lift,
  };
  const steps = curve.samples;
  return Array.from({ length: steps + 1 }, (_, index) => {
    const t = index / steps;
    const inverse = 1 - t;
    const x =
      inverse * inverse * origin.x +
      2 * inverse * t * control.x +
      t * t * destination.x;
    const y =
      inverse * inverse * origin.y +
      2 * inverse * t * control.y +
      t * t * destination.y;
    const tangentX =
      2 * inverse * (control.x - origin.x) +
      2 * t * (destination.x - control.x);
    const tangentY =
      2 * inverse * (control.y - origin.y) +
      2 * t * (destination.y - control.y);
    const angle = (Math.atan2(tangentY, tangentX) * 180) / Math.PI;
    const scale = 1 - (1 - curve.finalScale) * t * t;
    return {
      offset: t,
      transform: `translate(-50%, -50%) translate(${x - origin.x}px, ${y - origin.y}px) rotate(${angle}deg) scale(${scale})`,
      opacity: t < curve.fadeStart ? 1 : (1 - t) / (1 - curve.fadeStart),
    };
  });
}

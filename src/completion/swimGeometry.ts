import { launchOffset, swimming } from "./completionMotion";
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
} as const;

function controlPoint(origin: Point, destination: Point): Point {
  const dx = destination.x - origin.x;
  const dy = destination.y - origin.y;
  const lift = Math.min(
    Math.hypot(dx, dy) * curve.liftRatio,
    curve.maximumLift,
  );
  return {
    x: origin.x + dx * curve.controlRatio,
    y: Math.min(origin.y, destination.y) - lift,
  };
}

/** A horizontal S-turn: yaw and depth change, while the animal stays upright. */
export function turnKeyframes(bounds: Bounds, destination: Point): Keyframe[] {
  const origin = centerOf(bounds);
  const direction = destination.x < origin.x ? -1 : 1;
  const radius = Math.min(
    swimming.turnRadius,
    bounds.width * swimming.turnWidthRatio,
  );
  const steps = 40;
  return Array.from({ length: steps + 1 }, (_, index) => {
    const t = index / steps;
    const theta = t * Math.PI * 2;
    const x = index === steps ? 0 : direction * radius * Math.sin(theta);
    const wave = index === steps ? 0 : Math.sin(theta);
    const depth =
      (-swimming.retreat * (1 - Math.cos(theta))) / 2 +
      swimming.approach * wave;
    const yaw = direction * swimming.yaw * wave;
    const scale = 1 - (0.2 * (1 - Math.cos(theta))) / 2 + 0.14 * wave;
    return {
      offset: t,
      opacity: 1,
      transform: `translate(-50%, -50%) perspective(800px) translate(${x}px, 0px) translateZ(${depth}px) rotateY(${yaw}deg) scale(${scale})`,
    };
  });
}

/** A viewport-independent curve: the destination comes from the rendered counter. */
export function swimKeyframes(origin: Point, destination: Point): Keyframe[] {
  const back = launchOffset(origin, destination);
  const start = { x: origin.x + back.x, y: origin.y + back.y };
  const control = controlPoint(start, destination);
  const steps = swimming.samples;
  return Array.from({ length: steps + 1 }, (_, index) => {
    const t = index / steps;
    const inverse = 1 - t;
    const x =
      inverse * inverse * start.x +
      2 * inverse * t * control.x +
      t * t * destination.x;
    const y =
      inverse * inverse * start.y +
      2 * inverse * t * control.y +
      t * t * destination.y;
    const yaw = -18 * Math.sin(Math.PI * t);
    const scale = 1 - (1 - swimming.finalScale) * t * t;
    const stretch = Math.sin(Math.min(t / 0.42, 1) * Math.PI);
    const squash = Math.max(0, 1 - t / 0.12);
    const scaleX = scale * (1 + 0.2 * stretch - 0.16 * squash);
    const scaleY = scale * (1 - 0.15 * stretch + 0.12 * squash);
    return {
      offset: t,
      transform: `translate(-50%, -50%) translate(${x - origin.x}px, ${y - origin.y}px) perspective(800px) rotateY(${yaw}deg) scale(${scaleX}, ${scaleY})`,
      opacity: t < swimming.fadeStart ? 1 : (1 - t) / (1 - swimming.fadeStart),
    };
  });
}

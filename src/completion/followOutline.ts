import { outlinePath } from "./seaLionShape";
import type { Outline } from "./seaLionShape";

/** The browser animation clock drives the outline too, keeping size and shape in sync. */
export function followOutline(
  path: SVGPathElement,
  from: Outline,
  to: Outline,
  animation: Animation,
  duration: number,
) {
  let frame: number | undefined;
  let stopped = false;
  const draw = () => {
    if (stopped) return;
    path.setAttribute(
      "d",
      outlinePath(from, to, Number(animation.currentTime ?? 0) / duration),
    );
    frame = window.requestAnimationFrame(draw);
  };
  if (typeof window.requestAnimationFrame === "function") draw();
  return () => {
    stopped = true;
    if (frame !== undefined) window.cancelAnimationFrame(frame);
  };
}

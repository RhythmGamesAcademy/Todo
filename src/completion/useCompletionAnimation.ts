import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { centerOf, swimKeyframes, turnKeyframes } from "./swimGeometry";
import {
  motion,
  presentFrames,
  morphSizeFrames,
  contentFadeFrames,
} from "./completionMotion";
import {
  cardOutline,
  seaLionOutline,
  outlinePath,
  followOutline,
} from "./seaLionShape";

export interface CompletionAnimationProps {
  target: RefObject<HTMLButtonElement | null>;
  counter: RefObject<HTMLSpanElement | null>;
  onArrive: (id: string) => void;
}

export function useCompletionAnimation(
  id: string,
  { target, counter, onArrive }: CompletionAnimationProps,
) {
  const layer = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const swimmer = useRef<HTMLDivElement>(null);
  const body = useRef<SVGPathElement>(null);
  const features = useRef<SVGGElement>(null);
  const [stage, setStage] = useState("present");
  const latest = useRef({ target, counter, onArrive });
  latest.current = { target, counter, onArrive };

  useEffect(() => {
    const paper = card.current;
    const seaLion = swimmer.current;
    const surface = body.current;
    if (!paper || !seaLion || !surface) return;
    let cancelled = false;
    let delivered = false;
    const animations: Animation[] = [];
    let stopOutline: (() => void) | undefined;
    const arrive = () => {
      if (!cancelled && !delivered) {
        delivered = true;
        latest.current.onArrive(id);
      }
    };
    const start = (
      element: HTMLElement,
      frames: Keyframe[],
      options: KeyframeAnimationOptions,
    ) => {
      const animation = element.animate(frames, {
        ...options,
        fill: "forwards",
      });
      animations.push(animation);
      return animation;
    };
    const play = async (
      element: HTMLElement,
      frames: Keyframe[],
      options: KeyframeAnimationOptions,
    ) => {
      const animation = start(element, frames, options);
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
      if (!paper || !seaLion || typeof paper.animate !== "function") {
        arrive();
        return;
      }
      revealTarget();
      const paperBounds = paper.getBoundingClientRect();
      const initialOutline = cardOutline(paperBounds.width, paperBounds.height);
      surface!.setAttribute("d", outlinePath(initialOutline));
      await play(seaLion, presentFrames, motion.present);
      const bounds = layer.current!.getBoundingClientRect();
      const destination =
        latest.current.counter.current ?? latest.current.target.current;
      if (!destination) {
        arrive();
        return;
      }
      const facingLeft =
        centerOf(destination.getBoundingClientRect()).x < centerOf(bounds).x;
      const animalOutline = seaLionOutline(facingLeft);
      const facingTransform = facingLeft ? "translate(160 0) scale(-1 1)" : "";
      features.current?.setAttribute("transform", facingTransform);
      surface!.ownerSVGElement
        ?.querySelector(".sea-lion-face-and-fin")
        ?.setAttribute("transform", facingTransform);
      setStage("morph");
      const resizing = start(
        seaLion,
        morphSizeFrames(paperBounds.width, paperBounds.height, bounds.width),
        motion.morph,
      );
      stopOutline = followOutline(
        surface!,
        cardOutline(paperBounds.width, paperBounds.height, facingLeft),
        animalOutline,
        resizing,
        motion.morph.duration,
      );
      try {
        await Promise.all([
          resizing.finished,
          play(paper, contentFadeFrames, motion.morph),
        ]);
      } finally {
        stopOutline();
      }
      if (cancelled) return;
      surface!.setAttribute("d", outlinePath(animalOutline));
      setStage("turn");
      const turns = turnKeyframes(
        bounds,
        centerOf(destination.getBoundingClientRect()),
      );
      await play(seaLion, turns, motion.turn);

      // Measure again after the turn; mobile navigation may have scrolled.
      revealTarget();
      const landingElement =
        latest.current.counter.current ?? latest.current.target.current;
      if (!landingElement) {
        arrive();
        return;
      }
      let origin = centerOf(layer.current!.getBoundingClientRect());
      let landing = centerOf(landingElement.getBoundingClientRect());
      setStage("swim");
      const animation = seaLion.animate(swimKeyframes(origin, landing), {
        ...motion.swim,
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
            swimKeyframes(origin, landing),
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
      stopOutline?.();
      animations.forEach((animation) => animation.cancel());
      window.removeEventListener("keydown", escape);
      document.removeEventListener("visibilitychange", backgrounded);
      window.removeEventListener("resize", resized);
      window.visualViewport?.removeEventListener("resize", resized);
    };
  }, [id]);

  return { layer, card, swimmer, body, features, stage };
}

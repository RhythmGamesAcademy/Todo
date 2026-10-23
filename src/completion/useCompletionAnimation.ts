import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { AnimationSession } from "./AnimationSession";
import { completionTarget } from "./completionTarget";
import { playCompletion } from "./completionSequence";
import { maximumDuration } from "./completionMotion";
import type { CompletionStage } from "./completionMotion";

export interface CompletionAnimationProps {
  target: RefObject<HTMLButtonElement | null>;
  counter: RefObject<HTMLSpanElement | null>;
  onArrive: (id: string) => void;
}

export function useCompletionAnimation(
  id: string,
  props: CompletionAnimationProps,
) {
  const layer = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const swimmer = useRef<HTMLDivElement>(null);
  const body = useRef<SVGPathElement>(null);
  const features = useRef<SVGGElement>(null);
  const face = useRef<SVGGElement>(null);
  const [stage, setStage] = useState<CompletionStage>("present");
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    if (
      !layer.current ||
      !card.current ||
      !swimmer.current ||
      !body.current ||
      !features.current ||
      !face.current
    )
      return;
    const elements = {
      layer: layer.current,
      card: card.current,
      swimmer: swimmer.current,
      body: body.current,
      features: features.current,
      face: face.current,
    };
    const session = new AnimationSession();
    let delivered = false;
    const arrive = () => {
      if (session.active && !delivered) {
        delivered = true;
        latest.current.onArrive(id);
      }
    };
    const target = completionTarget(
      elements.layer,
      () => latest.current.counter.current ?? latest.current.target.current,
    );
    session.listen(window, "keydown", (event) => {
      if ((event as KeyboardEvent).key === "Escape") arrive();
    });
    session.listen(document, "visibilitychange", () => {
      if (document.hidden) arrive();
    });
    session.listen(window, "resize", () => target.reveal());
    if (window.visualViewport)
      session.listen(window.visualViewport, "resize", () => target.reveal());
    session.after(maximumDuration, arrive);
    if (typeof elements.swimmer.animate !== "function") arrive();
    else
      void playCompletion(session, elements, target, setStage)
        .then(arrive)
        .catch((error) => {
          if (session.active && error?.name !== "AbortError")
            console.error("Completion animation failed", error);
          arrive();
        });
    return () => session.cancel();
  }, [id]);
  return { layer, card, swimmer, body, features, face, stage };
}

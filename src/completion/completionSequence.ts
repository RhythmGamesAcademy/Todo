import type { AnimationSession } from "./AnimationSession";
import {
  motion,
  presentFrames,
  morphSizeFrames,
  contentFadeFrames,
  anticipationFrames,
} from "./completionMotion";
import type { CompletionStage } from "./completionMotion";
import { cardOutline, seaLionOutline, outlinePath } from "./seaLionShape";
import { followOutline } from "./followOutline";
import { turnKeyframes, centerOf } from "./swimGeometry";
import { swimToTarget } from "./completionTarget";
import type { CompletionTarget } from "./completionTarget";

export interface CompletionElements {
  layer: HTMLDivElement;
  card: HTMLDivElement;
  swimmer: HTMLDivElement;
  body: SVGPathElement;
  features: SVGGElement;
  face: SVGGElement;
}

async function morphCard(
  session: AnimationSession,
  elements: CompletionElements,
  target: CompletionTarget,
) {
  const { card, swimmer, body, features, face, layer } = elements;
  const bounds = card.getBoundingClientRect();
  const destination = target.measure();
  if (!destination) return;
  const facingLeft = destination.destination.x < destination.origin.x;
  const from = cardOutline(bounds.width, bounds.height, facingLeft);
  const to = seaLionOutline(facingLeft);
  const facing = facingLeft ? "translate(160 0) scale(-1 1)" : "";
  features.setAttribute("transform", facing);
  face.setAttribute("transform", facing);
  // Keep the text's layout stable while its surface changes size beneath it.
  swimmer.style.setProperty("--paper-width", `${bounds.width}px`);
  const animation = session.start(
    swimmer,
    morphSizeFrames(
      bounds.width,
      bounds.height,
      layer.clientWidth || layer.getBoundingClientRect().width,
    ),
    motion.morph,
  );
  const stopDrawing = session.own(
    followOutline(body, from, to, animation, motion.morph.duration),
  );
  try {
    await Promise.all([
      animation.finished,
      session.play(card, contentFadeFrames, motion.morph),
    ]);
    session.assertActive();
    body.setAttribute("d", outlinePath(to));
  } finally {
    stopDrawing();
  }
}

/** Choreography only: timing, geometry, drawing and lifecycle have separate owners. */
export async function playCompletion(
  session: AnimationSession,
  elements: CompletionElements,
  target: CompletionTarget,
  stage: (stage: CompletionStage) => void,
) {
  const { card, body, swimmer, layer } = elements;
  target.reveal();
  const bounds = card.getBoundingClientRect();
  body.setAttribute("d", outlinePath(cardOutline(bounds.width, bounds.height)));
  await session.play(swimmer, presentFrames, motion.present);
  stage("morph");
  await morphCard(session, elements, target);
  const position = target.measure();
  if (!position) return;
  stage("turn");
  await session.play(
    swimmer,
    turnKeyframes(layer.getBoundingClientRect(), position.destination),
    motion.turn,
  );
  target.reveal();
  const launch = target.measure();
  if (!launch) return;
  stage("anticipate");
  await session.play(
    swimmer,
    anticipationFrames(
      centerOf(layer.getBoundingClientRect()),
      launch.destination,
    ),
    motion.anticipate,
  );
  stage("swim");
  await swimToTarget(session, swimmer, target);
}

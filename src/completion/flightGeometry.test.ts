import { describe, expect, it } from "vitest";
import { centerOf, flightKeyframes } from "./flightGeometry";

describe("紙飛行機の経路", () => {
  it.each([
    [
      { x: 700, y: 400 },
      { x: 180, y: 330 },
    ],
    [
      { x: 195, y: 422 },
      { x: 285, y: 85 },
    ],
    [
      { x: 100, y: 100 },
      { x: 100, y: 100 },
    ],
  ])(
    "左右・上下・距離ゼロでも渡された目的地に到達する",
    (origin, destination) => {
      const frames = flightKeyframes(origin, destination);
      const delta = frames.at(-1)?.transform;
      expect(delta).toContain(
        `translate(${destination.x - origin.x}px, ${destination.y - origin.y}px)`,
      );
      expect(
        frames.some((frame) => String(frame.transform).includes("NaN")),
      ).toBe(false);
      expect(frames.at(-1)?.opacity).toBe(0);
    },
  );
  it("カウンターの矩形の中心を到着地点にする", () => {
    expect(centerOf({ left: 280, top: 78, width: 20, height: 18 })).toEqual({
      x: 290,
      y: 87,
    });
  });
});

import { describe, expect, it } from "vitest";
import { centerOf, swimKeyframes, turnKeyframes } from "./swimGeometry";
import { anticipationFrames } from "./completionMotion";

describe("トドの経路", () => {
  it("溜めの終点から途切れず発進し、体を伸ばしてから目的地へ収束する", () => {
    const origin = { x: 195, y: 422 },
      destination = { x: 280, y: 85 };
    const anticipation = anticipationFrames(origin, destination);
    const swim = swimKeyframes(origin, destination);
    const translation = (frame: Keyframe) =>
      String(frame.transform)
        .match(/translate\((-?[\d.e+-]+)px, (-?[\d.e+-]+)px\)/)
        ?.slice(1)
        .map(Number);
    const before = translation(anticipation.at(-1)!)!;
    const after = translation(swim[0])!;
    expect(before[0]).toBeCloseTo(after[0]);
    expect(before[1]).toBeCloseTo(after[1]);
    expect(String(swim[0].transform)).toContain("scale(0.84, 1.12)");
    const early = swim.find((frame) => frame.offset! >= 0.2)!;
    const [, x, y] = String(early.transform).match(
      /scale\(([-\d.e+]+), ([-\d.e+]+)\)/,
    )!;
    expect(Number(x)).toBeGreaterThan(Number(y));
    expect(swim.at(-1)?.transform).toContain("translate(85px, -337px)");
  });
  it.each([
    { width: 390, height: 844 },
    { width: 1440, height: 900 },
  ])("旋回は画面に収まり、中心へ戻ってから泳ぎ出す (%o)", (size) => {
    const bounds = { left: 0, top: 0, ...size };
    const destination = { x: 280, y: 80 };
    const turns = turnKeyframes(bounds, destination);
    expect(turns[0].transform).toContain("translate(0px, 0px)");
    expect(turns.at(-1)?.transform).toContain("translate(0px, 0px)");
    for (const frame of turns) {
      const [, x, y] = String(frame.transform).match(
        /translate\((-?[\d.e+-]+)px, (-?[\d.e+-]+)px\)/,
      )!;
      expect(Math.abs(Number(x)) + 80).toBeLessThan(size.width / 2);
      expect(Number(y)).toBe(0);
    }
    const yaw = turns.map((frame) =>
      Number(String(frame.transform).match(/rotateY\(([-\d.e+]+)deg\)/)![1]),
    );
    expect(Math.min(...yaw)).toBeLessThan(0);
    expect(Math.max(...yaw)).toBeGreaterThan(0);
    expect(Math.max(...yaw.map(Math.abs))).toBeLessThan(90);
    expect(
      turns.some(
        (frame) => !String(frame.transform).includes("translateZ(0px)"),
      ),
    ).toBe(true);
    expect(turns.at(-1)?.transform).toContain("rotateY(0deg) scale(1)");
    expect(turns.some((frame) => String(frame.transform).includes("NaN"))).toBe(
      false,
    );
  });
  it.each([
    [
      { x: 700, y: 400 },
      { x: 180, y: 330 },
    ],
    [
      { x: 700, y: 250 },
      { x: 180, y: 375 },
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
      const frames = swimKeyframes(origin, destination);
      const delta = frames.at(-1)?.transform;
      expect(delta).toContain(
        `translate(${destination.x - origin.x}px, ${destination.y - origin.y}px)`,
      );
      expect(
        frames.some((frame) => String(frame.transform).includes("NaN")),
      ).toBe(false);
      expect(frames.at(-1)?.opacity).toBe(0);
      expect(
        frames.every(
          (frame) => !/rotate\(|rotateZ\(/.test(String(frame.transform)),
        ),
      ).toBe(true);
    },
  );
  it("カウンターの矩形の中心を到着地点にする", () => {
    expect(centerOf({ left: 280, top: 78, width: 20, height: 18 })).toEqual({
      x: 290,
      y: 87,
    });
  });
});

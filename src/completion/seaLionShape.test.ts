import { describe, expect, it } from "vitest";
import { cardOutline, seaLionOutline, outlinePath } from "./seaLionShape";

describe("カードからトドへの輪郭変形", () => {
  it.each([false, true])(
    "向きが%oでも一つの面を閉じた輪郭のまま変形する",
    (facingLeft) => {
      const card = cardOutline(350, 260, facingLeft);
      const animal = seaLionOutline(facingLeft);
      const start = outlinePath(card, animal, 0);
      const middle = outlinePath(card, animal, 0.5);
      const end = outlinePath(card, animal, 1);
      expect(start).toBe(outlinePath(card));
      expect(end).toBe(outlinePath(animal));
      expect(middle).not.toBe(start);
      expect(middle).not.toBe(end);
      for (const shape of [start, middle, end]) {
        expect(shape.match(/C/g)).toHaveLength(16);
        expect(shape.endsWith(" Z")).toBe(true);
        expect(shape).not.toMatch(/NaN|Infinity/);
      }
      // Both contours keep their winding, avoiding a pinched or inside-out transition.
      const winding = (shape: typeof card) => {
        const points = [
          shape.start,
          ...shape.curves.map((segment) => segment[2]),
        ];
        return Math.sign(
          points.reduce((area, p, i) => {
            const next = points[(i + 1) % points.length];
            return area + p.x * next.y - next.x * p.y;
          }, 0),
        );
      };
      expect(winding(card)).toBe(winding(animal));
    },
  );
});

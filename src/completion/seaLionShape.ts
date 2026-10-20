import type { Point } from "./swimGeometry";

type Cubic = [Point, Point, Point];
export interface Outline {
  start: Point;
  curves: Cubic[];
}
const point = (x: number, y: number): Point => ({ x, y });
const mix = (a: Point, b: Point, t: number): Point =>
  point(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
const smooth = (t: number) => t * t * (3 - 2 * t);

// Matching cubic segments let the card surface itself become the body.
export function cardOutline(
  width: number,
  height: number,
  facingLeft = false,
): Outline {
  const rx = Math.min((24 * 160) / Math.max(width, 1), 24);
  const ry = Math.min((24 * 100) / Math.max(height, 1), 24);
  const k = 0.5522847498;
  const vertices = [
    point(0, ry),
    point(rx, 0),
    point(160 - rx, 0),
    point(160, ry),
    point(160, 100 - ry),
    point(160 - rx, 100),
    point(rx, 100),
    point(0, 100 - ry),
  ];
  const segments: Cubic[] = [
    [point(0, ry * (1 - k)), point(rx * (1 - k), 0), vertices[1]],
    [vertices[1], vertices[2], vertices[2]],
    [point(160 - rx * (1 - k), 0), point(160, ry * (1 - k)), vertices[3]],
    [vertices[3], vertices[4], vertices[4]],
    [
      point(160, 100 - ry * (1 - k)),
      point(160 - rx * (1 - k), 100),
      vertices[5],
    ],
    [vertices[5], vertices[6], vertices[6]],
    [point(rx * (1 - k), 100), point(0, 100 - ry * (1 - k)), vertices[7]],
    [vertices[7], vertices[0], vertices[0]],
  ];
  const curves: Cubic[] = [];
  let from = vertices[0];
  for (const [a, b, end] of segments) {
    const ab = mix(from, a, 0.5),
      bc = mix(a, b, 0.5),
      cd = mix(b, end, 0.5);
    const left = mix(ab, bc, 0.5),
      right = mix(bc, cd, 0.5),
      center = mix(left, right, 0.5);
    curves.push([ab, left, center], [right, cd, end]);
    from = end;
  }
  const face = (p: Point) => (facingLeft ? point(160 - p.x, p.y) : p);
  return {
    start: face(vertices[0]),
    curves: curves.map((segment) => segment.map(face) as Cubic),
  };
}

export function seaLionOutline(facingLeft: boolean): Outline {
  const anchors = [
    [16, 55],
    [35, 43],
    [64, 37],
    [88, 44],
    [103, 35],
    [108, 19],
    [119, 12],
    [132, 16],
    [137, 25],
    [149, 29],
    [146, 35],
    [135, 39],
    [128, 58],
    [110, 70],
    [70, 73],
    [35, 68],
  ].map(([x, y]) => point(facingLeft ? 160 - x : x, y));
  return {
    start: anchors[0],
    curves: anchors.map((from, index) => {
      const previous = anchors[(index + anchors.length - 1) % anchors.length];
      const end = anchors[(index + 1) % anchors.length];
      const next = anchors[(index + 2) % anchors.length];
      return [
        point(
          from.x + (end.x - previous.x) / 6,
          from.y + (end.y - previous.y) / 6,
        ),
        point(end.x - (next.x - from.x) / 6, end.y - (next.y - from.y) / 6),
        end,
      ];
    }),
  };
}

export function outlinePath(from: Outline, to = from, progress = 0): string {
  const t = smooth(Math.max(0, Math.min(1, progress)));
  const coordinates = (a: Point, b: Point) => {
    const p = mix(a, b, t);
    return `${p.x.toFixed(3)} ${p.y.toFixed(3)}`;
  };
  return (
    `M${coordinates(from.start, to.start)} ` +
    from.curves
      .map(
        (segment, index) =>
          "C" +
          segment.map((p, j) => coordinates(p, to.curves[index][j])).join(" "),
      )
      .join(" ") +
    " Z"
  );
}

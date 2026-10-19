import type { RefObject } from "react";

export function SeaLion({
  body,
  features,
}: {
  body: RefObject<SVGPathElement | null>;
  features: RefObject<SVGGElement | null>;
}) {
  return (
    <svg
      className="completion-creature"
      viewBox="0 0 160 100"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <g className="sea-lion-features" ref={features}>
        <path
          className="sea-lion-far-fin"
          d="M111 49C124 51 135 63 137 72C129 74 115 65 106 56Z"
        />
        <path
          className="sea-lion-tail"
          d="M25 55C16 54 10 43 4 46C0 49 8 58 12 61C8 64 0 69 3 73C9 78 22 67 28 63Z"
        />
      </g>
      <path className="sea-lion-body" ref={body} />
      <g className="sea-lion-face-and-fin">
        <path
          className="sea-lion-near-fin"
          d="M104 55C99 66 83 82 66 87C60 89 59 85 64 80L94 54Z"
        />
        <path className="sea-lion-cheek" d="M117 27C116 39 110 46 101 51" />
        <circle className="sea-lion-eye" cx="131" cy="24" r="1.8" />
        <path className="sea-lion-whisker" d="m141 33 11 4m-12-1 10 6" />
      </g>
    </svg>
  );
}

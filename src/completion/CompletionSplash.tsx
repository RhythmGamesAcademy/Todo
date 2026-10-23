/** Small water droplets and a ring acknowledge the exact counter that received a task. */
export function CompletionSplash() {
  return (
    <svg className="completion-splash" viewBox="0 0 100 100" aria-hidden="true">
      <circle className="completion-splash-ring" cx="50" cy="50" r="15" />
      {Array.from({ length: 7 }, (_, index) => (
        <g key={index} transform={`rotate(${(index * 360) / 7} 50 50)`}>
          <path
            className="completion-splash-drop"
            d="M50 20Q43 29 50 32Q57 29 50 20Z"
          />
        </g>
      ))}
    </svg>
  );
}

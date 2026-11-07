/**
 * A thin line down the left with an arrowhead at the top: time runs upward,
 * newest first. Place it in a `relative` container with some left padding.
 */
export function TimeArrow() {
  return (
    <span aria-hidden className="absolute top-0 bottom-1 left-[3px] text-line-strong">
      <svg viewBox="0 0 7 5" className="absolute -top-px -left-[3px] h-[5px] w-[7px]" fill="none">
        <path d="M0.5 4.5 3.5 0.75 6.5 4.5" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
      </svg>
      <span className="absolute top-0.5 bottom-0 left-0 w-px bg-current" />
    </span>
  );
}

// Looks shared by the Decisions page. Buttons are dark with a faint tint (no
// solid accent colour), in the spirit of IcePanel; focus is white, like a
// selected box in the editor.

const button =
  "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-white/25 disabled:opacity-40";

/** The everyday button: a barely-there light tint. */
export const neutralButton = `${button} border-line-strong bg-white/[0.05] text-fg hover:bg-white/[0.09]`;

/** Moves a decision into force. */
export const acceptButton = `${button} border-emerald-400/25 bg-emerald-400/[0.08] text-emerald-200 hover:bg-emerald-400/[0.14]`;

/** Turns a decision down. */
export const rejectButton = `${button} border-rose-400/25 bg-rose-400/[0.08] text-rose-200 hover:bg-rose-400/[0.14]`;

/** A dialog's or form's main action (Create, Save): as quiet as the rest. */
export const primaryButton = neutralButton;

/** A plain bordered button. */
export const secondaryButton = `${button} border-line-strong text-fg hover:bg-surface-hover`;

export const quietButton =
  "inline-flex items-center gap-1.5 rounded-lg px-2 py-1 font-medium text-fg-muted outline-none hover:bg-surface-hover hover:text-fg focus-visible:ring-2 focus-visible:ring-white/25 disabled:opacity-40";

export const sectionLabel = "text-xs font-semibold tracking-wide text-fg-subtle uppercase";

const fieldBase =
  "w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-fg outline-none placeholder:text-fg-subtle";

/** A text field; white border when focused. */
export const field = `${fieldBase} focus:border-fg`;
/** A positive consequence: green when focused. */
export const positiveField = `${fieldBase} focus:border-emerald-400`;
/** A negative consequence: red when focused. */
export const negativeField = `${fieldBase} focus:border-rose-400`;

/** A search box (an icon and an input inside one bordered label). */
export const searchBox =
  "flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 focus-within:border-fg";

/** Scrolls on its own, with a thin dark scrollbar shown only when needed. */
export const scrollArea = "min-h-0 overflow-y-auto scroll-thin";

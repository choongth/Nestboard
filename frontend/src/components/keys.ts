/** On Apple devices shortcuts use ⌘ rather than Ctrl. */
export const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** The modifier key label for shortcuts: "⌘" on Apple devices, "Ctrl+" elsewhere. */
export const MOD = IS_MAC ? "⌘" : "Ctrl+";

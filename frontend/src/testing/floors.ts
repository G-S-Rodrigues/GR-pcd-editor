// Test-only (part 22-4b). Nothing in the app imports this file.
/** The contrast floors on the light stage (R22-14). Set from the ruling and never lowered later; the dark theme keeps its own (4.5 for arrows: UI-906, UI-1085). */
export const LIGHT_FLOORS = { points: 3, arrows: 3, rings: 3, outlines: 3, triadLetters: 4.5 } as const;

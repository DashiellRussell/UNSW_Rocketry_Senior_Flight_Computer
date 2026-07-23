/** Descriptor `accent` hint -> concrete colour. Mirrors js/ui.js ACCENTS. */
const ACCENTS: Record<string, string> = {
  cyan: "#3fd7ff",
  blue: "#5b8cff",
  green: "#4ade80",
  red: "#f87171",
  yellow: "#fbbf24",
  amber: "#ffb454",
  magenta: "#e879f9",
  orange: "#fb923c",
  white: "#e2e8f0",
};

export function accentColor(name?: string): string {
  return (name && ACCENTS[name]) || ACCENTS.cyan;
}

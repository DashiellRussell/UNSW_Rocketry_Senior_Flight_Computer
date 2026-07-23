/**
 * lib/builder/defaultState.ts — starting descriptor so the /builder page
 * isn't an empty canvas on first load: a minimal board (name + two checks +
 * two graphs + one action). Loaded once, then persisted to localStorage.
 */
import type { BuilderBlock } from "./types";
import { uid } from "./types";

export function defaultBlocks(): BuilderBlock[] {
  return [
    {
      uid: uid(),
      kind: "meta",
      data: { name: "MY BOARD", sub: "a new fcd/1 board — built with the FCD builder", fw: "0.1.0", accent: "cyan" },
    },
    { uid: uid(), kind: "check", data: { id: "power", label: "Power", check: "pg" } },
    { uid: uid(), kind: "check", data: { id: "sd", label: "SD card", check: "sd_ok" } },
    { uid: uid(), kind: "rail", data: { id: "vbat", label: "Main batt", min: 6.4, max: 8.4, nom: 7.4 } },
    { uid: uid(), kind: "graph", data: { id: "alt_m", label: "Altitude", unit: "m" } },
    { uid: uid(), kind: "graph", data: { id: "vel_ms", label: "Vertical vel", unit: "m/s" } },
    { uid: uid(), kind: "action", data: { id: "identify", label: "Identify (blink+beep)" } },
  ];
}

export const BUILDER_STORAGE_KEY = "ozone-fcd-builder-v1";

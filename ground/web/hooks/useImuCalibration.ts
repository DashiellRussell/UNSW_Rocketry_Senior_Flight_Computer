"use client";

/**
 * useImuCalibration — persists the orientation-wizard result (a signed axis
 * map + the flight-axis label) in localStorage, keyed by board name, and
 * merges it over the descriptor's own `imu` block client-side so
 * OrientationView renders correctly immediately after calibrating, without
 * needing the firmware to change (the wizard's whole point is producing a
 * snippet to paste into firmware LATER — this override is what makes the
 * viewer correct RIGHT NOW).
 */
import { useCallback, useEffect, useState } from "react";
import type { ImuSpec } from "@/lib/types";
import { IDENTITY_MAP, type AxisMap } from "@/lib/orientation";

export interface ImuCalibration {
  map: AxisMap;
  up: ImuSpec["up"];
  calibratedAt: string; // ISO timestamp, shown in the wizard/snippet
}

function storageKey(boardName: string): string {
  return `ozone-imu-calibration:${boardName || "default"}`;
}

export function useImuCalibration(imu: ImuSpec | null, boardName: string) {
  // Server render and the first client render must agree (both null) — this
  // is only ever read from localStorage after mount, same mounted-guard
  // pattern used elsewhere in this app.
  const [calibration, setCalibration] = useState<ImuCalibration | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(storageKey(boardName));
      setCalibration(raw ? (JSON.parse(raw) as ImuCalibration) : null);
    } catch {
      setCalibration(null);
    }
  }, [boardName]);

  const save = useCallback(
    (cal: ImuCalibration) => {
      setCalibration(cal);
      try {
        window.localStorage.setItem(storageKey(boardName), JSON.stringify(cal));
      } catch {
        /* localStorage unavailable (private browsing, quota, …) — calibration still applies live this session */
      }
    },
    [boardName]
  );

  const clear = useCallback(() => {
    setCalibration(null);
    try {
      window.localStorage.removeItem(storageKey(boardName));
    } catch {
      /* noop */
    }
  }, [boardName]);

  const effectiveImu: ImuSpec = imu
    ? { ...imu, map: calibration?.map || imu.map || IDENTITY_MAP, up: calibration?.up || imu.up }
    : { accel: ["lo_gx", "lo_gy", "lo_gz"], map: IDENTITY_MAP, up: "+z" };

  return { calibration, effectiveImu, save, clear };
}

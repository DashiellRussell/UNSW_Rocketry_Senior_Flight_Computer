"use client";

/**
 * PyroPanel — arm/disarm plus the operator-side handshake for all four
 * pyro_trigger.h fire modes (safe/session/hot/direct). Ported from
 * firmware/tools/web-dashboard/js/pyro.js.
 *
 * Reconciled per task brief: SESSION mode is driven by `do flight_mode
 * [key=]` (not `session_key`) — see docs/fcd-protocol.md §7 Mode B.
 *
 * The board is always the sole safety authority (external key switch +
 * armed + continuity + the fire_mode handshake itself). This panel only
 * adds an operator-side guard on top: typed FIRE/ARM/FLIGHT confirmation,
 * red danger styling, and hold-to-fire for `direct` mode.
 */
import { useEffect, useMemo, useState } from "react";
import type { Profile } from "@/lib/types";
import type { TlmFrame } from "@/lib/types";
import { ConfirmModal } from "./ConfirmModal";
import { useToast } from "./Toast";
import { HazardFrame } from "./HazardFrame";
import { extractFields } from "@/lib/fcd";

export interface PyroApi {
  doAction: (id: string, args: Record<string, unknown>) => Promise<string>;
  setParam: (id: string, value: string) => Promise<string>;
}

interface PendingConfirm {
  title: string;
  body?: string;
  token: string;
  onConfirm: () => void;
}

function useNow(tickMs: number, active: boolean) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((t) => t + 1), tickMs);
    return () => clearInterval(id);
  }, [tickMs, active]);
}

export function PyroPanel({ profile, lastTlm, api }: { profile: Profile; lastTlm: TlmFrame; api: PyroApi }) {
  const channels = Math.max(0, Number(profile.caps.pyro || 0));
  const fireModeParam = profile.params.find((p) => p.id === "fire_mode");
  const [mode, setMode] = useState<string>(fireModeParam ? String(fireModeParam.value) : "direct");
  const [primeToken, setPrimeToken] = useState<Record<number, { token: string; expiresAt: number }>>({});
  const [sessionKey, setSessionKey] = useState<string | null>(null);
  const [sessionKeyInput, setSessionKeyInput] = useState("");
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);
  const toast = useToast();

  const armed = !!lastTlm.armed;
  const hasPrimeActive = Object.keys(primeToken).length > 0;
  useNow(1000, hasPrimeActive);

  useEffect(() => {
    if (fireModeParam) setMode(String(fireModeParam.value));
  }, [fireModeParam?.value]); // eslint-disable-line react-hooks/exhaustive-deps

  const changeMode = async (next: string) => {
    const reply = await api.setParam("fire_mode", next);
    if (reply.startsWith("PARAM")) {
      setMode(next);
      setPrimeToken({});
      setSessionKey(null);
    }
    toast.show(reply);
  };

  const toggleArm = () => {
    if (armed) {
      api.doAction("disarm", {}).then((r) => toast.show(r));
    } else {
      setConfirm({
        title: "Arm pyros",
        token: "ARM",
        body: "External key switch must also be closed — software cannot fire without it.",
        onConfirm: () => api.doAction("arm", {}).then((r) => toast.show(r)),
      });
    }
  };

  if (channels === 0) {
    return (
      <div className="glass rounded-[10px] p-3">
        <h2 className="mb-2 font-display text-[12px] tracking-wide text-ink-dim label-caps">Pyro control</h2>
        <p className="text-[12px] text-ink-faint">Board has no pyro channels (caps.pyro=0).</p>
      </div>
    );
  }

  return (
    <HazardFrame variant={armed ? "red" : "amber"} innerClassName="glass p-3">
      <div
        className={`mb-2.5 flex flex-wrap items-center gap-2.5 rounded-[6px] px-2.5 py-2 ${
          armed ? "danger-box armed-glow" : "border border-hairline"
        }`}
      >
        <h2 className="font-display text-[12px] tracking-wide label-caps text-ink-dim">Pyro control</h2>
        <span className={`text-[11px] font-bold tracking-widest label-caps ${armed ? "" : "text-ink-faint"}`}>
          {armed ? "● ARMED" : "SAFE"}
        </span>
        <button
          onClick={toggleArm}
          className={`btn-physical rounded-[6px] px-3 py-1 text-[11px] font-bold tracking-wide label-caps ${
            armed ? "btn-physical-danger" : "btn-physical-accent"
          }`}
        >
          {armed ? "Disarm" : "Arm pyros"}
        </button>

        <div className="ml-auto flex items-center gap-2 text-[12px] text-ink-dim">
          {fireModeParam?.values ? (
            <>
              <span className="label-caps text-ink-faint">fire_mode</span>
              <select
                value={mode}
                onChange={(e) => changeMode(e.target.value)}
                className="rounded border border-hairline-bright bg-bg-inset px-2 py-1 text-[12px] text-ink outline-none focus:border-cyan"
              >
                {fireModeParam.values.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </>
          ) : (
            <span className="text-ink-faint">fire_mode: {mode} (read-only)</span>
          )}
        </div>
      </div>

      {mode === "session" && (
        <div className="frost mb-3 flex flex-wrap items-center gap-2.5 px-3.5 py-3">
          <span className="text-[12px] text-ink-dim">Flight pyro key:</span>
          <span className="font-display text-[13px] tabular text-ink">{sessionKey ?? "(not set)"}</span>
          <input
            value={sessionKeyInput}
            onChange={(e) => setSessionKeyInput(e.target.value)}
            placeholder="blank = board rolls one"
            className="w-44 rounded border border-hairline-bright bg-bg-panel px-2 py-1 text-[12px] tabular text-ink outline-none focus:border-cyan"
          />
          <button
            onClick={() =>
              setConfirm({
                title: "Enter flight mode",
                token: "FLIGHT",
                body: "Arms the board and — in session mode — sets the flight-long pyro key for every fire this flight.",
                onConfirm: async () => {
                  const args = sessionKeyInput.trim() ? { key: sessionKeyInput.trim() } : {};
                  const reply = await api.doAction("flight_mode", args);
                  const f = extractFields(reply);
                  if (f.key) setSessionKey(f.key);
                  toast.show(reply);
                },
              })
            }
            className="btn-physical btn-physical-danger rounded-[6px] px-3 py-1.5 text-[11px] font-bold label-caps"
          >
            Enter flight mode / set key
          </button>
        </div>
      )}

      {/* Fixed 6-slot grid regardless of caps.pyro — a real board with 2
          channels still shows all 6 slots (4 greyed placeholders) so the
          panel reads as a dense, purpose-built instrument rather than two
          cards floating in a lot of empty space. If caps.pyro were 6, every
          slot is a live channel. One row of 6 real squares (aspect-square) —
          on narrow viewports the row scrolls horizontally rather than
          wrapping or squishing the squares out of shape. */}
      <div className="-mx-0.5 overflow-x-auto px-0.5 pb-1">
        <div className="grid min-w-[560px] grid-cols-6 gap-2">
          {Array.from({ length: 6 }, (_, i) => i + 1).map((ch) =>
            ch > channels ? (
              <PyroChannelPlaceholder key={ch} ch={ch} />
          ) : (
            <PyroChannelCard
              key={ch}
              ch={ch}
              mode={mode}
              armed={armed}
              lastTlm={lastTlm}
              sessionKey={sessionKey}
              primeToken={primeToken[ch]}
              onPrime={async () => {
                const reply = await api.doAction("prime", { ch });
                const f = extractFields(reply);
                if (f.token) {
                  const windowS = f.window ? Number(f.window.replace(/[^\d.]/g, "")) : 10;
                  setPrimeToken((s) => ({ ...s, [ch]: { token: f.token, expiresAt: Date.now() + windowS * 1000 } }));
                } else {
                  toast.show(reply);
                }
              }}
              onDeployReady={async () => {
                const reply = await api.doAction("deploy_ready", { ch });
                toast.show(reply);
              }}
              onFire={(title, body, token) =>
                setConfirm({
                  title,
                  body,
                  token,
                  onConfirm: async () => {
                    let fireArgs: Record<string, unknown> = { ch };
                    if (mode === "safe") fireArgs = { ch, token: primeToken[ch]?.token };
                    else if (mode === "session") fireArgs = { ch, token: sessionKey };
                    else if (mode === "hot") fireArgs = { ch, token: Number(lastTlm[`dtok${ch}`] ?? 0) };
                    const reply = await api.doAction("fire", fireArgs);
                    toast.show(reply);
                    if (mode === "safe")
                      setPrimeToken((s) => {
                        const next = { ...s };
                        delete next[ch];
                        return next;
                      });
                  },
                })
              }
              onDirectFire={async () => {
                const reply = await api.doAction("fire", { ch });
                toast.show(reply);
              }}
            />
            )
          )}
        </div>
      </div>

      {confirm && (
        <ConfirmModal
          title={confirm.title}
          body={confirm.body}
          token={confirm.token}
          danger
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            confirm.onConfirm();
            setConfirm(null);
          }}
        />
      )}
    </HazardFrame>
  );
}

/** An inactive slot in the fixed 6-channel grid — the board only declared
 *  `caps.pyro` real channels, so the rest render as greyed, disabled,
 *  clearly-not-wired placeholders rather than being omitted (which would
 *  leave the grid looking sparse/unbalanced). */
function PyroChannelPlaceholder({ ch }: { ch: number }) {
  return (
    <div className="frost aspect-square flex flex-col items-center justify-center gap-1 p-3 opacity-40">
      <span className="font-display text-[12px] tracking-wide text-ink-faint">CH {ch}</span>
      <span className="label-caps text-[9px] text-ink-faint">not present</span>
      <span className="mt-1 text-[16px] text-ink-faint">—</span>
    </div>
  );
}

function PyroChannelCard({
  ch,
  mode,
  armed,
  lastTlm,
  sessionKey,
  primeToken,
  onPrime,
  onDeployReady,
  onFire,
  onDirectFire,
}: {
  ch: number;
  mode: string;
  armed: boolean;
  lastTlm: TlmFrame;
  sessionKey: string | null;
  primeToken?: { token: string; expiresAt: number };
  onPrime: () => void;
  onDeployReady: () => void;
  onFire: (title: string, body: string, token: string) => void;
  onDirectFire: () => void;
}) {
  const contKey = `cont${ch}`;
  const cont = contKey in lastTlm ? !!lastTlm[contKey] : null;
  const dtok = Number(lastTlm[`dtok${ch}`] ?? 0);
  const canFire = armed && cont === true;

  useNow(1000, !!primeToken);

  return (
    <div className="frost aspect-square flex flex-col gap-2 overflow-y-auto p-2.5">
      <div className="flex items-center justify-between">
        <span className="font-display text-[12px] tracking-wide text-ink">CH {ch}</span>
        <span
          className={`pill px-2.5 py-0.5 text-[10px] font-bold tracking-wider label-caps ${
            cont === null ? "" : cont ? "border-green/40 bg-green/10 !text-green" : "border-red-dim bg-red/10 !text-red"
          }`}
        >
          {cont === null ? "—" : cont ? "CONT" : "OPEN"}
        </span>
      </div>

      {!canFire && (
        <p className="text-[11px] text-amber">{!armed ? "blocked — arm first" : "blocked — no continuity"}</p>
      )}

      {mode === "safe" && (
        <div className="flex flex-col gap-2">
          <button
            onClick={onPrime}
            disabled={!canFire}
            className="self-start rounded border border-hairline-bright px-3 py-1.5 text-[12px] text-ink-dim transition hover:border-cyan-dim hover:text-cyan disabled:opacity-35"
          >
            {primeToken ? "re-prime" : "Prime"}
          </button>
          {primeToken && (
            <>
              <div className="rounded border border-cyan-dim bg-cyan/10 px-2.5 py-1.5 text-[12px] tabular text-cyan">
                token {primeToken.token} · {Math.max(0, Math.round((primeToken.expiresAt - Date.now()) / 1000))}s
              </div>
              <button
                disabled={primeToken.expiresAt <= Date.now()}
                onClick={() => onFire(`Fire channel ${ch}`, `Uses one-shot token ${primeToken.token} from the prime step.`, "FIRE")}
                className="btn-physical btn-physical-danger self-start rounded-[6px] px-3 py-1.5 text-[12px] font-bold tracking-wide label-caps"
              >
                FIRE
              </button>
            </>
          )}
        </div>
      )}

      {mode === "session" && (
        <div className="flex flex-col gap-2">
          <button
            disabled={!canFire || sessionKey == null}
            onClick={() => onFire(`Fire channel ${ch}`, `Uses the session flight key (${sessionKey}).`, "FIRE")}
            className="btn-physical btn-physical-danger self-start rounded-[6px] px-3.5 py-1.5 text-[12px] font-bold tracking-wide label-caps"
          >
            FIRE
          </button>
          {sessionKey == null && <p className="text-[11px] text-ink-faint">set the flight key above first</p>}
        </div>
      )}

      {mode === "hot" && (
        <div className="flex flex-col gap-2">
          <button
            onClick={onDeployReady}
            disabled={!canFire || dtok > 0}
            className="self-start rounded border border-hairline-bright px-3 py-1.5 text-[12px] text-ink-dim transition hover:border-amber-dim hover:text-amber disabled:opacity-35"
          >
            {dtok > 0 ? "deploy-ready ✓" : "Deploy-ready"}
          </button>
          {dtok > 0 && (
            <>
              <div className="rounded border border-amber-dim bg-amber/10 px-2.5 py-1.5 text-[12px] tabular text-amber">
                live token {dtok}
              </div>
              <button
                onClick={() => onFire(`Fire channel ${ch} — HOT`, `Auto-fills the current rolling token (${dtok}). One guarded keypress for an in-flight emergency.`, "FIRE")}
                className="btn-physical btn-physical-danger rounded-[6px] px-3.5 py-1.5 text-[12px] font-bold tracking-wide label-caps"
              >
                FIRE (armed hotkey)
              </button>
            </>
          )}
        </div>
      )}

      {mode === "direct" && <HoldToFireButton disabled={!canFire} onFire={onDirectFire} />}
    </div>
  );
}

function HoldToFireButton({ disabled, onFire }: { disabled: boolean; onFire: () => void }) {
  const [pct, setPct] = useState(0);
  const [holding, setHolding] = useState(false);
  const [covered, setCovered] = useState(true);
  const HOLD_MS = 1400;

  useEffect(() => {
    if (!holding) return;
    const start = Date.now();
    const id = setInterval(() => {
      const p = Math.min(100, ((Date.now() - start) / HOLD_MS) * 100);
      setPct(p);
      if (p >= 100) {
        clearInterval(id);
        setHolding(false);
        setPct(0);
        setCovered(true);
        onFire();
      }
    }, 30);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holding]);

  const cancel = () => {
    setHolding(false);
    setPct(0);
  };

  // Guarded physical control: a striped "safety cover" must be lifted before
  // the hold-to-fire surface is even clickable — mirrors a real flip-up-
  // cover pyro switch. No token in `direct` mode, so this is the ONLY
  // operator-side guard against a stray click.
  if (covered) {
    return (
      <div className="flex flex-col gap-1.5">
        <button
          disabled={disabled}
          onClick={() => setCovered(false)}
          className="danger-box hazard-stripes btn-physical w-full rounded-[6px] px-3.5 py-2.5 text-[11px] font-bold tracking-widest label-caps disabled:opacity-40"
        >
          ▲ Lift safety cover
        </button>
        <p className="text-[10px] text-ink-faint">direct mode — no token; hold ~1.4s to fire once uncovered</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button
        disabled={disabled}
        onPointerDown={() => !disabled && setHolding(true)}
        onPointerUp={cancel}
        onPointerLeave={cancel}
        className="btn-physical btn-physical-danger relative overflow-hidden rounded-[6px] px-3.5 py-3 text-[12px] font-bold tracking-wide label-caps"
      >
        <span
          className="absolute inset-y-0 left-0 bg-white/15"
          style={{ width: `${pct}%`, transition: holding ? "none" : "width 120ms ease-out" }}
        />
        <span className="relative">HOLD TO FIRE</span>
      </button>
      <div className="flex items-center justify-between">
        <p className="text-[10px] text-ink-faint">hold ~1.4s to fire</p>
        <button onClick={() => setCovered(true)} className="pill px-2 py-0.5 text-[9px] label-caps hover:!text-amber">
          re-cover
        </button>
      </div>
    </div>
  );
}

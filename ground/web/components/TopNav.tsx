"use client";

/**
 * TopNav — the Risley-style glass top nav, OZONE-branded. Rendered once in
 * the root layout (app/layout.tsx) so it's shared, sticky, and identical on
 * every route. Folds in what used to be ConnectBar.tsx: brand + page nav on
 * the left/centre, the whole connection cluster (status, transport picker,
 * connect/disconnect) on the right.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { StatusClass, TransportKind } from "@/hooks/useFcdConnection";
import { useFcdConnectionContext } from "@/hooks/FcdConnectionProvider";
import { useToast } from "./Toast";

function RocketMark() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
      <path
        d="M12 2c2.8 2.2 4.2 5.6 4.2 9.4 0 2-.5 3.9-1.4 5.6l-1.2-1.1c.6-1.4.9-2.9.9-4.5 0-3-.9-5.6-2.5-7.4-1.6 1.8-2.5 4.4-2.5 7.4 0 1.6.3 3.1.9 4.5l-1.2 1.1c-.9-1.7-1.4-3.6-1.4-5.6C7.8 7.6 9.2 4.2 12 2Z"
        fill="currentColor"
      />
      <circle cx="12" cy="10.6" r="1.4" fill="var(--color-bg)" />
      <path d="M7.6 15.4 5 20l4.3-1.8-1.7-2.8ZM16.4 15.4 19 20l-4.3-1.8 1.7-2.8Z" fill="currentColor" />
      <path d="M10.3 18.2h3.4L12 22l-1.7-3.8Z" fill="currentColor" opacity="0.7" />
    </svg>
  );
}

const DOT_COLOR: Record<"board" | "sim" | "searching" | "off", string> = {
  board: "bg-green",
  sim: "bg-cyan",
  searching: "bg-amber",
  off: "bg-ink-faint",
};

function deriveDot(connected: boolean, isSim: boolean, statusCls: StatusClass): "board" | "sim" | "searching" | "off" {
  if (statusCls === "connecting") return "searching";
  if (connected && isSim) return "sim";
  if (connected) return "board";
  return "off";
}

export function TopNav() {
  const pathname = usePathname();
  const fcd = useFcdConnectionContext();
  const {
    connected,
    status,
    isSim,
    serialAvailable,
    transportLabel,
    connect,
    disconnect,
    identify,
  } = fcd;
  const toast = useToast();

  const [popoverOpen, setPopoverOpen] = useState(false);
  const [kind, setKind] = useState<TransportKind>("serial");
  const [baud, setBaud] = useState(115200);
  const [wsUrl, setWsUrl] = useState("ws://192.168.4.1:81");
  const [busy, setBusy] = useState(false);
  const [identifying, setIdentifying] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!popoverOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) setPopoverOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [popoverOpen]);

  const doConnect = async (k: TransportKind, opts: { baud?: number; wsUrl?: string } = {}) => {
    setBusy(true);
    try {
      await connect(k, opts);
      setPopoverOpen(false);
    } catch {
      /* status text already reflects the failure */
    } finally {
      setBusy(false);
    }
  };

  const dot = deriveDot(connected, isSim, status.cls);
  const showConnectBoard = serialAvailable && (!connected || isSim);

  // "Identify": re-sends whoami (refreshes name/fw/protocol version shown in
  // the board header) AND fires `do identify` so the physical board blinks
  // + chirps — works against the simulator too (it just logs + ACKs).
  const doIdentify = async () => {
    setIdentifying(true);
    try {
      const result = await identify();
      toast.show(`IDENTIFY — ${result}`);
    } finally {
      setIdentifying(false);
    }
  };

  const navLink = (href: string, label: string) => {
    const active = pathname === href;
    return (
      <Link
        href={href}
        className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-wide transition ${
          active ? "border-cyan/40 bg-cyan/15 text-cyan" : "border-hairline-bright text-ink-dim hover:text-ink"
        }`}
      >
        {label}
      </Link>
    );
  };

  return (
    <header className="glass-header sticky top-0 z-40">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-2 px-4 py-2">
        {/* brand */}
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded border border-cyan-dim bg-cyan/10 text-cyan">
            <RocketMark />
          </span>
          <div className="leading-tight">
            <div className="font-display text-[12px] font-semibold tracking-[0.12em] text-ink">PROJECT OZONE</div>
            <div className="label-caps text-[9px] text-ink-faint">ground station</div>
          </div>
        </div>

        {/* page nav */}
        <nav className="flex items-center gap-1.5">
          {navLink("/", "Console")}
          {navLink("/protocol", "Protocol")}
          {navLink("/builder", "Builder")}
        </nav>

        {/* connection cluster */}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {isSim && connected && (
            <span className="pill px-2 py-1 text-[10px] font-semibold !text-amber label-caps">simulated</span>
          )}

          {showConnectBoard && (
            <button
              onClick={() => doConnect("serial", { baud: 115200 })}
              disabled={busy}
              className="pill px-2.5 py-1 text-[11px] font-medium hover:border-cyan-dim hover:!text-cyan disabled:opacity-50"
            >
              Connect board
            </button>
          )}

          {connected && (
            <button
              onClick={doIdentify}
              disabled={identifying}
              title="Re-check whoami + blink/beep the board"
              className="pill flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium hover:border-cyan-dim hover:!text-cyan disabled:opacity-70"
            >
              <span className={`h-1.5 w-1.5 rounded-full ${identifying ? "bg-cyan pulse" : "bg-ink-faint"}`} />
              {identifying ? "Identifying…" : "Identify"}
            </button>
          )}

          <div className="relative" ref={popoverRef}>
            <button
              onClick={() => setPopoverOpen((v) => !v)}
              className="pill flex items-center gap-1.5 px-2.5 py-1 text-[11px]"
              aria-expanded={popoverOpen}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${DOT_COLOR[dot]} ${dot === "searching" ? "pulse" : ""}`} />
              <span className="tabular">{status.text}</span>
              <span className="text-ink-faint">▾</span>
            </button>

            {popoverOpen && (
              <div className="glass rise-in absolute right-0 top-[calc(100%+8px)] w-72 rounded-[10px] p-4">
                <div className="mb-3 label-caps text-[10px] text-ink-faint">Link</div>
                <div className="mb-3 flex gap-1.5">
                  {(["serial", "ws", "sim"] as TransportKind[]).map((k) => (
                    <button
                      key={k}
                      onClick={() => setKind(k)}
                      disabled={k === "serial" && !serialAvailable}
                      className={`flex-1 rounded-full px-2 py-1 text-[11px] font-semibold transition disabled:opacity-30 ${
                        kind === k ? "bg-cyan text-[#031820]" : "border border-panel-edge text-ink-dim hover:text-ink"
                      }`}
                    >
                      {k === "serial" ? "USB" : k === "ws" ? "WiFi" : "Sim"}
                    </button>
                  ))}
                </div>

                {kind === "ws" && (
                  <input
                    value={wsUrl}
                    onChange={(e) => setWsUrl(e.target.value)}
                    placeholder="ws://192.168.4.1:81"
                    className="frost mb-3 w-full px-2.5 py-1.5 text-[12px] text-ink outline-none focus:border-cyan"
                  />
                )}
                {kind === "serial" && (
                  <label className="mb-3 flex items-center gap-2 text-[11px] text-ink-dim">
                    <span className="label-caps shrink-0">Baud</span>
                    <input
                      type="number"
                      value={baud}
                      onChange={(e) => setBaud(Number(e.target.value) || 115200)}
                      className="frost w-full px-2.5 py-1.5 text-[12px] tabular text-ink outline-none focus:border-cyan"
                    />
                  </label>
                )}

                {!serialAvailable && kind === "serial" && (
                  <p className="mb-3 text-[11px] text-amber">
                    Web Serial isn&apos;t available in this browser — try Chrome or Edge.
                  </p>
                )}

                <div className="flex items-center justify-between gap-2">
                  {connected ? (
                    <button
                      onClick={() => {
                        disconnect();
                        setPopoverOpen(false);
                      }}
                      className="pill px-3 py-1.5 text-[12px] hover:border-red-dim hover:!text-red"
                    >
                      Disconnect
                    </button>
                  ) : (
                    <button
                      onClick={() => doConnect(kind, { baud, wsUrl })}
                      disabled={busy || (kind === "serial" && !serialAvailable)}
                      className="rounded-full bg-cyan px-3.5 py-1.5 text-[12px] font-semibold tracking-wide text-[#031820] transition hover:brightness-110 disabled:opacity-50"
                    >
                      {busy ? "Connecting…" : "Connect"}
                    </button>
                  )}
                  <span className="truncate text-[10px] text-ink-faint tabular">{transportLabel}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

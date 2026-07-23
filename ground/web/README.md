# OZONE Ground Station (web)

A Next.js ground station for any `fcd/1` flight computer — a modern,
mission-control-styled replacement for the vanilla-JS dashboard in
`firmware/tools/web-dashboard/`. It **speaks plain FCD**
(`docs/fcd-protocol.md`), so it works unmodified against:

- the STM32 board directly, over USB-CDC / a UART adapter — **Web Serial**, or
- the ESP32 telecom hub over WiFi — **WebSocket**, or
- its own built-in **simulator**, with no hardware at all.

Nothing here is OZONE-specific. On connect it sends `whoami`, parses the
`FCD1 {json}` descriptor the board replies with, and builds the entire UI —
one graph per `graphs[]`, one bar per `rails[]`, one row per `checks[]`, one
control per `actions[]`, one field per `params[]` — from that JSON.

## Stack

- **Next.js 16.2** (App Router, Turbopack), static export (`output: "export"`)
  — this is a pure client app (Web Serial / WebSocket / an in-memory
  simulator are all browser APIs), so there's no server component doing
  anything interesting; everything that touches a live link is `'use client'`.
- **React 19**, **TypeScript 5.9** (strict).
- **Tailwind CSS v4** (CSS-first config via `@theme` in `app/globals.css`,
  no `tailwind.config.js` needed).
- **pnpm**.
- Fonts: `Aldrich` (display/headings) + `JetBrains Mono` (everything else —
  labels, data, log), loaded via `next/font/google`.
- **Glassmorphism chrome**: every panel is a frosted `.glass`/`.surface` card
  (real `backdrop-filter: blur()+saturate()`) floating over a full-bleed
  `<canvas>` (`components/Backdrop.tsx`) painting slow-drifting, very-low-
  alpha cyan/amber blobs — same recipe as Spiral Blue's Risley console,
  reskinned onto OZONE's own cyan/amber/red/green palette. Nested content
  (graph cards, rail rows, log pane, param rows, prompt code block) uses
  `.frost` instead of `.glass`, since a `backdrop-filter` silently no-ops
  nested inside an already-blurred ancestor — see the comment block above
  `.glass`/`.frost` in `app/globals.css`.
- Charts: a small dependency-free canvas renderer (`lib/chart.ts`, ported
  from the vanilla dashboard's `chart.js`) rather than a charting library —
  full control over the look, and graph updates never touch React state (see
  **Architecture** below), so they stay smooth at telemetry rate.

## Run it

```bash
cd ground/web
pnpm install
pnpm dev        # http://localhost:3000
```

Other scripts:

```bash
pnpm build      # production build + static export to out/
pnpm start      # serve the .next build (non-static mode) — for local testing
pnpm typecheck  # tsc --noEmit
```

No hardware on you? Just hit **Connect** with **Built-in simulator**
selected (the default) — it runs a small deterministic flight model (boost →
coast → apogee → descent → landed) through the exact same FCD parsing path
as a real board, so every panel (checks, rails, graphs, log, and all four
pyro fire modes) can be demoed cold. A **SIMULATED** badge appears in the
connect bar whenever it's driving the UI.

## Deploying

Static output (`next.config.ts` sets `output: "export"`), so it's a plain
static site — deploy the `out/` directory anywhere, or just point Vercel at
this directory (`ground/web`) with the default Next.js build command; no
environment variables or backend services are required. Web Serial requires
a secure context (`https://` or `http://localhost`), which Vercel's preview/
prod URLs satisfy automatically.

## Connecting

**Auto-detect (Web Serial only).** On load, the console silently checks
`navigator.serial.getPorts()` for a port this origin was already granted
access to (from a previous manual "Connect board" click) — preferring one
that matches OZONE's USB-CDC identity (VID `0x0483` / PID `0x5740`, an
STM32 "Virtual ComPort"), else any granted port. If found, it reopens it
with **no click and no picker** and runs the FCD handshake straight away.
It also listens for `navigator.serial`'s `connect`/`disconnect` hotplug
events, so plugging the board in later (once a port has been granted once)
auto-connects, and unplugging it tears the link down cleanly and falls back
to the simulator instead of just going dead. Browsers block the native port
picker without a user gesture, so **the very first-ever authorization is
always one manual click** — after that, auto-detect takes over.

If no authorized port is found (or Web Serial isn't supported in this
browser at all), the console falls back to the **built-in simulator**
automatically — you land on a live, fully-populated dashboard immediately,
no hardware required, with a `simulated` badge in the top nav.

The connection cluster lives in the top nav (top-right): a status pill
(green dot = a real board, cyan = simulator, amber/pulsing = searching,
grey = disconnected) doubles as a popover trigger — click it to pick a
different transport:

- **USB** (Web Serial) — a "Connect board" quick-button also appears
  whenever the console isn't already on a real board; both it and the
  popover's Connect button call `requestPort()` pre-filtered to OZONE's
  VID/PID, so the native picker only lists the board (or nothing, if it's
  not plugged in). Chrome/Edge only — the option is disabled elsewhere
  (WebSocket + simulator still work everywhere).
- **WiFi** (WebSocket, ESP32 telecom hub) — enter the hub's URL, e.g.
  `ws://192.168.4.1:81`. The hub is expected to bridge the WebSocket 1:1 to
  the board's UART, forwarding the exact same `fcd/1` text lines both ways.
- **Sim** (built-in simulator) — no fields needed, just Connect.

On any connect, the console sends `whoami` and waits up to 1.5&nbsp;s for a
line starting `FCD1 `. If nothing arrives (a non-conforming or not-yet-
flashed board), it falls back to a generic empty profile — you still get raw
`TLM`/`LOG` line parsing, just no checks/rails/graphs/params/actions until
firmware declares them. A banner on the dashboard flags that fallback state.

If the board re-announces itself later (reboot, mode change) — any `FCD1 `
line seen mid-session rebuilds the whole UI again, same as the initial
handshake.

## Routes

Both routes share one sticky top nav (`components/TopNav.tsx`, mounted once
in `app/layout.tsx`) — brand + Console/Protocol pills on the left, the
connection cluster on the right — so it's identical wherever you are.

- `/` — the ground station (waiting screen → live dashboard).
- `/protocol` — a spec hub: the full `fcd/1` protocol doc rendered from
  markdown, plus a copy-pastable "implement FCD on your board" prompt
  (ESP32/STM32 toggle). Reachable via the **Protocol** pill in the top nav;
  the **Console** pill goes back.

## File layout

```
ground/web/
├── app/
│   ├── layout.tsx        fonts, metadata, backdrop/noise overlays, mounts
│   │                     FcdConnectionProvider + TopNav once for every route
│   ├── page.tsx          console: waiting screen / live dashboard
│   ├── protocol/page.tsx  spec hub: Server Component, reads content/*.md at build time
│   └── globals.css       Tailwind v4 @theme tokens + the mission-control chrome
├── content/               markdown vendored 1:1 from ../../docs/ (source of truth lives there;
│   ├── fcd-protocol.md            re-copy here if the source docs change)
│   └── fcd-implementer-prompts.md
├── hooks/
│   ├── FcdConnectionProvider.tsx  lifts one useFcdConnection() instance above both
│   │                              TopNav (in the layout) and the page content, so they
│   │                              share a single live transport instead of racing
│   └── useFcdConnection.ts   app glue: connect flow, handshake, line routing,
│                              command dispatch + reply correlation (ported
│                              from js/main.js's App class)
├── lib/                  framework-agnostic protocol/transport modules
│   ├── types.ts           Descriptor/Profile/Check/Rail/Graph/Param/Action types
│   ├── fcd.ts              FCD1/TLM/LOG/PARAM/ACK parsing + do/set command framing (ported js/fcd.js)
│   ├── transports.ts       SerialTransport (Web Serial, incl. OZONE VID/PID filters,
│   │                       getAuthorizedPorts()/connectPort() for auto-detect, and the
│   │                       onHotplug() connect/disconnect wiring) + WebSocketTransport
│   ├── sim.ts              SimTransport — mock FCD/1 board + flight model (ported js/sim.js)
│   ├── chart.ts            canvas scrolling line chart (ported js/chart.js)
│   ├── bus.ts               tiny per-id pub/sub so graph samples repaint canvases
│   │                        directly without cycling through React state
│   ├── accent.ts           descriptor accent name -> colour
│   └── docs.ts              server-only fs readers for content/*.md — also parses
│                            the two ```text prompt fences out of the implementer-
│                            prompts doc (single source of truth, no hand-retyping)
└── components/
    ├── Backdrop.tsx                        (drifting-blob canvas, mounted once in app/layout.tsx)
    ├── TopNav.tsx                           (shared glass top nav — brand, Console/Protocol
    │                                        pills, connection cluster — mounted once in
    │                                        app/layout.tsx, replaces the old ConnectBar.tsx)
    ├── WaitingScreen.tsx, BoardHeader.tsx
    ├── ChecksPanel.tsx, RailsPanel.tsx
    ├── GraphsPanel.tsx, GraphCard.tsx
    ├── LogPanel.tsx
    ├── ParamsPanel.tsx
    ├── ActionsPanel.tsx, ActionModal.tsx  (args + confirm-token modal)
    ├── PyroPanel.tsx                       (the 4 fire_mode operator flows)
    ├── ConfirmModal.tsx
    ├── Toast.tsx                           (reply toasts, context-provided)
    ├── MarkdownDoc.tsx                     (styled react-markdown renderer, /protocol)
    └── PromptSwitcher.tsx                  (ESP32/STM32 toggle + copy-to-clipboard, /protocol)
```

## Architecture notes

- **Self-describing UI.** `lib/types.ts#normaliseProfile` is the only place
  that understands the descriptor shape; every panel component just maps
  over `profile.checks/rails/graphs/params/actions` — add a field in
  firmware, declare it, it renders here with zero client changes.
- **Graphs bypass React state.** `useFcdConnection` publishes each TLM
  sample's graph values onto a `GraphBus` (`lib/bus.ts`); `GraphCard` pushes
  straight into its own `ScrollChart` canvas instance. This keeps live
  telemetry at 10 Hz+ from re-rendering the whole tree — the canvas owns its
  own paint loop, same design as the vanilla dashboard's `chart.js`.
- **Rails/checks/log/pyro** are lower-rate and do live in React state
  (`useFcdConnection`), since re-rendering a handful of small components at a
  few Hz is cheap and keeps that logic simple/testable.
- **The board is always the safety authority.** Every pyro/arm/fire control
  here is an operator-side guard on top (typed confirmation, danger styling,
  hold-to-fire) — it never assumes a command will succeed and always
  surfaces the board's actual `ACK`/`ERR` reply via a toast.

## The pyro fire handshake (all four `fire_mode`s)

Driven by `firmware/ozone-fw/app/Inc/pyro_trigger.h` /
`docs/fcd-protocol.md` §7. `PyroPanel.tsx` reads the active mode from the
`fire_mode` enum param (if the board declares one) and renders the matching
flow per channel:

| mode | flow |
|---|---|
| `safe` | **Prime** → board issues a fresh one-shot token + a countdown window → typed **FIRE** confirmation sends that token back. Two round-trips per fire; for planned ground tests. |
| `session` | **Enter flight mode** (`do flight_mode [key=]`) sets a flight-long key once (ground-supplied or board-rolled) → every subsequent fire is a single typed-**FIRE** click using that key. |
| `hot` | **Deploy-ready** latches per channel → the board's live rolling token (streamed as `dtok<N>` in telemetry, rotates ~4s) ticks live → a single guarded **FIRE** click auto-fills the current token. Recommended for in-flight emergency manual deploy. |
| `direct` | No token — a **hold-to-fire** button (~1.4s) is the only operator-side guard, since the board's own interlock is just armed + continuity + key switch. |

Arm/disarm has its own typed **ARM** confirmation and a pulsing red **ARMED**
pill; per-channel continuity (`cont1..contN`, N = `caps.pyro`) gates whether
any fire control is even clickable.

## Command integrity (CRC + seq)

Per `docs/fcd-protocol.md` §8, safety commands can carry a trailing
`seq=<n>*<CRC>`. This client turns it on automatically when the descriptor
sets `caps.integrity: true`, framing exactly:

```
arm, disarm, flight_mode, prime, deploy_ready, fire
```

(`safe` is deliberately **not** integrity-framed — it only clears
prime/deploy-ready/session state, nothing fires.) `seq` is a per-session
monotonic counter kept client-side (`lib/fcd.ts`'s caller in
`hooks/useFcdConnection.ts`); the CRC is an XOR of every byte in the line up
to (not including) the `*`, hex-encoded — matches the firmware's `fcd.c`
computation (`lib/fcd.ts#xor8`).

```
do fire ch=1 token=8341 seq=7*4A
```

## Reconciliations applied in this port (vs. the vanilla dashboard)

The vanilla `firmware/tools/web-dashboard` guessed a couple of wire-level
details that the task brief has since pinned down; this client implements
the corrected versions:

1. **Session-mode command.** The vanilla client invented `do session_key
   [key=]`. The real command is **`do flight_mode [key=HHHH]`** — the same
   action used to enter flight mode generally, which in `session` fire_mode
   *also* establishes/returns the flight pyro key on the same `ACK` line
   (`ACK flight_mode key=51992`). See `lib/sim.ts`'s `flight_mode` handler and
   `PyroPanel.tsx`'s session row.
2. **CRC algorithm.** Confirmed as XOR-fold-8 over the bytes before `*`,
   hex-encoded uppercase — `lib/fcd.ts#xor8` (unchanged from the vanilla
   client's implementation, which already guessed correctly).
3. **Which actions get CRC+seq framing.** Reconciled to exactly `arm`,
   `disarm`, `flight_mode`, `prime`, `deploy_ready`, `fire` (`safe` dropped
   from the vanilla client's broader guess, since it never fires or arms).

## FCD ambiguities still open (unchanged from docs/fcd-protocol.md §11)

These are protocol-level, not client-level — flagged here so firmware
doesn't silently diverge from what this client assumes:

1. **`checks[]` have no defined live wire representation.** There's no
   `CHECK` line type in FCD/1 — only `TLM`/`LOG`/`ACK`/`ERR`/`PARAM`. This
   client infers each check's pass/fail/warn from telemetry: an exact
   boolean TLM key match on the check `id` (best case), otherwise heuristics
   for well-known ids (`power`/`vbat` from the `vbat` rail's min/max, `pyro`
   from `cont1..N`, `baro` from `pressure_pa` presence). Anything else sits
   at "monitoring…" until the board gives it a signal — cleanest fix is a TLM
   key matching the check id (e.g. `sd=1`), which needs no client changes.
2. **`caps.integrity` isn't in `docs/fcd-protocol.md`'s current schema.**
   This client reads an assumed `caps.integrity: true/false` (default off).
   Add that key to OZONE's real descriptor once `fcd.c` exists, or specify a
   different signal for this client to key off.
3. **`get` reply framing** (one `PARAM` line per param vs. one packed line)
   is left as an implementation choice by the protocol doc; this client
   doesn't currently call bare `get` (it reads params from the `FCD1`
   descriptor's `value` fields and only ever `set`s), so it's unaffected
   either way, but a future params-refresh button would need to pick one.

None of these affect the descriptor-driven rendering (graphs/rails/params/
actions) — only the pyro trigger's command framing and the preflight-check
inference.

## Browser support

- **Chromium (Chrome/Edge/Brave/Opera):** full support, including Web Serial.
- **Firefox/Safari:** WebSocket + simulator transports work; Web Serial is
  disabled in the transport dropdown (not implemented by those browsers as
  of this writing).
- Web Serial requires a secure context — `http://localhost` is fine for
  local dev, anything else needs `https://`.

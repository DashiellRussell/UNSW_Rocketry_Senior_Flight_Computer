# OZONE Web Ground Station

A browser-based ground station for any `fcd/1` flight computer — a more
aesthetic, mission-control-styled alternative to the `gcs` terminal TUI
(`firmware/tools/gcs/`). Same rule as the TUI: **it speaks plain FCD**
(`firmware/tools/gcs/PROTOCOL.md`), so it works unmodified against:

- the STM32 board directly, over USB-CDC / a UART adapter (Web Serial), or
- the ESP32 telecom hub over WiFi (WebSocket), or
- its own built-in simulator, with no hardware at all.

Nothing here is OZONE-specific. On connect it sends `whoami`, parses the
`FCD1 {json}` descriptor the board replies with, and builds the entire UI —
one graph per `graphs[]`, one bar per `rails[]`, one row per `checks[]`, one
control per `actions[]`, one field per `params[]` — from that JSON. Add a
sensor in firmware, declare it, and it shows up here with zero changes to
this code.

## Run it

No build step, no `npm install`. It's plain ES modules + a hand-rolled canvas
chart — just serve the folder and open it:

```bash
cd firmware/tools/web-dashboard
python3 -m http.server 8787
# then open http://localhost:8787
```

(A real HTTP server is required, not `file://` — ES modules and the Web
Serial API are both blocked on `file://` by browser security policy. Any
static server works: `npx serve`, `caddy file-server`, VS Code "Live Server", etc.)

Open it in **Chrome or Edge** for the Web Serial transport (Firefox/Safari
don't implement it yet — the WebSocket and simulator transports still work
everywhere).

No hardware on you? Pick **Built-in simulator** in the connect bar top-left —
it runs a small deterministic flight model (boost → coast → apogee → descent
→ landed) through the exact same FCD parsing path as a real board, so the
whole UI (graphs, rails, checks, log, and all four pyro fire modes) can be
demoed cold.

## Connecting

The connect bar (top of the page) has one dropdown for transport + a Connect
button:

- **Web Serial (USB / UART)** — click Connect, the browser's native port
  picker opens, choose the STM32's USB-CDC port (or a UART/BT-serial adapter
  wired to USART2). Set the baud rate first if it's not 115200.
- **WebSocket (ESP32 telecom hub)** — enter the hub's WebSocket URL, e.g.
  `ws://192.168.4.1:81`, and Connect. The hub is expected to bridge the
  WebSocket 1:1 to the board's UART, forwarding the exact same `fcd/1` text
  lines both ways — no framing translation needed on either side.
- **Built-in simulator** — no fields needed, just Connect.

On connect, the console sends `whoami` and waits up to 1.5&nbsp;s for a line
starting `FCD1 `. If nothing arrives (a non-conforming or not-yet-flashed
board), it falls back to an empty generic profile — you still get raw
`TLM`/`LOG` line parsing, just no checks/rails/graphs/params/actions until the
firmware declares them. A banner in the dashboard tells you when you're in
that fallback state.

If the board re-announces itself later (reboot, mode change) — any `FCD1 `
line seen mid-session rebuilds the whole UI again, same as the initial
handshake.

## Layout

```
web-dashboard/
├── index.html          shell: connect bar, waiting screen, dashboard containers
├── css/style.css        dark mission-control theme (all in one file, no build step)
├── js/
│   ├── fcd.js           protocol layer: parse FCD1/TLM/LOG/PARAM/ACK lines,
│   │                    build `do`/`set` command strings incl. CRC+seq framing
│   ├── transports.js    SerialTransport (Web Serial) + WebSocketTransport,
│   │                    both behind one connect/send/onLine/onClose interface
│   ├── sim.js            SimTransport — a mock FCD/1 board implementing the
│   │                    same interface, so main.js can't tell it apart from
│   │                    a real link. Runs a small flight model + the full
│   │                    pyro_trigger.h handshake for all 4 fire_modes.
│   ├── chart.js          dependency-free canvas scrolling line chart
│   ├── ui.js             descriptor -> DOM: checks/rails/graphs/params/actions
│   │                    panels, the confirm-token modal, the log pane
│   ├── pyro.js           the pyro control panel: arm/disarm + the 4 fire-mode
│   │                    operator flows (safe/session/hot/direct)
│   └── main.js           glue: connect flow, handshake, line routing,
│                         command dispatch + reply correlation
└── README.md
```

No external CDN calls, no vendored charting library — the scrolling graphs
are a ~120-line canvas renderer (`js/chart.js`) rather than a bundled
Chart.js/D3, so there's genuinely nothing to fetch or build.

## Feature parity with the `gcs` TUI

- **Self-describing UI** from the `FCD1` descriptor (checks/rails/graphs/tlm/
  states/params/actions/caps) — same schema, same `from_manifest`-equivalent
  path as `model.py`.
- **Preflight checks** — pass/fail/warn rows per `checks[]`.
- **Live graphs** — one scrolling chart per `graphs[]`, auto-scaled, with a
  live readout.
- **Voltage rail bars** — coloured green/yellow/red by `[min,max]` + edge band,
  per `rails[]`.
- **Event log pane** — colour-coded by `LOG <level>`, with running err/warn
  counters, auto-scrolling, capped history.
- **Arm/disarm** with typed `ARM` confirmation and a pulsing red ARMED pill.
- **Per-channel continuity** — `cont1..contN` (N = `caps.pyro`) shown as a
  CONT/OPEN badge per channel, gating whether fire controls are even usable.
- **The pyro fire handshake, all four `fire_mode`s** (see below) — with
  typed `FIRE`/`ARM` confirmation modals and red danger styling throughout,
  same "operator-side guard on top, board is still the source of truth" model
  as the TUI's two-press confirm.
- **Descriptor-driven params/actions panels** — editable fields per `params[]`
  (float/int/bool/enum), buttons per `actions[]` with prompted args, confirm
  tokens, and danger styling — same generic rendering as `screens.py`'s
  `run_control`.

## The pyro fire handshake (all four modes)

Driven by `pyro_trigger.h` / `docs/telecom-command-protocol.md`. The pyro
panel reads which mode is active from a `fire_mode` enum param (if the board
declares one) and renders the matching flow per channel. **The external key
switch + board-side interlocks are always authoritative** — this UI only adds
an operator-side guard on top (typed confirm, danger styling, hold-to-fire);
it never assumes a fire will succeed and always surfaces the board's actual
`ACK`/`ERR` reply.

| mode | flow |
|---|---|
| `safe` | **Prime** button → board issues a fresh one-shot token + a countdown window → typed **FIRE** confirmation sends that token back. Matches "planned ground tests" in the docs. |
| `session` | One flight-wide key is set once (`session_key`, ground-supplied or board-rolled) → every subsequent fire is a single typed-**FIRE** click using that key, no per-fire prime step. |
| `hot` | **Deploy-ready** latches per channel → the board's live rolling token (streamed as `dtok<N>` in telemetry) is shown ticking → a single guarded **FIRE** click auto-fills the current token. This is the "pay the safety cost before the emergency" mode from the docs. |
| `direct` | No token at all — a **hold-to-fire** button (~1.4 s) is the only operator-side guard, since the board's own interlock is just armed + continuity + key switch. |

## Command integrity (CRC + seq)

Per `docs/telecom-command-protocol.md`, safety commands can carry a trailing
`seq=<n>*<CRC>`. The dashboard turns this on automatically when the
descriptor sets `caps.integrity: true`, framing `arm`/`disarm`/`prime`/`fire`/
`deploy_ready`/`session_key`/`safe` (see **ambiguities** below) as e.g.:

```
do fire ch=1 token=8341 seq=7*4A
```

`seq` is a per-session monotonic counter kept client-side; the CRC covers the
whole line up to the `*`, hex-encoded.

## FCD ambiguities resolved (please sanity-check against real firmware)

`PROTOCOL.md` and the telecom doc leave a few wire-level details unspecified.
This client makes a reasonable choice for each and documents it here so
firmware doesn't silently diverge:

1. **Checks[] have no defined live wire representation.** There's no `CHECK`
   line type in FCD/1 — only `TLM`/`LOG`/`ACK`/`ERR`/`PARAM`. The dashboard
   infers each check's pass/fail/warn from whatever telemetry already tells
   it: a boolean TLM key exactly matching the check `id` (best case, if the
   board streams one), otherwise heuristics for the well-known ids (`power`
   from the `vbat` rail's min/max, `pyro` from `cont1..N`, `baro` from
   `pressure_pa` presence). Anything else just sits at "monitoring…" until
   the board gives it a signal. **If you want deterministic preflight
   checks, the cleanest fix is to add TLM keys matching the check ids**
   (e.g. `sd=1`), which the dashboard will pick up with no code changes.
2. **`SESSION` mode's ground command isn't named in the docs.** The doc's
   worked examples only cover `safe`/`hot`/`direct`; `pyro_trigger.h` has a
   `pyro_trigger_arm_session()` entry point but no `do <id>` binding is
   specified. This client calls it `session_key` (optional `key=` arg, blank
   = let the board roll one) — see `SIM_FCD`/`sim.js` and `pyro.js`. If
   firmware lands on a different action id, only that one string needs to
   change on this side.
3. **Which actions get CRC+seq framing.** The doc names `arm`/`deploy_ready`/
   `prime`/`fire` explicitly; this client also frames `disarm`/`safe`/
   `session_key` since they mutate the same trigger state machine and a
   glitched `disarm`/`safe` is just as unsafe to misread as a glitched `arm`.
   Toggle the `SAFETY_ACTIONS` set in `js/main.js` if that's wrong.
4. **`caps.integrity` isn't in the current `PROTOCOL.md` schema.** The
   protocol doc lists `caps.pyro`/`arm`/`logs`/`telemetry` but nothing that
   signals whether a board expects CRC+seq framing. This client reads an
   assumed `caps.integrity: true/false` (defaults off) — add that key to
   OZONE's real descriptor once `fcd.c` exists, or tell this client a
   different signal to look for.
5. **CRC algorithm.** The telecom doc says "CRC (XOR/CRC8 of the line up to
   `*`), hex" without pinning the exact polynomial/variant. `js/fcd.js`
   implements a straight XOR-fold-8 (cheapest possible on an 8-bit path) —
   swap `xor8()` for whatever `pyro_trigger`'s firmware side actually computes
   before relying on this for real safety commands.

None of these affect the descriptor-driven rendering (graphs/rails/params/
actions) — only the pyro trigger's command framing and the preflight-check
inference, both called out above and both easy to retarget in one place each
(`js/pyro.js` action ids, `js/main.js` `SAFETY_ACTIONS`, `js/fcd.js` `xor8`).

## Browser support

- **Chromium (Chrome/Edge/Brave/Opera)**: full support, including Web Serial.
- **Firefox/Safari**: WebSocket + simulator transports work; Web Serial is
  greyed out in the transport dropdown (not implemented by those browsers as
  of this writing).
- Requires a secure context for Web Serial (`http://localhost` is fine for
  local dev; anything else needs `https://`).

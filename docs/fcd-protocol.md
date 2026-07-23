# FCD — Flight Computer Descriptor Protocol

**Version:** `fcd/1`
**Status:** Implemented as the OZONE ground-station protocol; OZONE firmware
integration in progress over USART2 (see [`telecom-command-protocol.md`](telecom-command-protocol.md)).
**Audience:** Anyone implementing or driving an FCD-speaking flight computer —
firmware engineers, ground-station developers, other UNSW Rocketry teams.

This document consolidates and supersedes the protocol description previously
split across `firmware/tools/gcs/PROTOCOL.md` and `docs/telecom-command-protocol.md`.
Where those two sources disagree, this document says so explicitly — see
[§11 Open questions / discrepancies](#11-open-questions--discrepancies).

---

## 1. Overview

FCD ("Flight Computer Descriptor") is a small, text-based, board-agnostic
protocol that lets **one** ground station application drive **any** flight
computer. Instead of the ground station hard-coding what buttons, graphs, and
telemetry fields a particular board has, the board **describes itself** the
moment it connects: what to check before flight, what to plot, what settings
are tunable, and what commands it accepts. The ground station reads that
description and builds its entire UI from it.

**Core idea:** the flight computer is the single source of truth for its own
capabilities *and* for flight safety. The ground station is a generic client —
add a sensor or a command in firmware, declare it in the descriptor, and it
appears on every FCD-compatible ground station with no client-side code
changes.

FCD is deliberately cheap to implement: a board needs to do two things to be
minimally conformant — reply to one query with one line of JSON, and stream
telemetry as `key=value` pairs. Everything else (params, actions, pyro
handshakes, command integrity) layers on top of that same line-oriented text
channel.

---

## 2. Transport assumptions

FCD does not care what physical link it rides on. It only assumes:

- **Newline-delimited ASCII/UTF-8 text.** Every message — handshake, telemetry
  sample, log line, command, reply — is exactly one line terminated by `\n`
  (`\r\n` is fine too; trim it on receipt).
- **A byte-stream, not a packet protocol.** No framing, addressing, or
  multiplexing is defined; FCD assumes a single point-to-point link between
  one ground station and one board.
- **No guaranteed ordering or delivery beyond what the link itself provides.**
  Radios and noisy links can drop or garble lines. Telemetry lines are cheap
  and repeat every sample, so a dropped `TLM` line is a non-event. Commands
  that matter (pyro fire) have their own integrity mechanism — see [§8](#8-command-integrity-crc--sequence-numbers).

This is why it runs unmodified over:

- **USB CDC** (virtual serial port) — the common bench/lab link.
- **UART** — e.g. OZONE's USART2 at 115200 8N1, PA2 (TX) / PA3 (RX).
- **Transparent-mode radio** — OZONE's telecom link is an Ebyte E22-900M22S
  LoRa module (915 MHz AU ISM) in transparent-UART mode, so the exact same
  byte stream that works over a wired UART works over the air. LoRa air-rate
  is low (a few kbps), which is why the telemetry *rate* is itself a
  declared, settable param (`tlm_hz`) rather than fixed — a board tunes it to
  fit its link.

No board-specific transport code is needed on the ground-station side beyond
"open this serial device and read/write lines."

---

## 3. Handshake (discovery)

On connect, the ground station sends:

```
whoami
```

The board replies with **one line**, prefixed with a marker so it can be
picked out of any other console output, followed by a compact JSON
descriptor:

```
FCD1 {"p":"fcd/1","name":"PROJECT OZONE", ...}
```

The ground station parses everything after the `FCD1 ` marker as JSON and
configures its entire UI from it (checks list, voltage bars, graphs,
telemetry parser, params panel, action buttons).

**Fallback:** if no `FCD1` line arrives within roughly **1.5 seconds** of
sending `whoami`, the ground station falls back to a built-in profile (a
known board's hard-coded descriptor, or a generic minimal one). This means a
non-conforming or not-yet-updated board still partially works — you get a
plain terminal instead of a rich UI, not a hang.

---

## 4. The descriptor (JSON schema)

Only `p` and `name` are strictly required. Every other field is optional and
degrades gracefully if omitted — this is what makes the protocol
forward-compatible (see [§9](#9-versioning--forward-compatibility)).

| Field | Type | Required | Meaning |
|---|---|---|---|
| `p` | string | **yes** | Protocol id + version, e.g. `"fcd/1"`. Lets the client adapt behaviour per protocol version. |
| `name` | string | **yes** | Board/project title shown in the UI (e.g. `"PROJECT OZONE"`). |
| `sub` | string | no | Subtitle, e.g. team/board description. |
| `fw` | string | no | Firmware version string, free-form (e.g. `"0.1.0"`). |
| `accent` | string | no | UI accent colour hint (e.g. `"cyan"`). |
| `checks` | array of `{id, label}` | no | Preflight checklist items the UI renders as live pass/fail rows. `id` should map to something the board can actually report status for (often surfaced via `TLM` or `LOG`). |
| `rails` | array of `{id, label, min, max, nom?}` | no | Power rails rendered as coloured voltage bars. `id` maps to a telemetry channel name. The client colours green within `[min,max]`, yellow near the edges, red outside. |
| `graphs` | array of `{id, label, unit}` | no | Live channels to plot as scrolling sparklines/graphs — one graph per entry. `id` maps to a telemetry channel name. |
| `tlm` | array of strings | no | Documents the full set of channel names the board streams in `TLM` lines (see [§5](#5-telemetry-stream)). Should be kept in sync with what is actually emitted. |
| `states` | array of strings | no | The flight-state vocabulary (e.g. `["PAD","BOOST","COAST","APOGEE","DESCENT","LANDED"]`), used for labelling/colouring the `state` telemetry value. |
| `params` | array of param objects | no | Tunable settings the console can read (`get`) and write (`set <id> <val>`). See shape below. |
| `actions` | array of action objects | no | Commands the console can invoke via `do <id> [k=v]`. The console auto-renders one button per action. See shape below. |
| `imu` | object `{accel:[x,y,z], up, units, g_rest}` | no | Inertial orientation (see below). `accel` = the three TLM keys carrying the accelerometer axis components; `up` = the board axis reading +1 g at rest; lets a ground station render a 3D orientation view. |
| `caps` | object | no | Capability flags — see below. |

**`params[]` object shape:**

| Field | Type | Required | Meaning |
|---|---|---|---|
| `id` | string | yes | Param identifier, used in `get`/`set`/`PARAM` replies. |
| `label` | string | yes | Human-readable label for the UI. |
| `type` | `"float"` \| `"int"` \| `"bool"` \| `"enum"` | yes | Value type; drives what input widget the console shows and how it parses replies. |
| `value` | matching the declared `type` | yes | Current value at descriptor time (informational; `get` returns live values). |
| `min` / `max` | number | no | Bounds for `float`/`int` types. |
| `values` | array of strings | required for `enum` | The allowed enum values. |
| `unit` | string | no | Unit label shown next to the value (e.g. `"m/s"`). |

**`actions[]` object shape:**

| Field | Type | Required | Meaning |
|---|---|---|---|
| `id` | string | yes | Action identifier, used in `do <id> ...`. |
| `label` | string | yes | Button label. |
| `confirm` | string | no | If present, the operator must type this exact token before the console sends the command (e.g. `"ARM"`, `"FIRE"`). |
| `danger` | bool | no | If true, render the button in red/warning styling. |
| `args` | array of `{id, type, min?, max?, values?}` | no | Arguments the console prompts for before sending, appended as `k=v` pairs. |

**`caps` object fields:**

| Field | Type | Meaning |
|---|---|---|
| `pyro` | int | Number of pyro channels. Drives how many `contN` continuity fields the console expects in telemetry (`cont1..contN`). |
| `arm` | bool | Whether arming is supported at all. |
| `logs` | bool | Whether the board logs to SD (and those logs are downloadable). |
| `telemetry` | bool | Whether the board has a live in-flight downlink. If `false`, the console shows a "logging, disconnect & fly" view instead of live graphs, since there's nothing to stream in flight. **Defaults to `true` if omitted.** |

### Orientation (`imu`)

If the board has an accelerometer, it can declare an `imu` block so the ground
station can draw a live 3D orientation view instead of just a number:

```jsonc
"imu": {
  "accel": ["lo_gx", "lo_gy", "lo_gz"], // the 3 TLM keys for the axis components
  "up":    "+z",                        // board axis pointing skyward at rest (nose-up)
  "units": "g",                         // component units
  "g_rest": 1.0                         // |accel| magnitude at rest
}
```

- Axes are **right-handed**; `up` is the axis that reads `+g_rest` when the
  vehicle stands nose-up on the pad. It **must** match the physical sensor
  mounting (sign included, e.g. `-y`).
- The station derives **tilt** from the gravity vector at rest. This is
  accel-only: there is **no yaw**, and during powered/coast flight the measured
  vector is thrust/drag, not gravity — so label the view "orientation
  (accel-derived)" and treat it as attitude-at-rest, not a full IMU.
- Prefer the **low-g** accelerometer's axes for `accel` (clean 1 g at rest); the
  high-g sensor saturates the resting reading.

### Full annotated example

```jsonc
{
  "p":      "fcd/1",                   // protocol id + version (required)
  "name":   "PROJECT OZONE",           // title (required)
  "sub":    "UNSW Rocketry Senior FC",
  "fw":     "0.1.0",
  "accent": "cyan",

  "checks": [
    {"id": "power", "label": "Power"},
    {"id": "baro",  "label": "Barometers"}
  ],

  "rails": [
    {"id": "vbat", "label": "Main batt", "min": 6.4, "max": 8.4, "nom": 7.4}
  ],

  "graphs": [
    {"id": "agl_m",  "label": "Altitude AGL",  "unit": "m"},
    {"id": "vel_ms", "label": "Vertical vel", "unit": "m/s"}
  ],

  "tlm": [
    "t_ms", "state", "agl_m", "alt_m", "vel_ms", "pressure_pa", "temp_c",
    "hi_g", "lo_g", "vbat", "pyro_v", "armed", "cont1", "cont2"
  ],

  "states": ["PAD", "BOOST", "COAST", "APOGEE", "DESCENT", "LANDED"],

  "params": [
    {"id": "apogee_vel", "label": "Apogee detect vel", "type": "float",
     "value": 3.0, "min": 0, "max": 50, "unit": "m/s"},
    {"id": "vbat_div",   "label": "VBAT divider",       "type": "float", "value": 4.49},
    {"id": "units",      "label": "Altitude units",     "type": "enum",
     "value": "m", "values": ["m", "ft"]}
  ],

  "actions": [
    {"id": "arm",     "label": "Arm pyros", "confirm": "ARM"},
    {"id": "set_led", "label": "Set RGB LED",
     "args": [{"id": "colour", "type": "enum", "values": ["off", "red", "green", "blue"]}]},
    {"id": "fire",    "label": "Ground-test fire", "danger": true, "confirm": "FIRE",
     "args": [{"id": "ch", "type": "int", "min": 1, "max": 2}]}
  ],

  "caps": {"pyro": 2, "arm": true, "logs": true, "telemetry": true}
}
```

---

## 5. Telemetry stream and log lines

### `TLM` — telemetry samples

When streaming is on, the board emits one line per sample: `TLM` followed by
whitespace-separated `key=value` pairs, order-independent, missing keys
tolerated:

```
TLM t_ms=12345 state=BOOST agl_m=412.7 vel_ms=188.1 pressure_pa=96050 temp_c=12.3 hi_g=9.6 lo_g=15.9 vbat=7.81 pyro_v=7.40 armed=0 cont1=1 cont2=1
```

**Type coercion rules** — there are no per-field types in the descriptor
because the value itself tells the parser what it is:

- `state` is always one of the `states` strings declared in the descriptor.
- Booleans are `0` or `1` (e.g. `armed`, `cont1`).
- Everything else is a number (int or float), parsed as such.
- Keys should match the ids listed in `tlm`. `graphs[].id` and `rails[].id`
  are read directly out of the telemetry stream; continuity fields follow
  the pattern `cont1..contN` where `N = caps.pyro`.

### `LOG` — event / error lines

The board may emit log lines at any time, interleaved with `TLM` lines. This
is how the board surfaces faults (boot fault codes, sensor dropouts, SD
errors) to the operator in real time:

```
LOG ERR  SD write failed (FR_DISK_ERR)
LOG WARN baro2 dropout - using baro1
LOG INFO apogee detected (3303 m)
```

**Format:** `LOG <level> <message>`, where `level` ∈ `ERR|WARN|INFO|DEBUG`
(single-letter `E|W|I|D` are also accepted). The ground station streams these
into a live event-log pane, colour-coded by level, with an err/warn counter.

---

## 6. Commands (ground → board)

The ground station drives the board with three line commands; the board
replies on one line. **Unknown commands should reply `ERR`.**

| Send | Meaning | Reply (example) |
|---|---|---|
| `whoami` | Request descriptor | `FCD1 {...}` |
| `get` | Dump all params | `PARAM apogee_vel=3.0` (one line per param, or one line with all — implementation's choice, but be consistent) |
| `set <id> <value>` | Write a param | `PARAM apogee_vel=5.5` or `ERR range` |
| `do <id> [k=v ...]` | Invoke an action | `ACK fire ch1 fired` or `ERR not armed` |

**Reply grammar:**

- `PARAM <id>=<value>` — a param was read or successfully written.
- `ACK <id> [detail...]` — an action was invoked successfully; `detail` is
  free-form context (e.g. `ACK fire ch1 fired`, `ACK arm armed`).
- `ERR [reason]` — the command was rejected; `reason` is free-form and
  intended for the operator, not machine parsing (e.g. `ERR not armed`,
  `ERR range`, `ERR bad_token`).

```
set apogee_vel 5.5         -> PARAM apogee_vel=5.5
do set_led colour=red      -> ACK set_led red
do arm                     -> ACK arm armed
do fire ch=1               -> ERR not armed        (board enforces interlocks)
```

**The board is the source of truth for safety.** It must reject `fire`
unless armed (and the external key switch is closed — see [§7](#7-pyro-fire-mode-handshakes)),
validate `set` against the declared `min`/`max`/`values`, and enforce
whatever flight-state lockouts apply. The ground station adds
operator-side guards on top of this (typed `FIRE`/`ARM` confirmation, red
danger styling, hold-to-fire) but must never be relied on as the only
safety layer — a board must be safe even if driven by a naive or malicious
client.

---

## 7. Pyro fire-mode handshakes

OZONE's pyro system has two channels (`PYRO_CH1`, `PYRO_CH2`; drogue + main).
Firing is gated by three independent layers, from outermost to innermost:

1. **External key switch (hardware, non-bypassable).** Powers the arm P-FET
   rail. Software cannot fire without it physically closed, in *any* mode.
2. **Software arm + continuity.** `pyro_is_armed()` and per-channel
   continuity (e-match presence) must both be true.
3. **The selected `fire_mode` handshake** (documented below) — this is the
   *only* thing that changes between modes. It governs the ground↔board
   conversation required before a `do fire` is honoured; it does not weaken
   layers 1 or 2.

**Design principle:** pay the safety cost before the emergency, not during
it. A manual deploy is usually a contingency ("something went wrong, fire
NOW"), so the time-critical step must be fast — achieved by doing
verification work ahead of time, not at the moment of firing.

The mode is chosen with the `fire_mode` param (four values:
`safe` / `session` / `hot` / `direct` — see `pyro_trigger.h`,
`fire_mode_t`). Switching mode clears all in-progress prime/deploy-ready/
session state (re-safes).

### Mode A — `safe` (staged per-fire nonce)

For **planned ground tests**. Two steps per fire, each channel primed
individually:

```
do prime ch=1            -> ACK prime ch1 token=8341 window=10s   (fresh random one-shot token)
do fire ch=1 token=8341  -> ACK fire ch1 fired                    (token match + within window + armed + continuity)
```

A stale, expired, or wrong token returns `ERR` and the window closes (the
token is consumed / cleared). The default prime→fire window is 10 s
(`OZONE_TRIG_SAFE_WINDOW_MS`). Replay- and glitch-proof, but requires two
round-trips per fire — too slow for an in-flight emergency.

### Mode B — `session` (flight-long password)

A single "flight key" is established once, at flight-mode entry, and is
valid for every fire for the rest of the session (no per-fire window):

```
do flight_mode                 -> ACK flight_mode key=51992     (board rolls a random key)
   ...later, in flight...
do fire ch=1 token=51992       -> ACK fire ch1 fired             (session key match; no expiry)
do fire ch=2 token=51992       -> ACK fire ch2 fired             (same key works for the other channel)
```

The ground crew can also supply a chosen key instead of letting the board
roll one (`pyro_trigger_arm_session(supplied, ...)` takes a non-zero
`supplied` value). The key persists until `safe`/`disarm`/mode change, is
**not** streamed in telemetry (unlike the `hot`-mode rolling token — see
below), and is the operator's responsibility to remember/protect. Firing
before a key is set returns `ERR not primed/ready/keyed`.

> The exact `do` command name and argument spelling for entering `session`
> mode is not settled in the source documents — see
> [§11](#11-open-questions--discrepancies).

### Mode C — `hot` (deploy-ready, recommended for in-flight emergency)

The handshake is paid **ahead of time**; the emergency fire itself is a
single keypress:

```
do arm                   -> ACK arm armed              (key switch must be closed)
do deploy_ready ch=1     -> ACK deploy_ready ch1        (one-time confirm; latches deploy-ready)
   ... board now streams a live rolling token in telemetry: TLM ... dtok1=5567 ...
   ... token rotates every ~4 s; the fire window auto-refreshes while deploy-ready and armed ...
do fire ch=1 token=5567  -> ACK fire ch1 fired          (ground station binds this to ONE guarded
                                                          hotkey that auto-fills the current token)
```

Fast (one key at the moment of truth) **and** replay-safe (must carry the
currently-live rolling token, which changes every rotation period). If the
board drops out of armed (key switch opens) while deploy-ready, it
automatically re-safes that channel. `do safe` / `do disarm` also exits
deploy-ready and clears state.

### Mode D — `direct` (fastest, least safe)

Once armed (key switch closed) and continuity is present, fire immediately —
no token, no prior handshake step:

```
do fire ch=1             -> ACK fire ch1 fired
```

Relies solely on the key switch, software arm, and continuity check (plus
the optional command CRC, to catch a garbled line — see [§8](#8-command-integrity-crc--sequence-numbers)).
The ground station is expected to guard this operator-side with a
hold-to-fire interaction. Use only if the team has explicitly accepted the
reduced protection against a replayed or spoofed `do fire` line.

### Mode comparison

| Mode | Setup steps before fire | Time-to-fire at the moment of truth | Replay-safe? | Best use |
|---|---|---|---|---|
| `safe` | `prime` (per channel, per fire) | 1 command (`fire` + token) | Yes — one-shot token, 10 s window | Planned ground tests |
| `session` | `flight_mode` (once per flight) | 1 command (`fire` + session key) | Partial — key is long-lived, not per-fire; protects against garble/random replay but not a captured key | Normal flight arming — pay the cost once, fire fast for the rest of the flight |
| `hot` | `arm` + `deploy_ready` (per channel, once) | 1 command (`fire` + current rolling token) | Yes — token rotates every ~4 s, window is 2 rotations wide | **Recommended for in-flight emergency manual deploy** |
| `direct` | `arm` only | 1 command (`fire`, no token) | No — any well-formed `do fire` line fires | Bench/lab testing only, accepted-risk teams |

### Result codes

Every trigger command maps to one `trig_result_t`, which the FCD `do`
dispatcher turns into an `ACK`/`ERR` reply:

| Result | Meaning |
|---|---|
| `TRIG_FIRED` | Channel fired. |
| `TRIG_PRIMED` | `prime` accepted; token issued. |
| `TRIG_DEPLOY_READY` | Deploy-ready latched (`hot` mode). |
| `TRIG_SESSION_SET` | Session key established. |
| `TRIG_SAFED` | Prime / deploy-ready / session key cleared. |
| `TRIG_ERR_MODE` | Command not valid in the current `fire_mode`. |
| `TRIG_ERR_NOT_ARMED` | Board not armed (key switch open / not armed). |
| `TRIG_ERR_NO_CONT` | No continuity on that channel. |
| `TRIG_ERR_NO_TOKEN` | Fire needs a token/key in this mode and none was supplied. |
| `TRIG_ERR_BAD_TOKEN` | Token / session-key mismatch. |
| `TRIG_ERR_EXPIRED` | Fire window elapsed. |
| `TRIG_ERR_NOT_READY` | Fire attempted before `prime` / `deploy_ready` / session key was set. |
| `TRIG_ERR_CHANNEL` | Bad channel index. |

---

## 8. Command integrity: CRC + sequence numbers

Telemetry and ordinary (non-safety) commands stay plain text — no
overhead, so the stock ground console keeps working unmodified.

**Safety commands** — `arm`, `prime`, `deploy_ready`, `flight_mode`, `fire` —
may additionally carry a trailing checksum and a monotonic sequence number.
The board rejects the command if either check fails:

```
do fire ch=1 token=8341 seq=7*4A
                        │       └ CRC: 8-bit XOR of all ASCII bytes before '*', two hex digits
                        └ monotonic per-session counter; board ignores <= last seen
```

- **CRC** defends against a bit-flipped/garbled command being misread as a
  different, still-valid command (e.g. `ch=1` corrupted into `ch=2`) —
  important on a lossy radio link where a corrupted-but-plausible line could
  otherwise slip through.
- **`seq`** defends against duplicate or replayed packets — the board tracks
  the last-seen sequence number per session and ignores anything at or
  below it.

This is independent of, and layered on top of, the fire-mode token/session-key
handshake in §7 — the CRC/seq pair protects the *line itself* from
corruption/replay; the fire-mode token protects the *authorisation* to fire.

---

## 9. Versioning / forward-compatibility

- The descriptor's `p` field (e.g. `"fcd/1"`) is the protocol version. A
  ground station should branch on it if it ever needs to change parsing
  behaviour for a future `fcd/2`.
- **Unknown descriptor fields are ignored.** A board can add new top-level
  keys (or new keys inside `params`/`actions`/etc.) without breaking older
  ground stations — they simply won't render whatever isn't recognised.
- Only `p` and `name` are required; every other field degrades gracefully
  if absent, so a minimal board and a fully-featured board both work with
  the same client.

---

## 10. Implementer's checklist

To make a board "FCD-ready":

1. On receiving `whoami`, print `FCD1 ` + a one-line JSON descriptor
   (only `p` and `name` are mandatory; add `checks`/`rails`/`graphs`/`tlm`/
   `params`/`actions`/`caps` as they become relevant).
2. When streaming, print `TLM ` + `key=value` pairs per sample, at whatever
   rate suits the link (make the rate a `param` if the link is bandwidth
   constrained, e.g. LoRa).
3. Emit `LOG <level> <msg>` for faults/events as they happen (boot faults,
   sensor dropouts, SD errors), interleaved freely with `TLM`.
4. Handle `set <id> <value>` — validate against the declared type/range,
   reply `PARAM <id>=<value>` or `ERR <reason>`.
5. Handle `do <id> [k=v]` — enforce all interlocks in firmware (never trust
   the ground station to have checked), reply `ACK <id> [detail]` or
   `ERR <reason>`.
6. Keep the ids used in `checks`/`rails`/`graphs`/`tlm`/`params`/`actions`
   **consistent** between the descriptor and what the `TLM`/`set`/`do`
   handlers actually use — the descriptor is only useful if it matches
   reality.
7. If the board has pyro channels, pick a `fire_mode` (§7), implement its
   handshake exactly (don't invent a fifth mode without updating this doc),
   and never let the mode weaken the external key switch / continuity /
   flight-state lockouts underneath it.
8. If the link is lossy (radio), add CRC+seq to safety commands (§8) and
   keep telemetry plain text.
9. Validate against a real ground station: point it at the board
   (`python3 -m gcs --board <name> --port <dev>` for OZONE's `gcs` tool). On
   connect it sends `whoami`; a successful handshake reports something like
   `✓ handshake <NAME> … discovered N checks, M graphs, …`. If the
   descriptor is malformed, the console falls back to a built-in profile and
   prints a note — treat that as a bug to fix, not an acceptable fallback.

---

## 11. Resolved against the OZONE firmware

The items below were open while this spec was drafted from three source docs;
they are now **resolved against the shipped FCD dispatcher**
(`firmware/ozone-fw/app/Src/fcd.c`, `app/Src/pyro_trigger.c`):

1. **`session` mode is real and documented** — implemented in `pyro_trigger.c`
   (`FIRE_MODE_SESSION`, boot default) and dispatched by `fcd.c`.
2. **Session-mode command = `do flight_mode [key=HHHH]`** — confirmed. Board
   arms and establishes the flight pyro key (board-generated if `key` omitted),
   replying `ACK flight_mode armed key=XXXX`.
3. **CRC/seq safety commands = `arm` / `disarm` / `flight_mode` / `prime` /
   `deploy_ready` / `fire`** — the CRC is an 8-bit XOR of the bytes before `*`
   (see §8); `seq` is a monotonic per-session counter.
4. **`get` returns one `PARAM` line per parameter** (not packed) — `fcd.c`
   emits `PARAM fire_mode=…`, `PARAM tlm_hz=…`, `PARAM stream=…` on separate lines.
5. **The OZONE descriptor declares `prime` / `deploy_ready` / `flight_mode` /
   `fire` as `actions[]`** so the ground station renders controls for them.
6. `TRIG_SAFED` is a reserved result code; `do safe`/`do disarm` currently reply
   `ACK safe` / `ACK disarm` and clear all trigger state.

Historical note: an earlier `docs/telecom-command-protocol.md` mentioned only
three fire modes (safe/hot/direct) before `session` was added — that prose is
superseded by this document and the code.

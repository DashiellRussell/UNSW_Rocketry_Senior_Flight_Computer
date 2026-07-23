# OZONE Telecom — Command & Telemetry Protocol (firmware side)

Status: **in progress** (2026-07-23). Implements the `fcd/1` protocol
(`firmware/tools/gcs/PROTOCOL.md`) in OZONE firmware over **USART2**, so the
existing `gcs` ground station drives the board over the radio link.

## Link

- **Port:** USART2 — PA2 (TX) / PA3 (RX), 115200 8N1 (matches `main.c`).
- **Physical:** telecom board's **Ebyte E22-900M22S** LoRa module (915 MHz AU ISM)
  in transparent-UART mode. Also reachable by a direct wired header / BT module —
  the protocol is transport-agnostic (plain text + `\n`).
- **RX:** interrupt-driven ring buffer (was previously unserviced — TX only).
- **Bandwidth:** LoRa air-rate is a few kbps. Telemetry is plain-text `key=value`
  but the stream **rate is a param** (`tlm_hz`) so it fits the link.

## Messages (see PROTOCOL.md for the full spec)

- `whoami` → `FCD1 {json descriptor}` (one line)
- `TLM key=value ...` — telemetry stream (rate = `tlm_hz`)
- `LOG <E|W|I|D> <msg>` — events/faults
- `get` / `set <id> <val>` — params
- `do <id> [k=v]` — actions (arm, disarm, preflight, log_start/stop, prime, fire…)

## Command integrity (safety commands only)

`arm` / `deploy_ready` / `prime` / `fire` may carry a trailing checksum and
sequence number; the board rejects on mismatch or replay. Telemetry and
non-safety commands stay plain text so the stock `gcs` monitor is unaffected.

```
do fire ch=1 token=8341 seq=7*4A
                        │       └ CRC (XOR/CRC8 of the line up to '*'), hex
                        └ monotonic per-session counter; board ignores <= last seen
```

Rationale: **CRC** stops a bit-flipped command being misread (e.g. `ch=1`→`ch=2`);
**seq** kills duplicate/replayed packets. Independent of the nonce handshake.

## Pyro trigger — three selectable modes (`param fire_mode`)

The **external key switch is the non-bypassable hardware arm gate in every mode**
(it powers the arm P-FET rail; software cannot fire without it closed). Gates
init LOW; continuity must be present; the flight state machine's own lockouts
still apply. `fire_mode` only changes the *ground→board handshake*.

Design principle: **pay the safety cost before the emergency, not during it.**
A manual deploy is usually a contingency ("something went wrong, fire NOW"), so
the time-critical step must be fast — achieved by doing the verification up front.

### Mode A — `safe` (staged nonce challenge-response)
For **planned ground tests**. Two steps each fire:
```
do prime ch=1            -> ACK prime ch1 token=8341 window=10s   (fresh random token)
do fire ch=1 token=8341  -> ACK fire ch1 fired                    (token match + <window + armed + cont)
```
Stale/expired/wrong token → `ERR`, window closes. Replay- and glitch-proof.

### Mode B — `hot` (deploy-ready, recommended for in-flight emergency)
Handshake paid **ahead of time**; emergency fire is a single keypress.
```
do arm                   -> ACK arm armed              (key switch must be closed)
do deploy_ready ch=1     -> ACK deploy_ready ch1        (one-time confirm)
   ... board now streams a LIVE ROLLING token in telemetry: TLM ... dtok1=5567 ...
   ... token rotates every few seconds; window auto-refreshes while deploy-ready ...
do fire ch=1 token=5567  -> ACK fire ch1 fired          (gcs binds this to ONE guarded hotkey
                                                          that auto-fills the current token)
```
Fast (1 key at the moment of truth) **and** replay-safe (must carry the current
rolling token). `do safe`/`disarm` exits deploy-ready.

### Mode C — `direct` (fastest, least safe)
Once armed (key switch closed), fire immediately, no token:
```
do fire ch=1             -> ACK fire ch1 fired
```
`gcs` guards operator-side with hold-to-fire. Relies solely on the key switch +
continuity (+ CRC to catch garble). Use only if the team accepts the risk.

## Firmware structure (planned)

- `link_uart.[ch]` — USART2 IRQ RX ring + non-blocking line reader + TX (`uart_printf`).
- `fcd.[ch]` — transport-agnostic protocol engine: descriptor, TLM formatter,
  LOG, `get`/`set`/`do` dispatch; bound to a `link` (USART2 now, USB later).
- `pyro_trigger.[ch]` — the `fire_mode` state machine (safe/hot/direct), token
  generation + window timers, sits above `pyro.c` and the app's arm/fire hooks.
- Reuses `ozone_app_request_arm()` / `ozone_app_request_ground_test()` and the
  preflight/logging entry points already in the app.

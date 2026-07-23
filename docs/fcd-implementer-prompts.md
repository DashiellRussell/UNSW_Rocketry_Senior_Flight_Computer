# Implement FCD on your board — copy-pastable AI prompts

Paste one of the prompts below into an AI coding assistant (Claude, etc.) to
scaffold an **FCD/1**-compliant flight computer. FCD is a tiny self-describing
protocol: your board answers `whoami` with one line of JSON describing itself,
streams telemetry as `key=value`, and takes `get`/`set`/`do` commands — and then
**any FCD ground station drives it with zero board-specific code.** Full spec:
[`fcd-protocol.md`](./fcd-protocol.md).

The two prompts differ only in platform boilerplate; the protocol rules are
identical. Adapt the descriptor (sensors, rails, actions) to your board.

---

## Prompt A — ESP32 (Arduino / PlatformIO)

```text
You are implementing the FCD/1 ("Flight Computer Descriptor") protocol on an
ESP32 (Arduino framework) so my board works with the OZONE ground station.

PROTOCOL RULES (newline-delimited ASCII over a stream — USB Serial, UART, or a
transparent radio):
1. On receiving a line "whoami", reply with ONE line: `FCD1 ` followed by a
   compact JSON descriptor (schema below).
2. While streaming is enabled, print one telemetry line per sample:
   `TLM key=value key=value ...`  (booleans as 0/1, everything else numeric,
   `state` is a short string). Rate is a tunable param `tlm_hz`.
3. Emit events/faults at any time as `LOG <level> <message>` where level is one
   of E|W|I|D.
4. Handle three commands and reply on one line each:
   - `get`                -> one `PARAM <id>=<value>` line per parameter
   - `set <id> <value>`   -> `PARAM <id>=<value>`  (or `ERR set <id>`)
   - `do <id> [k=v ...]`  -> `ACK <id> ...`         (or `ERR <id> <reason>`)
   Unknown commands reply `ERR unknown`.
5. SAFETY COMMANDS (`arm`,`disarm`,`flight_mode`,`prime`,`deploy_ready`,`fire`)
   MAY carry a trailing integrity suffix: `... seq=<n>*<HH>` where `*<HH>` is the
   two-hex-digit 8-bit XOR of every ASCII byte BEFORE the `*`, and `seq` is a
   monotonic per-session counter. If a `*HH` is present, verify it and reject on
   mismatch (`ERR integrity`); if a `seq` is present, reject values <= the last
   accepted (`ERR seq`). Commands without the suffix are still accepted.
6. THE BOARD IS THE SOURCE OF TRUTH FOR SAFETY. Never fire a pyro channel unless
   your hardware arm interlock is satisfied (e.g. a physical key switch) AND
   continuity is present AND the fire-mode handshake passed. The ground station
   adds operator guards but must never be able to bypass the board.

DESCRIPTOR (adapt to your hardware; only `p` and `name` are required):
FCD1 {"p":"fcd/1","name":"MY ROCKET FC","fw":"1.0",
 "checks":[{"id":"baro","label":"Baro"},{"id":"sd","label":"SD"}],
 "rails":[{"id":"vbat","label":"Batt","min":6.4,"max":8.4,"nom":7.4}],
 "graphs":[{"id":"agl_m","label":"Altitude","unit":"m"},
           {"id":"vel_ms","label":"Velocity","unit":"m/s"}],
 "tlm":["t_ms","state","agl_m","vel_ms","vbat","armed"],
 "states":["IDLE","ARMED","BOOST","COAST","DESCENT","LANDED"],
 "params":[{"id":"tlm_hz","label":"Telemetry rate","type":"int","value":10,
            "min":1,"max":50,"unit":"Hz"}],
 "actions":[{"id":"arm","label":"Arm","confirm":"ARM"},
            {"id":"fire","label":"Fire","danger":true,"confirm":"FIRE",
             "args":[{"id":"ch","type":"int","min":1,"max":2}]}],
 "caps":{"pyro":2,"arm":true}}

IMPLEMENTATION:
- Read lines non-blocking from Serial (and/or your radio link). Keep a small RX
  line buffer; dispatch on '\n'.
- Store the descriptor as a single const String/char[] and print it verbatim
  after "whoami".
- Implement set_param(id,val) and do_action(id,args) for whatever you declared.
- Stream TLM at `tlm_hz` using millis() timing.
- If you have WiFi/BLE, you may also relay the SAME text lines over those links
  (the protocol is transport-agnostic; a phone on BLE Nordic-UART sees the same
  stream). Fan out identically; never transform safety commands.

Give me a complete, compiling Arduino sketch (or PlatformIO project) with the
descriptor, the line parser, the command dispatch, and a TLM streamer, wired to
placeholder sensor reads I can fill in. Comment the safety interlock clearly.
```

---

## Prompt B — STM32 (HAL / C)

```text
You are implementing the FCD/1 ("Flight Computer Descriptor") protocol on an
STM32 (STM32Cube HAL, C) so my board works with the OZONE ground station.

PROTOCOL RULES (newline-delimited ASCII over USART or USB CDC):
1. On a "whoami" line, reply ONE line: `FCD1 ` + a compact JSON descriptor.
2. Stream telemetry as `TLM key=value ...` at a tunable rate `tlm_hz`
   (booleans 0/1, `state` a short string, else numbers). Note: printing floats
   with newlib-nano needs the linker flag `-u _printf_float`.
3. Emit `LOG <E|W|I|D> <message>` for events/faults at any time.
4. Commands, one-line replies:
   - `get`               -> one `PARAM <id>=<value>` per parameter
   - `set <id> <value>`  -> `PARAM <id>=<value>` or `ERR set <id>`
   - `do <id> [k=v ...]` -> `ACK <id> ...` or `ERR <id> <reason>`
   Unknown -> `ERR unknown`.
5. SAFETY COMMANDS (`arm`,`disarm`,`flight_mode`,`prime`,`deploy_ready`,`fire`)
   MAY carry `... seq=<n>*<HH>`: `*<HH>` = two-hex-digit 8-bit XOR of all bytes
   before `*` (verify, else `ERR integrity`); `seq` = monotonic per-session
   counter (reject <= last, else `ERR seq`). Commands without the suffix still work.
6. BOARD IS THE SAFETY SOURCE OF TRUTH: never drive a pyro gate unless the
   hardware arm interlock (external key switch) is satisfied, continuity is
   present, and the fire-mode handshake passed. Gates must init LOW at boot.

TRANSPORT: implement two functions for your link and call the engine from your
super-loop (non-blocking, so a stalled host never hangs the flight loop):
  void link_write(const char *s);          // send a string (short TX timeout)
  int  link_read_line(char *buf, int n);    // >0 when a full '\n' line is ready
Use an interrupt-driven RX ring buffer for the USART; TX via HAL_UART_Transmit
with a short timeout.

DESCRIPTOR (adapt; only `p`+`name` required) — store as one const char*:
FCD1 {"p":"fcd/1","name":"MY ROCKET FC","fw":"1.0",
 "checks":[{"id":"baro","label":"Baro"},{"id":"sd","label":"SD"}],
 "rails":[{"id":"vbat","label":"Batt","min":6.4,"max":8.4}],
 "graphs":[{"id":"agl_m","label":"Alt","unit":"m"},
           {"id":"vel_ms","label":"Vel","unit":"m/s"}],
 "tlm":["t_ms","state","agl_m","vel_ms","vbat","armed"],
 "params":[{"id":"tlm_hz","label":"Telemetry rate","type":"int","value":10,
            "min":1,"max":50,"unit":"Hz"}],
 "actions":[{"id":"arm","label":"Arm","confirm":"ARM"},
            {"id":"fire","label":"Fire","danger":true,"confirm":"FIRE",
             "args":[{"id":"ch","type":"int","min":1,"max":2}]}],
 "caps":{"pyro":2,"arm":true}}

Give me: a self-contained `fcd.c`/`fcd.h` module (descriptor, line dispatch,
TLM formatter with snprintf, get/set/do handlers, the CRC/seq check) plus a
`link_uart.c` with an interrupt RX ring + non-blocking line reader for one
USART, and a one-line note on wiring it into main.c's super-loop. Use
placeholder sensor/actuator hooks I can fill in. Comment the safety interlock.
```

---

## Tips

- Keep the descriptor and the actual `set`/`do`/`TLM` ids **consistent** — the
  ground station reads graphs from `graphs[].id`, rails from `rails[].id`, and
  continuity from `cont1..contN`.
- Start minimal (`p`, `name`, a couple of `tlm` keys). Add fields incrementally;
  unknown descriptor fields are ignored, so nothing breaks.
- Test with the OZONE web dashboard's **simulator**, then point it at your board
  over Web Serial (USB) or WebSocket (a WiFi bridge).

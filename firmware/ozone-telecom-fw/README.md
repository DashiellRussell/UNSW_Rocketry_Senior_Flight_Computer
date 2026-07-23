# OZONE TELECOM hub firmware

ESP32-S3-MINI-1U firmware for the OZONE Telecom board — the comms hub
companion to UNSW Rocketry's OZONE senior flight computer (STM32L452).

## What this does

The STM32 flight computer speaks a plain-text protocol (`fcd/1`, see
`firmware/tools/gcs/PROTOCOL.md`) over a UART: `whoami` -> `FCD1 {json}`,
`TLM key=value ...`, `EVT <name> ...` (flight milestones — LAUNCH, APOGEE,
DEPLOY, PYRO, LANDED), `LOG <level> <msg>`, `get`/`set`/`do ...`. This hub's
entire job is to **relay that stream, unmodified, to/from three independent
radio links at once**, add the local GPS fix as extra telemetry, and mirror
every FC line to its own microSD as an independent flight-record backup:

```
                 ┌───────────────────────────────────────────┐
                 │            ESP32-S3-MINI-1U hub            │
STM32 FC  ──UART──▶ fc_link  ──┬─▶ ws_link   (WiFi WebSocket) │
(FCD/1)   ◀──UART──            ├─▶ ble_nus   (BLE NUS)        │
                 │             ├─▶ lora_link (E22/SX1262 SPI) │
                 │             └─▶ sd_log    (microSD backup) │
                 │                                            │
                 │  gnss_link (MAX-M10S UART, RX only) ───────┼─▶ extra TLM
                 └───────────────────────────────────────────┘
```

Commands travel the other way from any of the three radios straight back to
the FC over UART, byte-for-byte, unmodified. **This hub never originates,
rewrites, filters, or replays a command** — it is a transparent pipe. The FC
alone is the safety authority for arm/fire (see
`docs/telecom-command-protocol.md` and
`firmware/ozone-fw/app/Inc/pyro_trigger.h`): key-switch continuity, arm
state, and the `fire_mode` token/CRC/seq handshake are all enforced on the
STM32 side. If you ever feel tempted to add "just a little" smarts here
(auto-retry a fire, cache the last token, etc.) — don't; that's exactly the
kind of hub-side logic that turns a safe two-board design into an unsafe one.

## Radios

| Link | Role | Library |
|---|---|---|
| WiFi | WebSocket server, `ws://<esp-ip>:81/` — any number of GCS/laptop clients | `links2004/WebSockets` |
| BLE | Nordic UART Service (NUS) — any generic BLE-UART phone app | `h2zero/NimBLE-Arduino` |
| LoRa | E22-900M22S (SX1262) transceiver, 915 MHz AU915 | `jgromes/RadioLib` |
| GNSS | u-blox MAX-M10S, NMEA, receive-only | `mikalhart/TinyGPSPlus` |
| SD backup | microSD (J8), independent flight-record mirror, SPI | `SD` (bundled with arduino-esp32) |

**WiFi + BLE coexistence:** the ESP32-S3 has one 2.4 GHz radio shared
(time-sliced) between WiFi and BLE. At this hub's actual data rates — short
text lines a few times a second — that's a non-issue. It would only start to
matter if you tried to push a large file over WiFi (e.g. bulk log download)
at the same moment BLE traffic is heavy; for low-rate telemetry + occasional
commands, both run fine simultaneously.

**LoRa is fully independent** — separate 915 MHz radio, separate SPI bus, no
interaction with the WiFi/BLE 2.4 GHz side at all.

## Framework choice

Arduino-ESP32 via PlatformIO, not raw ESP-IDF. Reasoning: all four
libraries above are mature, actively-maintained Arduino libraries with
first-class SX126x/NimBLE/WebSocket support; reimplementing the BLE GATT
server and LoRa SPI driver from scratch in raw IDF would cost far more time
for no functional benefit on a board that isn't even fabbed yet. Everything
still runs on the same FreeRTOS/lwIP ESP-IDF underneath.

## Pin map

**Derivation method:** every pin below was reverse-engineered from the real
schematic (`ozone_telecom/ozone_telecom.kicad_sch`) by matching each net's
`global_label` coordinate against the ESP32-S3-MINI-1U symbol's pin-offset
table (symbol placed at `(81.28, 96.52)`, rotation 0°; absolute pin position
= placement + pin offset). Where that produced a clean, unambiguous match
against a single named GPIO pin, it's marked **CONFIRMED**. One net pair
could not be resolved this way and is marked **CONFIRM** — see below.

| Signal | ESP32-S3 GPIO | Status | Notes |
|---|---|---|---|
| E22 MISO | IO3 | CONFIRMED | shares ESP32 JTAG-select strap pin — fine as plain GPIO post-boot |
| E22 MOSI | IO5 | CONFIRMED | |
| E22 SCK | IO4 | CONFIRMED | |
| E22 NSS (CS) | IO6 | CONFIRMED | |
| E22 BUSY | IO7 | CONFIRMED | poll before every SPI transaction (SX1262 requirement) |
| E22 NRST | IO8 | CONFIRMED | active low |
| E22 DIO1 | IO2 | CONFIRMED | SX1262 IRQ (TX/RX done, timeout) |
| E22 RXEN | IO0 | CONFIRMED | **shares ESP32 boot-strap pin** — verify RXEN's power-on default doesn't fight the boot-mode strap; flagged for bring-up |
| E22 TXEN | IO1 | CONFIRMED | |
| GNSS TX -> ESP RX | IO39 | CONFIRMED | NMEA out from MAX-M10S |
| GNSS RX <- ESP TX | IO38 | CONFIRMED | wired through for UBX config, rarely used (module is otherwise RX-only per hardware) |
| GNSS PPS | IO37 | CONFIRMED, but see caveat below | |
| I2C SDA | IO13 | CONFIRMED | |
| I2C SCL | IO44 (native `RXD0`) | CONFIRMED | UART0 not used as a console here, repurposed as GPIO |
| RGB status LED | IO43 (native `TXD0`) | CONFIRMED | repurposed, same reasoning |
| Servo enable | IO9 | CONFIRMED | not driven by this firmware (no servo function implemented yet) |
| Servo PWM | IO20 (native `USB_D+`) | CONFIRMED | repurposed; USB isn't wired out on this board |
| Buttons BTN1/2/3 | IO12 / IO11 / IO10 | CONFIRMED | bench/debug buttons, unused by this firmware |
| VBAT_SENSE (ADC) | IO15 | CONFIRMED | unused by this firmware; hub power monitoring, add if wanted |
| FC_3V3_SENSE (ADC) | IO14 | CONFIRMED | ditto |
| CAN RX/TX (SN65HVD230, bonus) | IO21 / IO26 | CONFIRMED | not used by this firmware |
| microSD SCK/MISO/MOSI/CS (J8, flight backup) | IO36 / IO35 / IO34 / IO33 | CONFIRMED | used by `sd_log.cpp` — independent FCD backup, own SPI bus (`FSPI`) separate from the E22's `HSPI` |
| **FC UART TX** | **IO17 (placeholder)** | **CONFIRM — SEE BELOW** | |
| **FC UART RX** | **IO18 (placeholder)** | **CONFIRM — SEE BELOW** | |

### The one pin pair you must verify before flashing: the FC UART link

The `TELECOM_TO_OZONE` / `OZONE_TO_TELECOM` nets — the actual FCD-over-UART
link to the STM32 — did **not** resolve cleanly against a plain GPIO pin
using the same coordinate-matching method that nailed every other net on
this board. The coordinates land right next to the ESP32 module's `EN`
(chip-enable/reset) pin cluster instead of a clean data-GPIO pair, which is
suspicious — either (a) it really is a reset/status line rather than the UART
data pair, or (b) the net routes through a connector on
`peripherals.kicad_sch` in a way this parse didn't fully resolve.

**Action for Dash:** open `ozone_telecom.kicad_sch` in KiCad, click the
`TELECOM_TO_OZONE` and `OZONE_TO_TELECOM` labels, and use
*Inspect > Highlight Net* (or just follow the wires) to read the real ESP32
GPIO numbers, then update `PIN_FC_UART_TX` / `PIN_FC_UART_RX` in
`include/config.h`. The firmware builds and can be bench-tested with jump
wires in the meantime — the placeholders (IO17/IO18, ESP32-S3's default
UART1 pins) are only there so nothing is left undefined.

### Other discrepancy worth flagging

`docs/ozone-telecom-routing.md` says *"PPS (GNSS→IO35)"* and *"E22 SPI
(IO10–13) short and grouped"*. The schematic itself (which this pin map was
derived from, and which should be ground truth) instead has GNSS PPS on
**IO37** and the E22 SPI/control group on **IO0–IO8**, with IO35 actually
carrying the (unused-by-this-firmware) microSD MISO line. That routing doc
may simply predate the final schematic revision — flagging so Dash can
reconcile the two rather than silently trusting one.

## SD backup logging (independent flight-record mirror)

The telecom board carries its **own** microSD (J8, Molex 47219-2001, SPI
mode — `Connector:Micro_SD_Card` in `ozone_telecom/peripherals.kicad_sch`),
separate from the flight computer's SD card that logs `OZONE000.CSV` etc.
(`firmware/ozone-fw/app/Src/logging.c`). `src/sd_log.{h,cpp}` mirrors every
line this hub receives from the FC over UART — `TLM`, `EVT`, `LOG`,
`PARAM`, `ACK`, `FCD1` — onto that second card, so if the FC's own card is
ever lost, damaged, or unreadable after recovery, there is still a complete,
independently-wired, independently-powered copy of the flight.

**Pins** (`config.h`, CONFIRMED against the schematic — see the pin-map
table above):

| Signal | ESP32-S3 GPIO |
|---|---|
| SD_SCK  | IO36 |
| SD_MISO | IO35 |
| SD_MOSI | IO34 |
| SD_CS   | IO33 |

No card-detect line is routed to the ESP for J8 — `sd_log_init()` treats a
failed `SD.begin()` as "no card" and just disables the backup for that
boot, the same way the FC's own `logging.c` had to stop trusting its
unreliable PC3 card-detect switch and started using the mount attempt
itself as the presence test.

**File naming:** `TCM000.LOG` .. `TCM999.LOG`, one new file per power-up —
deliberately mirrors the FC's `OZONE000.CSV` .. `OZONE999.CSV` scheme so the
two cards' files are recognisable as siblings of the same flight. Each line
is written as `[<hub millis()>] <verbatim FCD line>`.

**Non-blocking design:** `sd_log_line()` (called once per FC line, right
alongside the WiFi/BLE/LoRa fan-out in `main.cpp`) only appends to a small
RAM buffer — it never touches the SPI bus and is a true no-op if no card is
mounted, so it can never be the thing that stalls the radio relay. The
buffer is flushed to the card in one write+fsync every
`SD_LOG_FLUSH_PERIOD_MS` (500 ms) or sooner if it nearly fills, via
`sd_log_poll()` in the main loop — and immediately after any `EVT` line
(LAUNCH/APOGEE/DEPLOY/PYRO/LANDED), via an explicit `sd_log_flush()` call,
so the rare, safety-relevant lines aren't left sitting in RAM. The SD card
uses its own dedicated SPI bus (`FSPI`) so it can never contend with or
block the E22 LoRa radio's separate `HSPI` bus.

**This is a best-effort backup, not a required subsystem** — a missing,
full, or dead SD card on the telecom board must never affect the WiFi/BLE/
LoRa relay. If `sd_log_init()` fails at boot, or a write fails mid-flight,
the module disables itself for the rest of that boot and logs a warning to
the USB debug console; everything else keeps running exactly as before.

## Build & flash

Requires [PlatformIO](https://platformio.org/) (CLI or the VS Code
extension).

```sh
cd firmware/ozone-telecom-fw
pio run                 # build
pio run -t upload       # flash over USB (board must be in bootloader mode
                         # if it doesn't auto-reset — hold BOOT, tap RESET)
pio device monitor      # USB serial debug console (separate from the FCD
                         # links — this is Serial/USB-CDC, not the FC UART)
```

Before flashing real hardware: set `WIFI_SSID` / `WIFI_PASSWORD` (or flip
`WIFI_AP_MODE` to 1 to have the hub host its own AP instead) and confirm the
FC UART pins in `include/config.h` as described above.

## Connecting a client over each link

**WiFi (WebSocket):** connect to `ws://<esp-ip>:81/` (find the IP via
`pio device monitor` on boot, or check your router, or use the AP's fixed
gateway IP `192.168.4.1` if `WIFI_AP_MODE=1`). Any WebSocket client works —
`wscat -c ws://<ip>:81/`, a browser `new WebSocket(...)`, or the project's
own `firmware/tools/gcs` console if it's given a WS transport. Send a
newline-free text frame containing e.g. `whoami` or `do arm`; receive one
frame per FCD line (`TLM ...`, `LOG ...`, `FCD1 ...`, etc.).

**BLE (Nordic UART Service):** scan for a device named `OZONE-TELECOM`.
Connect with any generic "BLE UART" app (nRF Connect, Serial Bluetooth
Terminal, LightBlue). Subscribe to the TX characteristic
(`6E400003-...CCA9E`) for notifications (the outbound FCD stream); write to
the RX characteristic (`6E400002-...CCA9E`) to send commands. Standard NUS
UUIDs — no custom app needed.

**LoRa:** this is the actual flight radio link, matching the ground
station's own E22-900M22S module (transparent-UART LoRa point-to-point per
`docs/telecom-command-protocol.md`) at 915 MHz / SF9 / BW125 / CR 4:5 / sync
word `0x12`. Point a matching SX1262/E22 ground-station radio at the same
parameters (`firmware/tools/gcs` + a ground E22 module) and it should see
the same FCD lines the WiFi/BLE clients get, one LoRa packet per line.

## Known limitations / TODO for whoever picks this up next

- `whoami`'s `FCD1 {...}` descriptor line, if long, costs meaningful LoRa air
  time per re-send; consider caching it hub-side and only relaying the first
  reply per session if that becomes a problem in practice (would need FC
  buy-in since the FC currently owns that reply, not this hub).
- No local filtering/backpressure if a WebSocket or BLE client is slow to
  drain — `broadcastTXT`/`notify()` calls are fire-and-forget; fine for a
  low-rate text stream, but worth watching if `tlm_hz` gets pushed high.
- VBAT_SENSE / FC_3V3_SENSE ADC pins are wired and documented but not read by
  this firmware yet (not in the task's required scope — the FC already
  reports its own `vbat` in its `TLM` line).
- Buttons/servo/CAN pins are all wired on the board but intentionally
  untouched by this firmware — out of scope for the comms-hub relay job.
  (microSD is now used — see "SD backup logging" above.)
- SD backup logging has not been bench-tested on real hardware (board isn't
  fabbed yet) — the SPI pin assignment is CONFIRMED against the schematic
  using the same coordinate-matching method as every other net on this
  board, but first bring-up should still sanity-check the FSPI bus
  (SCK/MISO/MOSI/CS on IO36/35/34/33) with a real card before trusting it
  in flight.

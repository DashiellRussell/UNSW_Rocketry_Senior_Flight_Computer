# Project OZONE — Handover / Project Status

Start-here doc for the OZONE senior flight computer + telecom + ground station.
Points to the detailed references; captures current state, findings, and the
pre-flight to-do. Last major work: 2026-07 (SD bring-up, FCD telecom protocol,
ground station, noise-robust apogee).

## 1. Repo map

| Path | What |
|---|---|
| `v1.0/`, `v0.0/` | KiCad — the flight computer board (v1.0 = fabbed) |
| `ozone_telecom/` | KiCad — the telecom radio daughterboard (not yet fabbed) |
| `firmware/ozone-fw/` | **STM32L452 flight firmware** — see `firmware/ozone-fw/FIRMWARE.md` |
| `firmware/ozone-telecom-fw/` | **ESP32-S3 telecom hub** (PlatformIO) — FCD relay + dual-SD backup |
| `firmware/tools/gcs/` | Python TUI ground console (predecessor) |
| `firmware/tools/web-dashboard/` | vanilla no-build FCD dashboard (fallback) |
| `ground/web/` | **Next.js ground station** (`/` dashboard, `/protocol`, `/builder`) |
| `docs/` | this file + the references below |

**Key reference docs:** `firmware/ozone-fw/FIRMWARE.md` (onboard code),
`docs/fcd-protocol.md` (the self-describing protocol), `docs/telecom-command-protocol.md`
(fire modes + architecture), `docs/fcd-implementer-prompts.md` (paste-into-AI board
prompts), `docs/antenna-selection-handover.md` (RF/antenna), `docs/ERRATA.md`.

## 2. Build / flash / run

```bash
# --- STM32 flight firmware ---
GCC=/Applications/STM32CubeIDE.app/Contents/Eclipse/plugins/*gnu-tools*/tools/bin
CLI=/Applications/STM32CubeIDE.app/Contents/Eclipse/plugins/*cubeprogrammer*/tools/bin/STM32_Programmer_CLI
cd firmware/ozone-fw/Debug && PATH="$GCC:$PATH" make all      # NB: default goal is `clean`, use `all`
"$CLI" -c port=SWD mode=UR -d ozone-fw.elf -v -rst            # flash via ST-Link (SWD)

# --- Web ground station ---
cd ground/web && pnpm install && pnpm dev                     # http://localhost:3000

# --- ESP32 telecom hub (PlatformIO) ---  (board not fabbed yet)
cd firmware/ozone-telecom-fw && pio run
```
Talk to the board over USB-C CDC (`/dev/cu.usbmodem*`, 115200) with pyserial or the
web dashboard (Web Serial, auto-detects VID 0x0483/PID 0x5740).

## 3. Architecture in one paragraph

The STM32 flight computer speaks a self-describing text protocol (**FCD/1**) over
**USB-C CDC** and **USART2** (header J5). On `whoami` it emits a JSON descriptor and
the ground station auto-builds its whole UI from it. USART2 goes to the **ESP32-S3
telecom hub**, a transparent relay that fans FCD out to **WiFi + BLE + LoRa** and
logs a **backup copy of the flight** to its own microSD. Two SD cards = two
independent flight records (FC `OZONE*.CSV` + telecom `TCM*.LOG`).

## 4. Validation status (READ before trusting anything for flight)

**Proven on hardware:** SD mount + CSV logging; sensor bring-up (2×MS5611 + H3LIS +
LIS3DH on SPI1); USB-C FCD streaming (reliable, uncorrupted); whoami descriptor;
identify (blink+beep); subsystem-health telemetry; analog pyro continuity (reads
when the pyro rail is energised); orientation calibration.

**Written / builds clean but NOT hardware-validated:** USART2 telecom link (same
code path as USB, untested until a hub/adapter is attached); **live pyro FIRING**
(bench never had a pyro pack — arming/continuity/pins are in but no charge has ever
fired); the new noise-robust apogee logic (host-sim-verified only); the ESP hub
firmware (board not fabbed); flight state machine over a real flight profile.

**Not done:** flashed as Debug build (not Release); flight thresholds uncalibrated.

## 5. Major findings & fixes this session

- **SD card would not mount — root cause was firmware, not hardware.** CubeMX
  `BSP_SD_Init` gated `HAL_SD_Init` on the unreliable PC3 card-detect. Fixed by
  overriding `BSP_SD_IsDetected`→present. (The card is FAT32, not exFAT.)
- **ERR-007: the whole pyro pin block + pyro-battery ADC channel in the firmware
  `.ioc` were STALE** — matched neither v0.0 nor v1.0. Corrected via direct
  `ozone_hal.h` overrides (regen-safe). Continuity is an **analog divider on ADC
  pins (PA0/PA1)** — read via ADC + threshold, not digital. This **obsoletes
  ERR-002**. ⚠️ The `.ioc` still needs syncing, and `docs/ERRATA.md` needs the
  ERR-007 entry.
- **Apogee could deploy on ASCENT under baro noise.** The old detector voted on the
  sign of a noisy velocity derivative. Replaced with a **rolling-average
  peak-drop** detector (+ smoothed velocity + time-to-apogee). Host sim: zero
  ascent misfires at ±0.8/±5/±15 m noise (all misfired before at ≥±5 m).
- **USB CDC streaming was corrupt/dropping.** `usb_write` aliased a transient
  buffer into the async CDC transfer and dropped-on-busy. Fixed with an 8 KB TX
  ring (copy + drain-when-idle).
- **Calibrated `imu` orientation** for this board baked into the descriptor:
  `map:[+x,-y,+z], up:+y` (from the dashboard's calibration wizard).
- Added **flight EVENTS** (LAUNCH/APOGEE/DEPLOY/PYRO/LANDED) and **dual-SD backup**.

## 6. Pre-flight to-do (the real remaining work)

1. **Calibrate `ozone_config.h`** (each = reflash): VBAT/pyro divider ratios vs DMM;
   `OZONE_CONT_THRESH_V` with a real pack; `OZONE_APOGEE_DROP_M`/`DEBOUNCE_N`;
   launch/apogee/lockout/main thresholds; pyro fire-pulse ms; buzzer resonance.
2. **Ground-test-fire BOTH channels** with the ERR-007-corrected firmware — the
   fire path has never actually fired. Validate continuity + `cont_cleared`.
3. **Replay real flight logs** — `flight_00X/*.bin` (RKTLOG binaries, backed up to
   `~/Documents/avionics-sd-backup-2026-07-23/`) are actual flights; decode the
   format and run them through `flight.c` to validate apogee on genuine data.
4. **Sync the `.ioc`** to the ERR-007 pin map; add the ERR-007 entry to `ERRATA.md`.
5. **Build a Release config** for flight (currently Debug/-O0).
6. Consider **per-channel e-match redundancy** (single e-match today).
7. **Telecom**: fab the board; verify the FC↔hub UART pins (ESP firmware placeholders)
   and the microSD FSPI bus; then validate the USART2 link + LoRa range.
8. **Security**: a plaintext GitHub token is in local `.git/config` remote URL —
   scrub with `git remote set-url` + rotate on GitHub.

## 7. Connectors & cables (for ordering)

- **FC↔telecom UART link is a connector MISMATCH:** FC `J5` = Molex **PicoBlade**
  1.25 mm 4-pin (GND/TX/RX/3V3); telecom `J9` = JST **GH** 1.25 mm 3-pin
  (GND/OZONE_TO_TELECOM/TELECOM_TO_OZONE). Not cross-compatible — make a spliced
  cable (PicoBlade-4 pigtail + GH-3 pigtail, 3 wires) or standardise next rev.
- **Telecom aux** = JST-**GH** 1.25 mm (3-pin: J9 FC-link/J10 power/J11 servo/J13;
  4-pin: J12 I²C). Buy the **elechawk GH1.25 pre-crimped kit** (covers 3+4-pin,
  spares). GH ≈ the Pixhawk connector → drone shops / LCSC / element14, NOT DigiKey.
- **FC** = Molex PicoBlade for J5; Phoenix 3.5 mm screw terminals for pyro/battery
  (bare wire); Samtec 1.27 mm 10-pin for SWD; microSD socket; USB-C.
- **Antennas** (see `antenna-selection-handover.md`): SMA edge = board female →
  antennas must be **SMA male, NOT RP-SMA**. Selection so far:
  **ANT-916-CW-HW-SMA** half-wave omni (both rocket + ground), U.FL↔U.FL jumpers ×2,
  active-antenna-capable GPS port; 10 km-range Yagi TBD.

## 8. Fire modes (safety) — quick note

Four selectable pyro fire modes (`param fire_mode`, default `session`): `safe`
(per-fire nonce), `session` (flight password), `hot` (rolling token, 1-key
emergency), `direct` (armed→fire). The **external key switch is the non-bypassable
hardware gate in all modes.** Full detail: `docs/fcd-protocol.md` §7.

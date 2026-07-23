# Project OZONE — Onboard Firmware

Flight-computer firmware for UNSW Rocketry's senior 30 km sounding-rocket board
(rev 1.0). STM32L452RET6 (Cortex-M4 @ 80 MHz), STM32Cube HAL, bare super-loop.
This document is the reference for the onboard code as it stands: architecture,
the telecom/console protocol, the pyro safety model, the corrected pin map, and
what still needs doing before flight.

---

## 1. Build & flash

Toolchain lives inside STM32CubeIDE (no separate install needed):

```bash
GCC=/Applications/STM32CubeIDE.app/Contents/Eclipse/plugins/com.st.stm32cube.ide.mcu.externaltools.gnu-tools-for-stm32.*/tools/bin
CLI=/Applications/STM32CubeIDE.app/Contents/Eclipse/plugins/com.st.stm32cube.ide.mcu.externaltools.cubeprogrammer.*/tools/bin/STM32_Programmer_CLI

# build (NOTE: makefile default goal is `clean` — always say `all`)
cd firmware/ozone-fw/Debug && PATH="$GCC:$PATH" make all

# flash over SWD (ST-Link)
"$CLI" -c port=SWD mode=UR -d ozone-fw.elf -v -rst
```

- Current build is **Debug** (`-O0`). Build a Release config before flight.
- SWD is on header **J4/J1** (SWDIO=PA13, SWCLK=PA14, NRST, GND). If the probe
  reads voltage but "no core id", it's almost always loose SWDIO/SWCLK/GND.
- CubeMX regen gotchas (see [`../../docs/`] + memory): set toolchain to
  STM32CubeIDE, tick "copy only necessary library files", and the `app/` module
  is a hand-added sourcePath. New `app/Src/*.c` files must be added to
  `Debug/app/Src/subdir.mk` + `Debug/objects.list` for the CLI build.

## 2. Architecture

CubeMX owns `Core/`, `USB_DEVICE/`, `FATFS/`, `Drivers/`. All flight logic is a
**regen-proof separate module** under `app/` (`Inc/` + `Src/`). Entry points
wired into `Core/Src/main.c`: `ozone_app_init()` (USER CODE 2) and
`ozone_app_run()` (super-loop).

| Module | Role |
|---|---|
| `ozone_hal` | Pin/ADC-channel macros — the contract over CubeMX labels (**see §6**) |
| `ozone_config` | Tunables: thresholds, divider ratios, rates (**calibrate before flight, §8**) |
| `spi_bus` | Shared SPI1 with per-device CS |
| `ms5611` / `h3lis331dl` / `lis3dh` | Barometer (×2), high-g, low-g accel drivers |
| `sensors` | Fuses the four devices into one `sensor_sample_t` |
| `adc_sense` | On-demand ADC reads (vbat, pyro vbat, continuity) |
| `pyro` | Arm/gate/continuity hardware layer (see §5) |
| `pyro_trigger` | Ground→board fire-authorisation state machine, 4 fire modes (§5) — HW-free, unit-tested |
| `flight` | Flight state machine + 2-of-3 apogee voting (HW-free, testable) |
| `indication` | RGB + heartbeat/error LEDs, buzzer (software PWM via TIM6) |
| `logging` | CSV flight log to MicroSD via FatFs/SDMMC |
| `telemetry` | Legacy human-readable status over USART2 |
| `usb_cli` | USB-C CDC transport: RX ring + **TX ring** + line reader |
| `link_uart` | USART2 transport: interrupt RX ring + non-blocking line reader + TX |
| `fcd` | **FCD/1 protocol engine** — descriptor / telemetry / commands (§4) |
| `console` | Legacy interactive USB menu (preflight/test/post-flight) |
| `ozone_app` | Top-level: init, super-loop, arm/fire/log/health hooks |

## 3. Ground links: USB-C and USART2

Two physical links, **same FCD protocol on both**:

- **USB-C CDC** (`usb_cli`) — bench console + Web Serial ground station.
- **USART2** (`link_uart`) — PA2 TX / PA3 RX, **115200 8N1**, header **J5** →
  the ESP32-S3 telecom hub (which relays to WiFi/BLE/LoRa). Interrupt-driven RX.

`fcd_task()` (called every super-loop) reads command lines from USART2 and
emits telemetry to **both** USART2 and USB CDC (when a USB host is attached).
The legacy `console` menu also runs on USB CDC; FCD command lines
(`whoami`/`get`/`set`/`do`) are routed to the FCD engine, everything else to the
menu.

> **TX reliability:** both `usb_cli` and `link_uart` use a **copy-into-ring +
> drain-when-idle** TX path (USB ring is 8 KB). This was essential — passing a
> transient buffer straight to `CDC_Transmit_FS` corrupted in-flight lines, and
> the ~1.6 KB `whoami` descriptor overflowed a smaller ring and truncated. Do
> not revert to a blocking/drop-on-busy `usb_write`.

## 4. FCD/1 protocol (see [`../../docs/fcd-protocol.md`])

Self-describing: on `whoami` the board replies one line, `FCD1 {json}`, listing
its checks / rails / graphs / params / actions / imu / caps. The ground station
auto-builds its entire UI from that — no board-specific UI code.

- **Telemetry:** `TLM key=value …` at `tlm_hz` (default 5). Includes state,
  altitude/velocity, pressure/temp, hi-g/lo-g magnitudes + **per-axis low-g**
  (`lo_gx/lo_gy/lo_gz`), vbat/pyro_v, armed, continuity, and **subsystem-health
  booleans** `pg / baro_ok / accel_ok / sd_ok` that drive the ground checks.
- **Events:** `LOG <E|W|I|D> <msg>`.
- **Commands:** `get`, `set <id> <v>`, `do <id> [k=v]`. Actions: `arm`,
  `disarm`, `identify` (blink+beep), `preflight`, `log_start/stop`, `zero_baro`,
  `flight_mode` (session-key), `prime`, `deploy_ready`, `fire`.
- **Command integrity (optional):** safety commands may carry `seq=N*HH`
  (`*HH` = 8-bit XOR of bytes before `*`); mismatch/replay is rejected.
- **`imu` orientation:** declares the accel axis keys + a calibrated
  sensor→board **`map`** + skyward **`up`** axis (this board: `map:[+x,-y,+z]`,
  `up:+y`), so a ground station renders a correct 3D orientation view.

## 5. Pyro safety & fire modes

Hardware chain (doc §7): opto-isolated low-side N-FET per channel, whole rail
gated by an arm P-FET, powered only when the **external key switch** is closed,
from a **separate pyro battery**. Gates init LOW at boot. `pyro.c` refuses to
fire unless armed. **The key switch is the non-bypassable hardware gate in every
mode below** — software cannot fire without it closed.

`pyro_trigger` governs the ground→board handshake (`param fire_mode`, default
`session`). All four verified with a host unit test (23/23):

| Mode | How to fire | Time-to-fire | Use |
|---|---|---|---|
| `safe` | `prime ch=N` → token → `fire ch=N token=` | 2 cmds | ground tests |
| `session` | `flight_mode` sets a flight key → `fire ch=N token=<key>` | fast | in-flight (default) |
| `hot` | `deploy_ready ch=N` → rolling live token in TLM → 1-key fire | instant | emergency |
| `direct` | armed → `fire ch=N` (no token) | instant | fastest, least safe |

Continuity is an **analog divider on ADC pins** (read + threshold, not a digital
GPIO — see ERR-007/ERR-002 in §7); it reads present only when a bridge is across
the channel **and the pyro rail is energised**.

## 6. Pin map (rev 1.0, as-corrected)

Sensors on **SPI1** with individual CS. SDMMC 4-bit MicroSD. Key pins:

| Signal | Pin | Notes |
|---|---|---|
| SDMMC1 CK/CMD | PC12 / PD2 | 4-bit: D0–D3 = PC8/PC9/PC10/PC11 |
| USART2 TX/RX | PA2 / PA3 | telecom link (J5) |
| USB CDC | PA11/PA12 | (USB DM/DP) |
| PYRO1/2 GATE | **PB14 / PB15** | ERR-007 re-pin |
| PYRO_ARM | **PB13** | ERR-007 re-pin |
| PYRO1/2 CONT | **PA0 / PA1** | ADC IN5/IN6 — analog continuity (ERR-007) |
| PYRO1/2 CONT LED | **PB10 / PB11** | ERR-007 re-pin |
| VBAT sense | PC4 | ADC1_IN13 |
| PYRO_BATT sense | PA4 | ADC1_IN9 (ERR-007: was mis-set to PC5) |
| Buzzer | PB9 | GPIO, software PWM via TIM6 (ERR-001) |

The pyro pins are set **directly in `ozone_hal.h`** (overriding the stale
CubeMX `.ioc`), and PA0/PA1/PA4 are configured analog in `pyro_init()` — both
CubeMX-regen-safe. **The `.ioc` still needs syncing** to this map.

## 7. Errata status (firmware side)

| # | Issue | Firmware handling |
|---|---|---|
| ERR-001 | PB9 buzzer has no timer channel | software PWM off TIM6 ISR |
| ERR-002 | (obsolete) assumed continuity on non-ADC PC6/PC7 | superseded by ERR-007 |
| ERR-004 | no SDMMC pull-ups; card-detect unreliable | slow `ClockDiv=24`; **override `BSP_SD_IsDetected`→present** so mount isn't gated on the bad card-detect pin (this was the real SD fix) |
| ERR-005 | RGB green (TIM1_CH3) OC not PWM | re-armed as PWM in `indication_init` |
| ERR-006 | buzzer very quiet (no discharge R) | drive at resonance; bodge 1k across BZ1 |
| **ERR-007** | **pyro block + pyro-batt ADC re-pinned in HW, firmware `.ioc` stale** | corrected via `ozone_hal.h` overrides + analog continuity on PA0/PA1; **sync the `.ioc`** |

## 8. Before flight — calibrate in `ozone_config.h`

These are placeholders and MUST be bench-calibrated (each change = reflash):

- `OZONE_VBAT_DIV_RATIO` / `OZONE_PYRO_DIV_RATIO` — against a DMM
- `OZONE_CONT_THRESH_V` — continuity node threshold with a real pack
- apogee-detect velocity, launch-detect, altitude lockout, timer backup
- `OZONE_PYRO_FIRE_MS`, `OZONE_GROUND_TEST_DELAY_MS`
- `OZONE_BUZZER_RESONANCE_HZ` (loudest freq from the buzzer sweep test)

## 9. Validation status

- **Verified on hardware:** SD mount + CSV logging, sensor bring-up (baro/accel
  on SPI1), USB-C FCD stream (reliable, complete lines), whoami descriptor,
  identify, health telemetry, orientation calibration.
- **Written, not yet hardware-validated:** USART2/telecom link (same code path
  as USB, untested until the hub/adapter is attached); live pyro **firing**
  (bench had no pyro pack — arming/continuity logic is in but never fired);
  flight state machine in a real flight profile.
- Not flashed for flight: still the Debug build; config thresholds uncalibrated.

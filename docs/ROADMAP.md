# Project OZONE — Hardware Roadmap

Planned hardware revisions beyond the fabricated **rev 1.0**. Detailed
root-cause/fix writeups for rev-1.0 issues live in [`ERRATA.md`](ERRATA.md);
this file is the forward-looking summary of what each future board should add.

Versioning follows the repo convention (see top-level `README.md`): each rev is
its own self-contained folder. Next board = **rev 1.1**; the bigger comms
overhaul = **rev 2.0**.

---

## Rev 1.1 — "fix-and-polish" + expansion (next fab)

Originally scoped as a drop-in errata pass. **Expanded (2026-07-07)** to also
absorb the pin-hungry changes that were going to force an MCU swap anyway for
rev 2.0 — see "MCU upgrade" below. Two work streams in one board so the
silicon only changes once.

### A. Errata fixes (unchanged from original scope)

1. **Buzzer — make it actually loud.** Pick ONE:
   - **Add a ~1 kΩ discharge resistor across the BZ1 pads** (parallel with the
     piezo). This is the bench-proven fix already bodged onto rev 1.0 — just put
     it on the schematic + BOM so it ships by default. The piezo (CUI
     CPT-9019S-SMT) is a capacitor; with no discharge path the low-side FET only
     charges it once per edge → faint click. RC ≈ 12 µs with 1 k ≪ the 125 µs
     half-period at 4 kHz, so it fully swings 0↔3.3 V each cycle. **Do NOT** add a
     flyback diode (that's for inductive buzzers). *(ERR-006)*
   - **Or swap the part** for a louder / self-driving (magnetic, built-in-drive)
     buzzer if a discharge-resistor fix isn't enough for recovery audibility.
     Then drive from 5 V/VBAT or push-pull (BTL) from two GPIOs to exploit the
     25 Vp-p rating. *(ERR-006)*

2. **Program over ST-Link (SWD) OR USB-C — both paths, confirmed requirement
   (2026-07-07).** Today USB-C is console + log download only — flashing is
   SWD-only because **BOOT0 (PH3/pin60) is tied to GND with no jumper**, so the
   ROM USB-DFU bootloader is unreachable. Fix in hardware:
   - **Break BOOT0 from GND and add a momentary push-button, BOOT0 → 3V3**
     (keep the existing 10 k as the pull-down so default boot is still from
     flash without the button held). Confirmed 2026-07-07: **buttons, not
     just a jumper/test point** — needs to be operable by hand with no tools.
   - **Add a second momentary push-button on NRST → GND** (standard STM32
     reset-button pattern: switch + small ~100 nF debounce cap to GND; NRST
     already has its internal pull-up). Rev 1.0 has **no onboard reset
     button today** — NRST is only reachable via the SWD header (J1) or a
     power cycle, so this is new, not a fix. Needed for the DFU entry sequence
     below and for general bench use without an ST-Link attached.
   - Together these give the standard **BOOT+RESET dev-board sequence**: hold
     BOOT0, tap RESET, release BOOT0 → board comes up in ROM USB-DFU with
     **zero tools** (no ST-Link, no debugger) → flash with STM32CubeProgrammer
     / `dfu-util` over USB-C. **No firmware support needed** — works even on a
     bricked board.
   - The USB data path is already correct (PA11/PA12 ↔ USBLC6 U8 ↔ USB-C J3, CC
     5.1 k Rd), so this is purely the BOOT0 strap. *(ERR-007)*
   - *Firmware alternative (no PCB change, but weaker):* add a `usb_cli` command
     that jumps to system memory (`0x1FFF0000`) → ROM DFU comes up over USB.
     Needs working firmware to trigger, so it can't recover a bricked board —
     SWD stays the recovery path. Worth adding regardless for convenience.
   - **Keep the SWD header (J1: SWDIO/SWCLK/SWO/NRST/3V3/GND) exactly as-is** —
     it stays the ST-Link path and the only way to recover a board with a
     corrupted USB stack/bricked DFU, so USB-C is additive, not a replacement.
   - **Re-verify on the L4R5 MCU swap (§B.1):** BOOT0, USB OTG FS pins
     (PA11/PA12), and the SWD pins (PA13/PA14/PB3) all exist on the L4R5 but
     land on **different physical pin numbers** on the LQFP144 package than on
     the old LQFP64 — re-check the datasheet pinout table and update the
     schematic/CubeMX pin assignment, don't assume the same pin numbers.

3. **Hardware-PWM buzzer pin** — move the buzzer FET gate off PB9 (no timer) to a
   timer-capable pin (PA15→TIM2_CH1 or PB4→TIM3_CH1), freeing the CPU from the
   software-PWM ISR. *(ERR-001)*

4. **Analog pyro continuity** — move PYRO1/2_CONT off PC6/PC7 (not ADC-capable)
   to ADC pins (PA4→IN9, PA0→IN5) for true voltage readback instead of go/no-go.
   *(ERR-002)*

5. **SDMMC pull-ups** — add 47 k to 3V3 on D0–D3 + CMD so the SD clock can run
   full-speed instead of the throttled ClockDiv workaround. *(ERR-004)*

6. **Doc cleanup** — correct the connector tables (USB-C = console + log
   download, not firmware update) and the TIM17 reference. *(ERR-003, ERR-007)*

### B. Demo-board expansion (added 2026-07-07, Dash's requirements)

Purpose: turn rev 1.1 into a **demo/teaching board** — cheaper redundant
sensors, more pyro channels to show off staged deployment, and expansion
headroom for radios — without touching the flight-proven sensor stack
(SPI1: dual MS5611 + H3LIS331DL + LIS3DH stays exactly as-is).

1. **MCU upgrade — L452 (LQFP64) is out of pins.** Adding a 2nd SDMMC, 2 more
   pyro channels, 2 more sensors, and a real expansion header does not fit in
   the ~51 usable GPIO on the current STM32L452RET6, even after the ERR-001/
   ERR-002 pin frees. Rather than swap silicon again for rev 2.0's LoRa/BLE/GPS
   (roadmap already flagged that as tight), **do the MCU swap once, now**, sized
   for both rev 1.1 and rev 2.0 needs.
   - **Recommended: STM32L4R5ZIT6** (LQFP144, same L4 family/toolchain/HAL
     generation as the L452 so `ozone_hal.c` porting is mostly pin renumbering,
     not a rewrite). Gives: **2× SDMMC** (true dual hardware SD, not one real +
     one bit-banged), **3× SPI**, **4× I2C**, **3× USART + 2× UART + LPUART**,
     ~114 GPIO, 2 MB flash / 640 KB RAM (miles of headroom over the 89 KB/14 KB
     rev-1.0 firmware footprint).
   - Cheaper fallback if L4R5 is hard to source: **STM32L476VGT6** (LQFP100, 1×
     SDMMC only — 2nd SD would need to fall back to SPI mode, see below).
   - Action: re-run CubeMX against the new part, remap `ozone_hal.h` pin labels,
     re-check the CMSIS "copy only necessary files" gotcha from the last regen.
   - **This is a bigger change than a drop-in rev** — budget real bring-up time
     (new footprint, new decoupling/BGA-adjacent routing if QFN, re-verify all
     AF mappings). Flagged so it doesn't get scoped like the pure-errata items.

2. **Dual redundant locking SD cards.** Two full-size **SD card sockets with a
   hinged push-to-close latching lid** (insert card, close the door, it
   physically locks shut — not a spring push-push microSD socket). This is a
   distinct connector family from the current microSD holder.
   - **Open item — need a specific part.** Search terms for LCSC/Digikey:
     "SD card connector, hinge type, push-push with lock" or "SD card socket
     SIM/SD combo hinged". Candidates to pull datasheets on: **Amphenol
     GSD1-8G-something / Attend 112B series / TE 2041131-x hinged SD
     sockets** — need to confirm exact part + footprint together before
     committing to the KiCad library.
   - Wire both to the L4R5's **SDMMC1** and **SDMMC2** (4-bit each) for true
     parallel/redundant logging — not one SDMMC + one SPI-bitbanged card.
   - Firmware: `logging.c` needs a second FatFs volume + a redundancy policy
     (mirror both cards? primary + backup? round-robin?) — **decide this
     before writing it**, it changes the API shape.

3. **Demo sensors — dual-redundant, cross-brand pair, for 4 baros / 4 accels
   board-wide (added 2026-07-07, spec'd to 3,000 ft / 16 g on 2026-07-07).**
   Kept off SPI1 deliberately so the existing flight sensor stack/firmware is
   untouched. Counting the flight stack (2× MS5611 + H3LIS331DL + LIS3DH =
   2 baros + 2 accels), doubling the demo sensors gets to the target 4-and-4.
   Each demo pair is **two different brands** (so a bad batch/part-specific
   erratum can't take out both units at once) but **the same communication
   protocol (I2C)** across the pair, so the wiring/bus design stays identical
   regardless of which unit is populated:
   - **Pressure ×2, different brands:** Bosch **BMP390** + STMicroelectronics
     **LPS22HB** — both I2C (also SPI-capable if ever needed), both ~$2–5.
     Range: BMP390 300–1250 hPa, LPS22HB 260–1260 hPa — 3,000 ft is only a
     ~908 hPa reading (vs. ~1013 hPa at sea level), so **both cover it with
     huge margin**, nowhere near their floor. 2× MS5611 + BMP390 + LPS22HB =
     **4 baros**.
   - **Acceleration ×2, different brands:** Analog Devices **ADXL345**
     (±16 g, I2C/SPI, ~$2–4) + Bosch **BMA400** (±16 g, I2C/SPI, ultra-low-power,
     ~$1–2) — both hit the **16 g** spec exactly at their top range setting.
     H3LIS331DL + LIS3DH + ADXL345 + BMA400 = **4 accelerometers**.
   - **Bus topology — two independent I2C buses, not one shared bus.** Rather
     than stack all 4 demo parts on one I2C2 (which was the original plan),
     split into **two full redundant sensor sets, each on its own bus**:
     - **I2C2:** BMP390 + ADXL345 (set A)
     - **I2C3:** LPS22HB + BMA400 (set B)
     This way a single bus fault (stuck SDA/SCL, ESD event, cold joint, address
     conflict with a future addon) only takes out one *complete* baro+accel
     set, not both readings of one sensor type — which is the actual point of
     "redundant" for a demo. Cost: 2 extra GPIO (I2C3 SDA/SCL) vs. the
     single-bus plan — trivial on the L4R5's 4× I2C peripherals and ~114 GPIO,
     wasn't worth it on the pin-starved L452 but is now. No address-select
     strapping needed since each part is alone with its own bus (default
     address is fine).
   - Firmware: `sensors.c` needs a redundancy/voting policy across the two
     sets (median-of-2? flag-on-mismatch? same question as the dual-SD policy
     in item 2) — worth deciding both together since they're the same shape
     of problem.

4. **Pyro channels: 2 → 4.** Same topology as rev 1.0 per channel (opto-isolated
   PC817 → low-side AO3400A N-FET, shared AO3401A arm P-FET off the separate
   pyro battery) — just replicate the fire-GPIO + continuity pair twice more.
   With the L4R5's ADC reaching far more pins, all 4 continuity lines can be
   true analog readback from day one (no ERR-002-style workaround needed).
   GPIO cost: 4× fire + 4× continuity-ADC + 1 shared arm = 9 pins (vs 5 today) —
   trivial on the new part.

5. **Expansion / addon connector(s) — for GPS, LoRa, Bluetooth modules later.**
   Per your note: **not bare 0.1" pin headers** — you want something that
   won't get plugged in backwards on a board other people will handle. Proposed
   shape (confirm before layout):
   - **One shared "radio/GPS" expansion connector**, keyed and locking
     (**JST-GH 1.0 mm pitch** is the common low-profile keyed choice for this —
     shrouded, polarized, cheap, hand-solderable), broken out with everything a
     typical module needs so LoRa (SX1262-class), GPS (u-blox MAX-M10-class),
     and a BT/BLE UART module can each be wired up without a respin:
     - 1× dedicated **SPI** (SPI2 or SPI3 — NOT SPI1) + 2–3 spare GPIO (IRQ/BUSY/
       RESET) → LoRa
     - 1× dedicated **UART** → GPS
     - 1× dedicated **UART** → BT/BLE module
     - 1× spare **I2C** (separate from the demo-sensor I2C2) for anything I2C
     - 3V3, VBAT (for modules needing >3.3 V or wanting to sense battery), GND
   - Could be one big connector or three small module-specific ones — **decide
     once you've picked actual GPS/LoRa/BLE part numbers**, since pinout
     order should match the chosen breakout/module footprints where possible.
   - This is exactly the pin budget rev 2.0 already flagged as tight on the
     L452 — the L4R5 swap in item 1 is what makes this section fit.

6. **Power to the expansion connector(s) — needs more than just tapping 3V3
   (flagged 2026-07-07).** Signal pins aren't the only thing the addon
   header needs; the existing power chain (LiPo → reverse-prot P-FET → 1 A
   polyfuse → TPS63060 buck-boost @3.6 V → SPX3819 LDO @3.3 V, which the whole
   rev-1.0 board runs from) was sized for the **old** load (1 MCU + 4 flight
   sensors + 2 pyro opto/FET gates). Everything added in this rev stacks on
   top of it: MCU swap to a bigger/hungrier L4R5, dual SD (two cards drawing
   write-current simultaneously if mirrored), 4 demo sensors, 4 pyro channels'
   opto/gate drive, **plus** whatever gets plugged into the expansion
   connector(s). Open items to resolve before finalizing the power sheet:
   - **Redo the current budget from scratch**, don't assume rev-1.0 headroom
     carries over. Rough shape of the new loads: LoRa TX bursts ~120 mA
     @+20 dBm (spiky, sub-ms), GPS module ~25–50 mA acquisition, BLE module
     ~10–20 mA with its own TX spikes, a 2nd SD card writing concurrently, plus
     the L4R5 itself likely pulling more than the L452 at similar clock. Check
     this total against both the **TPS63060's rated output current** and the
     **SPX3819 LDO's current rating** — the LDO stage in particular is the
     one most likely to run out of headroom first, since everything downstream
     of it shares one regulator today.
   - **Consider giving the expansion connector(s) their own regulator/rail**
     instead of tapping the shared MCU/sensor 3V3 directly. Two reasons: (1) a
     LoRa TX current spike sagging the shared 3V3 rail risks a brown-out reset
     or corrupting an analog baro/accel reading at the exact moment you're
     transmitting; (2) it lets you **gate power to unpopulated addon slots**
     (a GPIO-controlled P-FET load switch per connector) so a module that
     isn't installed — or one that's hung/misbehaving — doesn't draw quiescent
     current or need a full board power-cycle to reset. Cheap to add (one
     P-FET + one GPIO per addon rail), and useful for a demo board that will
     get modules swapped in and out a lot.
   - **Local bulk capacitance right at each connector** (100–220 µF) for the
     LoRa/GPS TX current spikes regardless of which rail they're on — same
     point already flagged in the rev-2.0 LoRa section, just make sure it's on
     the expansion connector footprint itself, not just "somewhere on the
     board."
   - **Expose raw VBAT (unregulated) as well as regulated 3V3** at the
     connector (already in item 5's pin list) — some modules run their own
     onboard 3.3 V/5 V regulator and would rather take raw battery than be
     double-regulated through the board's LDO.
   - **Re-check the 1 A polyfuse rating** against the new worst-case combined
     current (MCU + sensors + dual SD + both radios transmitting at once,
     even if that's a rare overlap) — don't assume it still has margin.
   - This needs an actual number-by-number budget spreadsheet once part
     numbers for the LoRa/GPS/BLE modules are picked (item 5) — flagging the
     shape of the problem now so it doesn't get missed when the schematic
     gets drawn.

7. **Doc/BOM follow-up once parts are chosen:** update this roadmap's pin table,
   `ozone_hal.h`, the BOM, and `ERRATA.md` cross-references once the SD holder,
   expansion connector, and MCU final part numbers are locked in.

---

## Rev 2.0 — wireless comms + position (LoRa, Bluetooth, GPS)

Goal: add **long-range LoRa telemetry**, **native Bluetooth**, and **on-board
GPS** so pre-flight checks, live downlink, and position/recovery don't depend on
a tethered UART/USB or the bolt-on BT module.

> Early planning — capture intent now, refine when rev 1.1 is proven.
> **LoRa role still TBD** — decide whether it's the primary downlink or a backup
> before committing layout/RF effort (see open questions). For now: include it,
> scope its role later.
>
> **Pin budget resolved by rev 1.1 (2026-07-07):** the MCU swap to STM32L4R5
> and the keyed expansion connector(s) in rev 1.1 §B.5 already reserve a free
> SPI (LoRa), 2 free UARTs (GPS + BLE module), and a free I2C for this section.
> Rev 2.0 is now mostly "populate the connectors with real modules + antennas +
> RF layout", not a fresh pin-budget fight.

### LoRa (long-range downlink)
- **Module candidates:** SX1276/78 (sub-GHz, classic, lots of libs) or **SX1262**
  (newer, lower power, better link budget) — or an integrated module
  (RFM95W / Ebyte E22) to skip the RF layout. Module-first is the safer call for
  a student project unless someone owns the RF design.
- **Band:** **915 MHz** ISM for Australia (AS923 / AU915) — confirm legal channel
  plan and antenna for the launch site.
- **MCU interface:** SPI + a couple of GPIOs (DIO IRQ, NRST, optional BUSY for
  SX1262) — uses the dedicated LoRa SPI + GPIOs already reserved on the rev-1.1
  expansion connector (§B.5), not SPI1 (still flight-sensor-only).
- **Antenna:** u.FL/SMA + matching; keep RF away from the digital/pyro section
  and the metal airframe; plan ground-plane and keep-outs early.
- **Power:** LoRa TX bursts are spiky (~120 mA @ +20 dBm on SX1262) — verify the
  TPS63060 buck-boost headroom and add local bulk capacitance at the module.

### Bluetooth (short-range pre-flight)
- **Decide integrated vs module:**
  - **Module (lowest effort):** keep a UART BLE module (e.g. an nRF52-based
    module) on the existing UART header path — minimal redesign, just make it a
    proper footprint instead of a flying header.
  - **Integrated MCU (bigger change):** move to an MCU with built-in BLE
    (STM32WB55 = Cortex-M4 + BLE radio, fairly close to the L452 toolchain; or an
    nRF52840). This is a **processor swap** → effectively a new flight computer,
    not a tweak. Only do this if BLE is core, not nice-to-have.
- **Recommended path:** keep the L452 + a BLE *module* for rev 2.0 to limit risk;
  reserve the STM32WB/nRF integrated route for a later "clean-sheet" board.

### GPS (position / recovery)
- **Module candidates:** u-blox **MAX-M10** (low power, GPS+GNSS, easy to source)
  or NEO-M9N for more performance. Module-level keeps RF/layout simple.
- **MCU interface:** UART (NMEA/UBX) is simplest; I2C also available on u-blox.
  Budget a spare UART — the rev-1.0 UART header (USART2, PA2/PA3) is currently
  the Bluetooth path, so GPS likely needs its **own UART** (USART1 PA9/PA10 or
  LPUART) or shares the bus with care.
- **Antenna:** active patch antenna + LNA bias; needs clear sky view and
  separation from the LoRa/BLE radios — fold this into the rev-2.0 RF survey.
- **Altitude caveat:** standard GPS modules are **CoCom-limited (lock drops above
  ~18 km and/or >515 m/s)** — for a 30 km sounding rocket confirm the module has
  a selectable **"airborne <4g" dynamic model** and check the altitude/velocity
  limits, or GPS will drop out at apogee exactly when you want it.
- **Role:** primarily recovery + post-flight track; not a flight-control sensor.

### Rev 2.0 open questions (resolve before layout)
- Is LoRa the *primary* downlink (then it needs range-test priority) or backup to
  the existing comms?
- BLE module vs integrated-radio MCU — see trade-off above. Drives whether rev
  2.0 is an incremental add or a redesign.
- ~~Pin/peripheral budget~~ — **resolved**: rev 1.1's L4R5 swap + expansion
  connector reserve SPI/UART/UART/I2C for LoRa/GPS/BLE up front.
- Antenna placement & airframe RF survey (LoRa + BLE + GPS, three antennas) —
  plan co-existence and sky view early.
- GPS dynamic model: confirm the chosen module supports the airborne/high-altitude
  mode so it survives apogee on a 30 km flight.

# OZONE Telecom — PCB Routing Considerations

Companion to `lora-radio-board.md`. 4-layer board (F.Cu / In1.Cu=GND / In2.Cu=PWR / B.Cu). Emphasis on RF, since three antennas + a LoRa PA + three switching regulators share a small board — the failure modes are coupling and desense, not DC.

## 0. Stackup & the golden rule
- **In1.Cu = solid, unbroken GND** directly under F.Cu. This is the reference plane for every RF trace and the return path for every switching loop. **Do not route signals through it.** If you must cross it, keep cuts tiny and never under an RF trace or a switch node.
- Order of priority when placing: **RF first, regulators second, everything else fills in.** RF and switchers can't be "fixed in routing" — they're won or lost in placement.

## 1. RF — the three antenna chains
All three exit on edge-mount SMAs. Two (E22, ESP) are fed by a module U.FL → **relay U.FL → short 50 Ω trace → SMA**; GPS is **RF_IN → DC-block → 50 Ω trace → SMA**.

### 50 Ω microstrip
- Reference to In1.Cu GND. On a typical 4-layer JLC-style stack (~0.2 mm F.Cu→In1 prepreg, εr≈4.3), **50 Ω ≈ 0.34–0.40 mm trace width** — **confirm against your fab's actual stackup** with a field calculator (KiCad's built-in, or the fab's). Set this as a net-class width so it's consistent.
- **Keep every RF trace as short and straight as possible.** Relay-U.FL right next to its SMA; GPS RF_IN → SMA a few mm. No stubs, no vias in the RF path if avoidable (each via is an impedance discontinuity — if unavoidable, add ground vias beside it).
- **Ground keep-out + via fence:** flood GND on F.Cu either side of each RF trace (coplanar-ish), stitch with GND vias every ~2–3 mm along both sides, and pull other signals back. Solid GND on In1 continuous under the whole RF trace.
- **No RF trace over a plane split or over the switch node of any regulator.**

### Antenna separation & keep-outs (placement)
- **GPS is the victim; the E22 PA and the switchers are the aggressors.** Put the **GPS SMA + RF_IN + bias-T at the opposite end of the board from the E22**, and away from all three TPS630701 switch nodes. 915 MHz PA harmonics and 2.4 MHz switching noise both desense a GNSS front end — this is the single most common cause of "GPS won't lock on a custom board."
- Physically separate the **2.4 GHz (ESP)** and **915 MHz (E22)** SMAs; don't run their traces parallel.
- **Keep both module U.FL connectors physically accessible** (clearance/headroom) — the fallback plan is to unplug the relay jumper and go module-U.FL → antenna directly. A buried U.FL kills that option.

### GPS front end (active antenna)
- RF_IN → **100 pF DC-block (C0G)** → 50 Ω trace → SMA. **ESD diode at the connector** (antenna-facing).
- Bias-T: **VCC_RF → 27 nH → antenna node** (between DC-block and SMA), 100 nF on VCC_RF. Keep the bias inductor's junction tight to the RF trace; the inductor and DC-block are in the sensitive path — short, tight, over solid GND.
- Ground the SMA shell tabs straight into In1 with a via cluster at the connector.

## 2. Switching regulators (3× TPS630701/2, RNM)
These are the noise sources. Each buck-boost:
- **Tight hot loop:** CIN and the inductor and the VIN/VOUT/switch pins form the high-di/dt loop — keep CIN within ~2 mm of VIN, inductor adjacent to L1/L2, COUT close to VOUT. Minimise the loop *area*.
- **Switch node (L1/L2 copper) small and away from everything RF and from the analog senses.** Never route it near GPS RF_IN, the ADC senses, or under an antenna.
- **Thermal/return:** the RNM package has **no central pad** — heat and ground leave through the **power pins**. Pour generous copper on **VIN (12/13), VOUT (7/8), PGND (10)** and stitch each to In1 with a via cluster. This is both the thermal path and the ground return.
- **FB (pin 5) → VOUT** is a sensitive high-impedance node (fixed parts tie it straight to VOUT) — keep that short tap away from the switch node.
- **SYS bulk cap** (100 µF) near the regulator inputs / LTC4412 output; short fat traces from SYS to the three VIN pairs.
- **Servo rail:** its output current is large and pulsed. Route **+5V_SERVO and its return as a tight pair** to the servo header, with the 4× 47 µF bulk right at the reg output; keep the servo return current off the quiet analog/RF ground region (let it return locally to the reg, then to the plane).

## 3. PowerPath / battery front end
- **INA226 shunt: Kelvin-connect.** The IN+ / IN− sense traces tap the shunt pads *at the pads themselves* (Kelvin), routed as a close pair back to the INA226; don't share the high-current path. Shunt sits in the battery leg (F_BAT → shunt → VBATT).
- LTC4412 + battery P-FET: keep the P-FET, SENSE, and VIN close; the P-FET carries full system current — adequate copper.
- **High-current path** (battery → fuse → shunt → P-FET → SYS → regulator VINs): wide traces / copper pours, short. Up to a few amps.
- VBAT_SENSE / FC_3V3_SENSE dividers: high-impedance ADC nets — keep short, away from switch nodes and the servo rail.

## 4. Grounding
- One solid GND (In1). Stitch liberally board-wide, and densely around: each regulator, each SMA, the E22, the GPS front end, and the ESP module pad area.
- Let **noisy return currents** (regulator loops, servo) return locally to their source before merging into the plane — placement achieves this, not a split plane. **Avoid deliberately slotting the ground plane** unless you fully understand the return path; a slot under an RF or switch trace is worse than no slot.
- ESP32-S3 module: ground the exposed thermal/GND pads with a via array to In1.

## 5. Digital / interface
- **E22 SPI (IO10–13) short and grouped**; it's fast SPI. Keep away from the switch nodes.
- **microSD SPI** on its own bus already (SPI3) — route as a group; series 22–33 Ω on SCK/MOSI only if you see ringing.
- **I2C** (SDA/SCL) — modest speed, just keep off the switch nodes; pull-ups already on the ESP side.
- **USB D+/D−**: route as a **90 Ω differential pair**, short, matched length, over solid GND, through the USBLC6 with the ESD device close to the connector. (First fix the open USB net — see schematic review.)
- **PPS (GNSS→IO35)**: it's a timing reference; keep it clean-ish but it's low-rate, no special care beyond avoiding the switch nodes.

## 6. Thermal
- Three switchers + the E22 PA are the heat sources. Copper pours + via stitching on the regulator power pins double as heatsinks; give them board area.
- Bottom-side TMP1075 sensors: place **directly under each regulator** and under the GPS, with a **thermal-via cluster** coupling the hot chip's pads/plane through to the sensor so it tracks die temp.
- Keep the E22 PA area from cooking the GPS/temp-sensitive parts.

## 7. Pre-fab checklist
- [ ] 50 Ω net-class width set from the **real** fab stackup; RF traces short, ground-fenced, over unbroken In1.
- [ ] GPS front end far from E22 + switch nodes; ESD + bias-T tight.
- [ ] Regulator hot loops tight; switch nodes small and isolated; power-pin copper + vias for thermal/ground.
- [ ] INA226 Kelvin sense; high-current path wide.
- [ ] USB diff pair 90 Ω (after fixing the open USB net); ESD near connector.
- [ ] Ground stitched board-wide; no plane slots under RF/switch traces.
- [ ] Module U.FLs accessible; SMAs edge-placed and silk-labeled 915/2.4/GPS.
- [ ] DRC clean; Edge.Cuts closed; SMA/edge footprints straddle the board edge correctly.

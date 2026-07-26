# OZONE Telecom — Antenna Selection Handover

Purpose: brief a fresh agent to help pick antennas + RF jumpers for the OZONE Telecom board. Everything needed is here; no prior context required. Board is UNSW Rocketry's AURC telemetry board (companion to the OZONE senior flight computer).

## 1. What the board is / the RF architecture

Three radios, three separate antenna chains, all exiting on **board-edge SMA connectors**:

| Radio | Chip/module | Band | TX or RX | Antenna port on board |
|---|---|---|---|---|
| LoRa telemetry (the flight link) | Ebyte **E22-900M22S** (Semtech SX1262) | **915 MHz** (AU ISM 902–928) | **Transceiver** (TX up to 22 dBm + RX) | edge SMA |
| BLE / Wi-Fi | **ESP32-S3-MINI-1U** | **2.4 GHz** | Transceiver | edge SMA |
| GNSS | u-blox **MAX-M10S** | **GPS L1, 1575 MHz** | **Receive only** | edge SMA |

**Connector details (important for ordering):**
- All three board SMAs are **standard SMA, female jack** (Amphenol 132289 edge-mount). → **Antennas must be standard SMA *male*.** **NOT RP-SMA** (RP-SMA is the Wi-Fi-consumer variant and will not mate — a real trap for cheap 2.4 GHz antennas).
- LoRa & ESP: the module has its own **U.FL** connector → a short **U.FL-to-U.FL jumper** goes to an **onboard relay U.FL** → short 50 Ω trace → the edge SMA. **Fallback:** unplug the jumper and run the module U.FL straight to an antenna via a U.FL-to-SMA pigtail (bypasses the board trace). So the SMAs are mainly for the **ground station and bench**; on the rocket the antenna can also hang directly off the module U.FL.
- GPS: MAX-M10S RF_IN → DC-block cap → 50 Ω trace → edge SMA, **with an active-antenna bias-T populated** (VCC_RF → 27 nH onto the RF line). So **the GPS port can drive an ACTIVE antenna** (~3.3 V bias).

**Critical rule — active vs passive:**
- **GPS is receive-only → can use an ACTIVE antenna** (built-in LNA, powered up the coax). This is the *only* port with bias.
- **E22 (LoRa) and ESP are transceivers → PASSIVE antennas only.** They transmit real power out the port; an active antenna's receive-LNA would be destroyed. Never feed DC to these ports.

## 2. Use cases — two very different ends

**Rocket end (the moving/harsh end):**
- Under **high-G acceleration + vibration**, and it **tumbles** (orientation changes, especially on descent).
- Airframe is **fibreglass/plastic (RF-transparent)** where antennas mount — so **no metal ground plane available**, and antennas mount **internally, along the airframe axis, epoxied/secured**.
- Requirements: **rigid** (NO flexible "duck" whips, NO tilt/swivel bases — mechanical failure points under G), **omnidirectional** (a tumbling rocket must not lose the link when it points away → low/modest gain, wide pattern), **low height / length-constrained** (fits an avionics bay / RF-transparent section), and ideally **ground-plane-independent** (half-wave or dipole) since there's no ground plane.

**Ground station end (the fixed/easy end):**
- Not under G, mounts on a tripod/mast. Can be tall, high-gain, directional.
- **High gain (Yagi, aimed)** for maximum range, **or** a simple **omni (no aiming)** for a conservative link.
- **Elevation + clear line-of-sight matters more than antenna gain** for a no-aim setup.

## 3. Antenna-selection principles being used
- **Gain (dBi) = directional concentration vs an isotropic radiator**, not amplification (antennas are passive). High gain = narrow beam = more range one way, less coverage elsewhere. **Negative dBi = inefficient** (radiates less than isotropic — a red flag on small antennas).
- Therefore: **omni + modest gain on the tumbling rocket; high gain + aimed (or omni) on the fixed ground station.**
- **Monopoles need a ground plane** (counterpoise ~λ/4 radius). The fibreglass rocket has none → prefer **half-wave / dipole (ground-plane-independent)** on the rocket. (Grounding the SMA *shell* to the board GND is the coax return — necessary, but it is NOT the antenna's ground plane.)
- Bands to match exactly: **915 MHz = 902–928 MHz** (AU915, not 868/433); 2.4 GHz = 2400–2500; GPS = 1575 MHz L1.
- Termination: **standard SMA male** everywhere. Avoid RP-SMA.

## 4. Link-budget targets (drives the ground antenna choice)
- **Conservative goal: ~4 km, no aiming.** Path loss ~104 dB @ 915 MHz; with 22 dBm TX + ~2 dBi rocket omni + ~2–5 dBi ground omni → ~−77 dBm received vs SX1262 sensitivity ~−129 dBm (SF9/BW125) = **~50 dB margin.** An **omni ground antenna is plenty** — no Yagi/aiming needed. Elevation/LoS is the main lever.
- **Stretch goal: ~10 km.** Path loss ~112 dB; still large margin, but this is where a **Yagi (aimed, +8 dB ≈ 2.5× range)** on the ground earns its keep.
- Current direction: **build for the conservative no-aim 4 km first (omni both ends), keep a Yagi as a later upgrade** for 10 km.

## 5. Current shortlist / decisions so far
Working from a Linx ANT-9xx (916 MHz) DigiKey list; SMA-male only.

**Rocket LoRa (915) — DECIDED:**
- **ANT-916-CW-HW-SMA** — half-wave straight rigid whip, ~120 mm, ~1.2 dBi omni, **no ground plane needed** → **primary flight antenna.**
- **ANT-916-CW-RH-SMA** — quarter-wave straight, ~51 mm, −1.3 dBi, **needs a ground plane** → **spare / for a metal-mount only** (not ideal on fibreglass).

**Ground station LoRa (915) — DECIDED (no-aim, 4 km):**
- **ANT-916-CW-HW-SMA** — same half-wave omni as the rocket, vertical on a pole, elevated. Reusing one part number for both ends (single spare pool, known good, ground-plane-independent). ANT-916-OC-LG-SMA tilt whip dropped — not needed.
- Higher-gain omni option (future, still no aiming): a **915 MHz collinear (~5–8 dBi)**.
- 10 km upgrade: a **915 MHz Yagi (~8–12 dBi, aimed)** — not yet selected.

**2.4 GHz (ESP) — TODO:** rigid whip (rocket, secured internally) / standard-SMA duck (ground). **Standard SMA, not RP-SMA.** Note: 2.4 GHz is only used on the pad (BLE arming/config) and post-landing (Wi-Fi log download) — it's out of range in flight — so it's lower priority, but the antenna still rides through boost so keep it rigid/secured on the rocket.

**GPS — TODO:** an **active ceramic patch antenna**, SMA male, **3.3 V bias-compatible** (most accept 2.7–5.5 V), **rigid** (solid patch — no pole/monopole for GPS: wrong polarisation). Mount flat on a small ground plane under an RF window (nosecone). u-blox ANN-class or equivalent.

## 6. Jumpers / cables needed
- **U.FL → U.FL jumpers ×2** (E22 + ESP module → onboard relay U.FL). U.FL is fragile (~30 mates) — buy spares, strain-relief after final mate.
- **U.FL → SMA-female pigtails ×2** — fallback path (module U.FL straight to antenna).
- **SMA male ↔ female RG316 extensions** — routing SMA to a bulkhead / extending.
- All standard SMA (not RP-SMA).

## 7. Sourcing (Australia)
- **Core Electronics** (core-electronics.com.au) — 915 antennas, active GPS, U.FL/SMA cables; fast local.
- **IoT Store Australia** (iotstore.com.au) — AU915 LoRa antennas incl. Yagis/collinears.
- **Jaycar / Altronics** — walk-in; 2.4 GHz ducks, SMA cables/adapters.
- **Mouser AU / DigiKey AU** — exact specced parts (Linx, Taoglas, u-blox, Amphenol) with datasheets.
- **AliExpress** — cheapest for jumpers/pigtails and generic antennas; slow, buy spares.

## 8. Open questions to help with
1. ~~Finalise the ground-station 915 antenna~~ — **DONE: reusing ANT-916-CW-HW-SMA (same as rocket).** Optional later: an AU omni collinear (~5–8 dBi) or a **915 MHz Yagi** for the 10 km upgrade.
2. Pick the **2.4 GHz antenna** (standard SMA): rigid for rocket, duck for ground.
3. Pick the **active GPS ceramic patch** (SMA male, 3.3 V-bias compatible, AU-available).
4. Confirm final **rocket mounting** (internal axial, RF-transparent section) and that the **CW-HW half-wave** is the right primary.
5. Sanity-check all chosen parts are **standard SMA male**, correct band, and (rocket) rigid + omni + ground-plane-independent.

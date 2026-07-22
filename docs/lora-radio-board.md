# OZONE Radio Expansion Board — Full Specification

Status: **capture-ready spec**. Last updated 2026-07-20.
Companion board to the Senior Flight Computer v1.0 (J5 UART header). One PCB design; population options select flight unit, standalone tracker, or ground station. Doubles as the rev 2.0 pathfinder (ROADMAP: LoRa + BLE + GPS integration).
Module research + regulatory findings: Synapse vault `claude/ozone-lora-telemetry-2026-07/`.

## 1. System overview

```
                    ┌────────────────────── RADIO BOARD ──────────────────────┐
FC STM32L452        │                                                          │
USART2 (PA2/PA3) ◄──┤ UART1 ◄─► ESP32-S3-MINI-1U ◄─ SPI ─► E22-900M22S ──► 915 MHz U.FL/SMA
via J5              │            │  │  │  │  │        (SX1262, TCXO, 22 dBm)   │
                    │            │  │  │  │  └─ UART2 ─► MAX-M10S GNSS ──► GPS patch U.FL
                    │            │  │  │  └─ SPI3 ─► microSD                   │
                    │            │  │  └─ I2C ─► Qwiic / INA226 / TMP102     │
                    │            │  └─ TWAI ─► SN65HVD230 (CAN, DNP)           │
                    │            └─ USB-C (native USB-Serial-JTAG) + BLE/Wi-Fi ──► 2.4 GHz U.FL
                    │                                                          │
Batt 1S–3S ─► F_BAT ─► LTC4412 PowerPath (USB priority) ─► SYS ─► TPS630701×3 ─► +3V3 / +5V
USB VBUS ───► F_USB ─► Schottky + CTL ──────────────────────┘   (3rd TPS63070, EN=SERVO_EN → servo)
                    └──────────────────────────────────────────────────────────┘
```

- **Rocket/flight**: powered from avionics LiPo tap (1S/2S/3S), UART to FC, BLE for pad ops, GNSS populated, Wi-Fi off till landed.
- **Ground station**: same board, USB-C to laptop/Pi (or LiPo for handheld; charge externally), Yagi on SMA.
- **Standalone backup tracker**: battery + GNSS + LoRa + buzzer, no FC attached.

## 2. Connectors & pinouts

### J1 — FC UART (4-pin 0.1", mirrors FC J5)
| Pin | Net | Notes |
|---|---|---|
| 1 | GND | common ground with FC |
| 2 | FC_TO_RADIO | from FC J5.2 (UART_TX, PA2) → ESP32 GPIO18 (UART1 RX). **Straight cable — no crossover needed with this naming** |
| 3 | RADIO_TO_FC | ESP32 GPIO17 (UART1 TX) → FC J5.3 (UART_RX, PA3) |
| 4 | FC_3V3_SENSE | FC's +3.3V rail → divider → ADC. **Not a power input** (see §4) |

### J2 — Battery (JST-PH 2-pin, S2B-PH-K-S RA)
| Pin | Net |
|---|---|
| 1 | VBAT_IN (1S/2S/3S LiPo, 3.0–12.6 V; flight = avionics pack tap, ground = own LiPo) |
| 2 | GND |

### J3 — USB-C (USB2.0 16-pin receptacle, HRO TYPE-C-31-M-12 class)
VBUS→VBUS_5V, D+→USB_DP (GPIO20 via ESD), D−→USB_DN (GPIO19 via ESD), CC1/CC2 → separate 5.1 kΩ 0402 to GND, shield→GND via 1 MΩ 0603 ∥ 4.7 nF 0402.

### J4 — GPIO/button header (8-pin 0.1")
Pins 1–6 = GPIO4, 5, 6, 7 (all ADC1-capable), 42-spare, 3V3; 7 = GND; 8 = GND. 10 kΩ 0402 pull-ups on GPIO4–7 (buttons short to GND).

### J5 — I2C expansion: **Qwiic / STEMMA QT** (JST-SH 4-pin, `Connector_JST:JST_SH_SM04B-SRSS-TB_1x04-1MP_P1.00mm_Horizontal`, sym `Conn_01x04_Pin`)
Standard Qwiic pinout (do not deviate): **1=GND, 2=3V3, 3=SDA, 4=SCL**. Plug-and-play with Qwiic/STEMMA sensors + OLEDs (replaces the old plain OLED header). Optional 2nd connector in parallel for daisy-chaining. I2C pull-ups (4.7 kΩ ×2 to 3V3) live once on the MCU sheet near the ESP.

### J6 — CAN header (3-pin 0.1", DNP with U5): CANH, CANL, GND. 120 Ω 0805 termination via solder jumper JP2.

### Antenna connectors — Option 2: 3× edge-mount SMA on the board (decision 2026-07-21)
Every antenna exits on a board **edge-mount SMA**. A board SMA's center pin must be fed by a PCB trace (a cable can't feed it — the external face is the antenna). So each SMA has a short 50 Ω trace. For the E22 and ESP (RF only leaves via their module U.FL), an **onboard U.FL "relay"** receives a U.FL→U.FL jumper from the module, then a short trace runs to the SMA. Symbol for all coax connectors: `Connector:Conn_Coaxial` (pin1 = In/center, pin2 = Ext/shield→GND).

| Ref | Band | Board path | Footprints |
|---|---|---|---|
| J_ANT_LORA | 915 MHz (E22) | E22 module U.FL → U.FL-U.FL jumper → **relay U.FL** → 50 Ω trace → **edge SMA**. E22 pin 21 ANT = NC | U.FL `U.FL_Hirose_U.FL-R-SMT-1_Vertical` + SMA `SMA_Amphenol_132289_EdgeMount` |
| J_ANT_24 | 2.4 GHz (ESP) | ESP module U.FL → U.FL-U.FL jumper → **relay U.FL** → 50 Ω trace → **edge SMA** (ESP has no RF pad, relay required) | same U.FL + SMA |
| J_ANT_GPS | GPS L1 | MAX-M10S RF_IN → DC-block 100 pF → 50 Ω trace → **edge SMA**; ESD diode at connector; **active antenna** → VCC_RF bias-T 27 nH populated | SMA `SMA_Amphenol_132289_EdgeMount` |

Wiring each: relay-U.FL/RF-source pin1 → 50 Ω trace → SMA pin1; all shields (U.FL pin2, SMA pin2 tabs) → GND plane. **Silk-label each SMA (915 / 2.4 / GPS).**

**Fallback (why the relay, not routing E22 pin 21):** if the board RF path is bad, unplug the jumper and run the module U.FL straight to the antenna via a **U.FL→SMA pigtail**, bypassing the PCB. So keep both module U.FLs physically accessible.
**Cables (BOM, not PCB):** 2× U.FL-U.FL jumper (normal) + 2× U.FL-SMA pigtail (fallback).
Placement: 3 SMAs along one edge, **GPS SMA farthest from E22**; relay U.FL right next to its SMA (short trace); module U.FLs left accessible.

## 3. ESP32-S3 GPIO map (complete — MINI-1U)

| GPIO | Net | Function | Notes |
|---|---|---|---|
| 0 | BOOT_BTN | SW1 to GND | strapping (boot select) — button only |
| 1 | VBAT_SENSE | ADC1_CH0 | divider 100k/27k 0402 from VBAT_IN (before the PowerPath P-FET) |
| 2 | FC_3V3_SENSE | ADC1_CH1 | divider 100k/100k 0402 from J1.4 |
| 3 | — | NC / test pad | strapping (JTAG sel) — leave free |
| 4 | BTN1 | J4, ADC1_CH3 | 10k pull-up |
| 5 | BTN2 | J4, ADC1_CH4 | 10k pull-up |
| 6 | BTN3 | J4 | 10k pull-up |
| 7 | SERVO_EN | servo buck-boost (TPS630701 #3) EN | gates the dedicated servo 5 V reg (live only when driven) |
| 8 | E22_NRST | E22 reset | |
| 9 | E22_BUSY | E22 busy | input |
| 10 | E22_NSS | FSPI CS0 | IOMUX-native FSPI pins 10–13 → max SPI speed |
| 11 | E22_MOSI | FSPID | |
| 12 | E22_SCK | FSPICLK | |
| 13 | E22_MISO | FSPIQ | |
| 14 | E22_DIO1 | IRQ | RadioLib interrupt |
| 15 | E22_TXEN | RF switch (E22 pin 7) | present on E22-900M22S; RadioLib setRfSwitchPins |
| 16 | E22_RXEN | RF switch (E22 pin 6) | present on E22-900M22S |
| 17 | RADIO_TO_FC | UART1 TX | to FC PA3 |
| 18 | FC_TO_RADIO | UART1 RX | from FC PA2 |
| 19 | USB_DN | USB D− | native USB-Serial-JTAG |
| 20 | USB_DP | USB D+ | |
| 21 | I2C_SDA | I2C bus | 4.7 kΩ 0402 pull-ups on SDA+SCL |
| 33 | GNSS_TX | UART2 TX → M10S RXD | |
| 34 | GNSS_RX | UART2 RX ← M10S TXD | |
| 35 | GNSS_PPS | PPS input | TDMA slot-sync reference. (35–37 exist on quad-flash MINI-1; unavailable only on octal parts) |
| 36 | SD_SCK | SPI3 | separate bus from E22 — SD must not stall the radio |
| 37 | SD_MISO | SPI3 | |
| 38 | SD_MOSI | SPI3 | |
| 39 | SD_CS | SPI3 CS | |
| 40 | CAN_TX | TWAI → U5 D | DNP block |
| 41 | CAN_RX | TWAI ← U5 R | DNP block |
| 42 | SERVO_PWM | servo signal | LEDC PWM, 50 Hz; 3.3 V logic drives servo signal pin directly |
| 43 | DBG_TXD0 | test pad only | boot-ROM log — never wire to FC/GNSS |
| 44 | DBG_RXD0 | test pad only | |
| 45 | — | NC | strapping (VDD_SPI) — leave free |
| 46 | — | NC | strapping — leave free |
| 47 | I2C_SCL | I2C bus | |
| 48 | RGB_LED | WS2812B data | |
| EN | ESP_EN | 10 kΩ 0402 pull-up + 1 µF 0402 to GND; SW2 (reset) to GND | |

## 4. Power — 1S/2S/3S, USB-priority, dual-rail (redesign 2026-07-21)

Requirements: **USB overrides battery** (priority, not diode-OR — a charged 2S/3S pack is >5 V and would win a diode-OR); **1S/2S/3S** input (3.0–12.6 V); **general always-on +5 V** + **separately gated servo +5 V**. This supersedes the brought-over SFC single-battery/12 V tree (TPS63060+LDO dropped).

```
Battery 1S–3S ─ F_BAT(3A) ─ [INA226 shunt] ─ Q_BAT(P-FET ±20V Vgs) ─┬─ SYS ─┬─ TPS63070#1 → +3V3
   (3.0–12.6V)                                    ↑gate LTC4412 ─CTL◄┐      │       ├─ TPS63070#2 → +5V (always-on)
USB VBUS 5V ─ F_USB(500mA) ─── Schottky(B5819W) ───────────────────┴┴──────┘      ├─ TPS63070#3 (EN=SERVO_EN) → +5V_SERVO → servo hdr
                                                                                   └─ VBAT_SENSE tap 100k/27k → ESP IO1
(No onboard charger — all packs charged externally; 2S/3S require balance charging anyway. USB still powers the board via the PowerPath, it just doesn't charge.)
```

| Block | Part / detail |
|---|---|
| USB-priority PowerPath | **LTC4412** SOT-23-6 + battery P-FET. USB present → CTL high → battery P-FET off → USB powers SYS; USB gone → battery. P-FET also serves as reverse protection (ideal-diode). |
| Battery/USB P-FET | **Vds ≥ −30 V, Vgs ±20 V** (e.g. DMP3017SFG-7) — ±12 V Vgs parts unsafe at 12.6 V |
| USB OR path | VBUS_5V → F_USB 500 mA → B5819W Schottky → SYS; VBUS also → LTC4412 CTL |
| +3V3 | **TPS630701 #1** (2–16 V in) → 3.3 V direct. Replaces TPS63060 **and** SPX3819 LDO |
| +5V (general) | **TPS630701 #2** → 5 V, always-on; feeds 5 V on the power connector |
| +5V_SERVO | **TPS630701 #3** dedicated servo reg, **EN ← SERVO_EN**, own bulk cap (100–470 µF) for stall → servo header (GND/+5V_SERVO/SIG←SERVO_PWM). No load switch — reg EN gates it |
| Current sense | INA226 + 20 mΩ shunt (2512) in battery leg; VS→+3V3+100nF; IN± Kelvin; SDA/SCL→I2C; A0/A1→GND (0x40); ALERT NC |
| VBAT_SENSE | battery → 100k/27k 0402 → ESP IO1 (12.6 V→2.68 V; auto-detect 1S/2S/3S) |
| Power expansion conn | locking JST: **3V3 / 5V / GND** (from rails #1/#2) for external expansion; current bounded by rail budgets |
| Charger | **None — omitted by design (2026-07-21).** All packs charged externally (2S/3S need balance charging). USB powers the board but does not charge. |
| Passives | input caps **≥25 V** (3S=12.6 V); TPS63070: 1 µH, 10 µF in / 2×22 µF out per datasheet; 100 µF bulk on SYS |
| +3V3 distribution | star: ESP32 (22 µF+100 nF), E22 (10 µF+100 nF at pin), GNSS (10 µF+100 nF), SD/CAN/LED/I2C (100 nF each) |
| FC_3V3_SENSE | J1.4 → 100k/100k → ESP IO2 (FC-alive). **Never** power this board from FC 3V3. |

Budget: ~600 mA @3.3 V worst case + servo (1–2.5 A on +5V_SERVO) → sized by TPS63070 (2 A) + separate servo path. Wi-Fi 350 mA peaks ground-only.

## 5. BOM (all footprints specified)

| Ref | Part | Footprint | Blk | Flight | Gnd-USB | Gnd-handheld |
|---|---|---|---|---|---|---|
| M1 | Ebyte E22-900M22S | 14×20 stamp-hole | RF | ✓ | ✓ | ✓ |
| M2 | ESP32-S3-MINI-**1U** (N8) | Espressif MINI | MCU | ✓ | ✓ | ✓ |
| M3 | u-blox MAX-M10S | 10×10 LCC | GNSS | ✓ | opt | ✓ |
| U1a | **TPS630701RNMR** (3.3 V rail) | OZONE_RADIO:RNM0015A | PWR | ✓ | ✓ | ✓ | 2–16 V buck-boost (1S/2S/3S); FB divider→3.3 V, VSEL tied. No central EP — heat via VIN/VOUT/PGND pins |
| U1b | **TPS630701RNMR** (5 V general) | OZONE_RADIO:RNM0015A | PWR | ✓ | ✓ | ✓ | FB divider→5 V, always-on |
| U1c | **TPS630701RNMR** (5 V servo) | OZONE_RADIO:RNM0015A | PWR | ✓ | ✗ | ✓ | FB→5 V, EN←SERVO_EN, own bulk cap for stall |
| U7 | LTC4412 (USB-priority PowerPath) | SOT-23-6 | PWR | ✓ | ✓ | ✓ | drives battery P-FET; USB priority |
| Q10 | P-FET Vds≥−30 V, **Vgs ±20 V** (DMP3017SFG-7) | SOT-23 | PWR | ✓ | ✓ | ✓ | battery path + reverse prot; 3S-safe |
| U3 | USBLC6-2SC6 | SOT-23-6 | USB | ✓ | ✓ | ✓ |
| U4 | INA226 + 20 mΩ **2512** shunt | TSSOP-10 | sense | ✓ | opt | opt | battery leg |
| U5 | SN65HVD230 | SOIC-8 | CAN | ✗ DNP | ✗ | ✗ |
| U6 | TMP102 | SOT-563 | sense | ✓ | opt | opt |
| L1a,L1b | 1 µH ×2 (per TPS63070 datasheet) | per datasheet | PWR | ✓ | ✓ | ✓ | one per rail |
| D1 | B5819W (USB OR Schottky) | SOD-123 | PWR | ✓ | ✓ | ✓ |
| Cin | input caps **≥25 V** (3S=12.6 V) + 100 µF SYS bulk | 0805/1206 | PWR | ✓ | ✓ | ✓ |
| D3 | WS2812B | 2020 or 5050 | UI | ✓ | ✓ | ✓ |
| F1 (F_BAT) | 3 A polyfuse | 1206 | PWR | ✓ | ✓ | ✓ | battery leg |
| F2 (F_USB) | 500 mA polyfuse | 1206 | PWR | ✓ | ✓ | ✓ | USB leg |
| BZ1 | piezo + AO3400A (SOT-23) | per FC ERRATA circuit (incl. discharge resistor) | UI | ✓ | ✗ | ✓ |
| SW1,SW2 | tactile BOOT/RESET | SMD 6×3.5 | MCU | ✓ | ✓ | ✓ |
| J1 | 4-pin 0.1" | TH | | ✓ | opt | opt |
| J2 | JST-PH 2-pin | S2B-PH-K RA | | ✓ | opt | ✓ |
| J3 | USB-C 16P | SMD+TH hybrid | | ✓ | ✓ | ✓ |
| J4 | 8-pin 0.1" | TH | | opt | ✓ | ✓ |
| J5 | I2C Qwiic/STEMMA JST-SH 4-pin `JST_SH_SM04B-SRSS-TB_1x04-1MP_P1.00mm_Horizontal` | Connector_JST | | ✓ | ✓ | ✓ | GND/3V3/SDA/SCL; plug-and-play I2C |
| SW1-3 | 3× tactile SPST-NO (SparkFun PT647 or `Button_Switch_SMD:SW_SPST_EVQP7A`) | Button_Switch_SMD | | ✓ | ✓ | ✓ | BTN1-3, 10k pull-up each |
| J6+JP2 | CAN 3-pin + 120 Ω 0805 | TH | | ✗ | ✗ | ✗ |
| SD1 | microSD **hinged lid** (Molex **0472192001** / 47219) | Connector_Card:microSD_HC_Molex_47219-2001 | | ✓ | ✓ | ✓ | hinged swing-door clamp (vibration-safe), in stock ~$2.42, ready KiCad footprint. 8 contacts + shield, no card-detect (firmware detects on init). Plain 8-pin microSD symbol (NOT the _Det1 symbol). Alt hinged: Hirose DM3CS-SF (has card-detect but no KiCad footprint) |
| U20 | 5V servo buck-boost (TPS63070) | VQFN | PWR | ✓ | opt | opt | 1S/2S→5V; own fuse (3A) + bulk 100µF; EN←SERVO_EN(IO7) |
| J20 | servo header 3-pin (GND/5V/SIG) | 0.1" | | ✓ | ✗ | opt | SIG←SERVO_PWM(IO42); standard servo (1–2.5A stall) |
| J_ANT_LORA/24/GPS | 3× edge SMA `SMA_Amphenol_132289_EdgeMount` (sym `Conn_Coaxial`) | Connector_Coaxial | | ✓ | ✓ | ✓ | silk-label 915/2.4/GPS; short 50Ω trace each |
| relay U.FL ×2 | onboard U.FL for E22 + ESP `U.FL_Hirose_U.FL-R-SMT-1_Vertical` | Connector_Coaxial | | ✓ | ✓ | ✓ | receives U.FL-U.FL jumper from module → 50Ω trace → SMA |
| GPS front end | DC-block 100pF 0402 C0G + ESD diode (<0.5pF) + bias-T 27nH 0402 **(active, populated)** | 0402/0603 | | ✓ | opt | ✓ | RF_IN → SMA short 50Ω trace |
| cables (buy) | 2× U.FL-U.FL jumper (normal) + 2× U.FL-SMA pigtail (fallback) | — | | ✓ | ✓ | ✓ | not PCB parts |
| — | pull-ups: 10 kΩ 0402 ×5 (BTN, EN), 4.7 kΩ 0402 ×2 (I2C), 5.1 kΩ 0402 ×2 (CC) | 0402 | | ✓ | ✓ | ✓ |
| — | dividers: 100k/27k (VBAT), 100k/100k (FC3V3) | 0402 | | ✓ | ✓ | ✓ |
| — | decoupling per §4; 100 nF 0402 per IC | 0402/0805/1206 | | ✓ | ✓ | ✓ |

## 6. Net list by block (capture checklist)

**Power**: VBAT_IN, VBUS_5V, VIN_RADIO, +3V3_RADIO, +5V_SERVO, GND, VBAT_SENSE, FC_3V3_SENSE
**Servo**: +5V_SERVO (own fuse + TPS63070 buck-boost off VBAT), SERVO_EN (IO7 → reg EN), SERVO_PWM (IO42 → J20 signal)
**FC link**: FC_TO_RADIO, RADIO_TO_FC
**E22**: E22_NSS, E22_SCK, E22_MOSI, E22_MISO, E22_DIO1, E22_BUSY, E22_NRST, E22_TXEN, E22_RXEN, RF_915 (module ANT → connector, 50 Ω)
**GNSS**: GNSS_TX, GNSS_RX, GNSS_PPS, GPS_RF (50 Ω), GPS_ANT_BIAS
**SD**: SD_SCK, SD_MOSI, SD_MISO, SD_CS, (card-detect → spare if socket has it)
**I2C**: I2C_SDA, I2C_SCL (shared: Qwiic J5, INA226, TMP102; INA226 A0/A1→GND = 0x40, TMP102 ADD0→GND = 0x48)
**CAN**: CAN_TX, CAN_RX, CANH, CANL
**USB**: USB_DP, USB_DN (raw pair J3→U3; filtered pair U3→GPIO20/19), CC1, CC2
**UI/misc**: BOOT_BTN, ESP_EN, BTN1–3, BUZZER_GATE, RGB_LED, DBG_TXD0, DBG_RXD0

## 7. Layout rules

1. TPS63070 hot loops tight (both rails): Cin/Cout ≤2 mm from pins, L adjacent, unbroken ground pour under. Switch nodes away from all RF. LTC4412 P-FET + shunt near the battery input.
2. RF_915 and GPS_RF: 50 Ω microstrip, short, ground keep-out per module datasheets, via-stitched pour either side.
3. Antennas at board corners: E22 one end, ESP32 module antenna end at another, GNSS farthest from E22. Keep-outs under all three.
4. 3V3 star from bulk cap (ESP32 / E22 / GNSS branches) so PA bursts don't ripple the MCU or GNSS.
5. INA226 shunt in the VBAT_IN path right after F1; Kelvin-route sense pins to the shunt pads.
6. GNSS: keep switching node, WS2812 data, and SD lines away from its RF side; solid ground under module.
7. Test points: SPI (4), DIO1, BUSY, PPS, VIN_RADIO, +3V3_RADIO, GND ×2 (1.0 mm TP like FC).

## 8. Firmware requirements (board-driven)

- Radio discipline by flight state: BLE advertising off at arm/launch-detect; Wi-Fi off until landed. (S3's single 2.4 GHz radio is time-sliced; keeps flight RF = LoRa only and power at ground-only peaks.)
- **GNSS**: set dynamic model *airborne <4g* (UBX-CFG-NAVSPG-DYNMODEL) at boot and **poll back to verify** — default portable mode stops fixing at ~12 km. Airborne = 80 km / 500 m/s. COCOM 500 m/s + 4 g limits don't unlock: expect boost blackout (Mach 2+), re-acquisition within seconds after burnout deceleration. Apogee logic never depends on GPS.
- TDMA: rocket-master beacon; downlink slots SF7–8/BW125, 30–50 B packets; guard (SX1262 half-duplex turnaround); uplink command window. PPS available for slot sync.
- **Pyro auth end-to-end**: ground host generates `[cmd | params | monotonic counter | truncated AES-CMAC]`; **STM32L452 verifies** (hardware AES) — ESP32 is an untrusted pipe. Two-stage arm→fire + timeout; FC echoes pending command in telemetry before confirm.
- FC⇄ESP32 UART1: framed (COBS or 0x7E), CRC-16 per frame, ≥115200. GPS position is served to the FC over this link (FC has no GNSS).
- Pin RadioLib version (issue #777: E22/SX1262 RX regression 5.7→6.0); bench-test RX path on the actual module. `setTCXO()` required.
- Telemetry fields from this board: GPS fix, pack V (auto-detect 1S/2S from VBAT_SENSE), pack I (INA226), bay temp (TMP102), RSSI/SNR both directions, FC-alive (FC_3V3_SENSE).

## 9. Radio settings & regulatory

- 915.075 MHz centre (gap below LoRaWAN AU915; avoid ≥927 MHz — Optus 935 MHz desense). BW125 (BW250 if near 1 W EIRP, for PSD headroom). SF7–8 boost/downlink, SF9 max. CRC + explicit header.
- ACMA LIPD Class Licence **2025** (F2025L01047) Table 8 item 6: 915–928 MHz digital modulation, **max 1 W EIRP**, clause 43 PSD ≤ 25 mW/3 kHz. 22 dBm + ≤8 dBi antenna = at/under ceiling; count ground Yagi gain.
- **OPEN before CDR**: confirm whether item 6 carries a 500 kHz minimum 6 dB bandwidth condition. If yes → ≥20-channel FHSS in the TDMA scheme under the frequency-hopping entry (1 W EIRP). Hop sequence derivable from frame counter — near-free in TDMA.

## 10. Comm transport tiers

1. Flight (0–30 km): **LoRa only** — 2.4 GHz is out of range seconds after liftoff.
2. Pad (≤100 m): **BLE** (GATT-UART; S3 has no BT Classic) — config, arm confirm, continuity display.
3. Recovery/ground (≤500 m): **Wi-Fi AP** — bulk SD log download at Mbit rates (LoRa is ~1–5 kbit/s).
4. ESP-NOW / 802.11 LR: deprioritised — Wi-Fi AP covers bulk transfer with less protocol work.

## 11. Open items

- [ ] ACMA 500 kHz min-bandwidth check (§9) → locks FHSS-or-not before firmware
- [ ] Confirm E22-900M22S variant's TXEN/RXEN presence → GPIO15/16 or NC
- [ ] Verify ESP32-S3-MINI-1U pin availability for IO33–48 against current Espressif datasheet at capture time
- [ ] Avionics pack final cell count (design covers 1S/2S; 3S would need a new front end)
- [ ] Order: 3× E22-900M22S (99Tech AU$12.90 when stocked / AliExpress), 3× MAX-M10S, ESP32-S3-MINI-1U ×3

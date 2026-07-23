/**
 * config.h — OZONE TELECOM hub pin map, radio parameters, and credentials.
 *
 * ALL pin numbers below were reverse-engineered from the real schematic
 * (ozone_telecom/ozone_telecom.kicad_sch, peripherals.kicad_sch) by matching
 * each net's global_label coordinate to the ESP32-S3-MINI-1U symbol's pin
 * offsets (symbol placed at (81.28, 96.52), rotation 0 — see the working in
 * the PR/commit message or ask Dash for the derivation script). Where a net
 * could not be pinned down with confidence, it is marked CONFIRM below —
 * you MUST open the schematic and verify (click the net, "Highlight Net",
 * read the ESP32 pin it lands on) before flashing real hardware.
 *
 * Everything here is a #define specifically so Dash can override without
 * touching any .cpp file.
 */
#pragma once

// ============================================================================
// WiFi credentials — EDIT BEFORE FLASHING. Consider moving to NVS / a
// provisioning flow (WiFiManager) once the hub leaves the bench; hardcoding
// is fine for bring-up.
// ============================================================================
#define WIFI_SSID          "OZONE-GCS"
#define WIFI_PASSWORD      "changeme123"
// If AP mode is preferred instead (no local WiFi at the pad), set this and
// see main.cpp's WIFI_MODE_AP branch.
#define WIFI_AP_MODE       0          // 1 = ESP hosts its own AP, 0 = joins WIFI_SSID
#define WIFI_AP_SSID       "OZONE-TELECOM"
#define WIFI_AP_PASSWORD   "rocketry1"

// ============================================================================
// FCD-over-UART link to the STM32 flight computer (USART2 on the FC side,
// PA2/PA3, 115200 8N1 — see docs/telecom-command-protocol.md).
//
// *** CONFIRM THIS IN KICAD BEFORE FLASHING ***
// The schematic nets "TELECOM_TO_OZONE" / "OZONE_TO_TELECOM" trace, by exact
// coordinate match against the ESP32-S3-MINI-1U symbol, to a location
// adjacent to the module's EN (chip-enable/reset) pin cluster — NOT a clean
// GPIO pair like every other net on this board. That's almost certainly
// either (a) a genuine hardware reset/status line rather than the FCD UART
// data pair, or (b) routed through a header on peripherals.kicad_sch that
// this parse didn't fully resolve. Either way: open ozone_telecom.kicad_sch,
// click "TELECOM_TO_OZONE" and "OZONE_TO_TELECOM", and use
// Inspect > Highlight Net to read the real ESP32 GPIO numbers, then fix the
// two #defines below. Placeholders use ESP32-S3's default UART1 pins so the
// firmware at least builds and can be bench-tested with jumper wires.
// ============================================================================
#define PIN_FC_UART_TX     17   // CONFIRM — placeholder (ESP32-S3 UART1 default TX)
#define PIN_FC_UART_RX     18   // CONFIRM — placeholder (ESP32-S3 UART1 default RX)
#define FC_UART_NUM        1    // Serial1
#define FC_UART_BAUD       115200   // matches STM32 USART2 in main.c

// ============================================================================
// E22-900M22S (SX1262) LoRa module — SPI + control lines.
// CONFIRMED from schematic: E22_MISO/MOSI/SCK/NSS/BUSY/NRST/DIO1/RXEN/TXEN
// global labels all land on ESP32 IO0-IO8 as a tight, deliberate group.
// Note: IO0 is an ESP32 boot-strapping pin (must be high/floating at reset
// to boot from flash normally); it also drives E22_RXEN here. In practice
// this is fine — RXEN just needs to settle to its steady state a few ms
// after boot, well before radio use — but do not add an external pulldown
// on RXEN or you risk forcing the module into download mode. Flag for
// Dash to sanity-check on first bring-up.
// ============================================================================
#define PIN_E22_MISO       3
#define PIN_E22_MOSI       5
#define PIN_E22_SCK        4
#define PIN_E22_NSS        6    // SPI chip-select
#define PIN_E22_BUSY       7    // SX1262 BUSY (poll before every SPI txn)
#define PIN_E22_NRST       8    // SX1262 NRESET (active low)
#define PIN_E22_DIO1       2    // SX1262 DIO1 (IRQ: TX/RX done, timeout, etc.)
#define PIN_E22_RXEN       0    // Ebyte E22 RF switch RX-enable (module-level, active high)
#define PIN_E22_TXEN       1    // Ebyte E22 RF switch TX-enable (module-level, active high)
// The E22 module wraps the raw SX1262 with an RF front-end switch driven by
// RXEN/TXEN (Ebyte's own antenna-switch control, separate from the SX1262's
// internal DIO2-as-antswitch option). RadioLib's Module constructor takes an
// optional RXEN/TXEN pair specifically for E22-style boards — wire them in.

// LoRa radio parameters — AU915 ISM, matches docs/antenna-selection-handover.md.
#define LORA_FREQ_MHZ      915.0
#define LORA_BW_KHZ        125.0
#define LORA_SF            9        // SF9/BW125 matches the sensitivity figure in the antenna doc
#define LORA_CR            5        // 4/5 coding rate
#define LORA_SYNC_WORD     0x12     // private sync word (public LoRaWAN uses 0x34)
#define LORA_TX_DBM        22       // E22-900M22S max — AU915 ISM band, confirm local reg limits
#define LORA_PREAMBLE_LEN  8

// ============================================================================
// u-blox MAX-M10S GNSS — UART, receive-only per hardware (no bias/no TX
// needed from ESP; module streams NMEA by default at 9600, configurable).
// CONFIRMED from schematic: GNSS_TX (module's TX pin) -> ESP IO39 (ESP RX);
// GNSS_RX (module's RX pin) <- ESP IO38 (ESP TX, mostly unused since we only
// need to receive — wired through in case a UBX config command is ever sent
// up to the module). GNSS_PPS -> ESP IO37 (1PPS timing pulse, currently only
// used as a lock-quality indicator, not a hard timestamp reference).
//
// NOTE: docs/ozone-telecom-routing.md says "PPS (GNSS->IO35)" — that routing
// note appears to predate this schematic revision. The schematic itself
// (ground truth for this file) puts PPS on IO37 and IO35 on the SD_MISO net
// instead. Flagged for Dash to double check against the routing doc.
// ============================================================================
#define PIN_GNSS_RX        39   // ESP RX <- GNSS TX (NMEA out)
#define PIN_GNSS_TX        38   // ESP TX -> GNSS RX (UBX config, rarely used)
#define PIN_GNSS_PPS       37   // 1PPS from GNSS (input, optional use)
#define GNSS_UART_NUM      2    // Serial2
#define GNSS_UART_BAUD     9600 // MAX-M10S default; bump via UBX-CFG if reconfigured

// ============================================================================
// I2C bus (temp sensors / bonus connectors per peripherals.kicad_sch).
// CONFIRMED: I2C_SDA -> ESP IO13. I2C_SCL -> ESP IO44 (the module's native
// UART0 RXD0 pin, repurposed as GPIO since USB-CDC/console isn't used here).
// ============================================================================
#define PIN_I2C_SDA        13
#define PIN_I2C_SCL        44

// ============================================================================
// Status / housekeeping GPIO (not required for the core relay function, but
// documented since they share the same GPIO map).
// ============================================================================
#define PIN_RGB_LED        43   // CONFIRMED: RGB_LED net -> ESP IO43 (native UART0 TXD0, repurposed)
#define PIN_SERVO_EN       9    // CONFIRMED: SERVO_EN -> ESP IO9
#define PIN_SERVO_PWM      20   // CONFIRMED: SERVO_PWM -> ESP IO20 (native USB D+, repurposed)
#define PIN_BTN1           12   // CONFIRMED: BTN1 -> ESP IO12
#define PIN_BTN2           11   // CONFIRMED: BTN2 -> ESP IO11
#define PIN_BTN3           10   // CONFIRMED: BTN3 -> ESP IO10
#define PIN_VBAT_SENSE     15   // CONFIRMED: VBAT_SENSE (ADC) -> ESP IO15
#define PIN_FC_3V3_SENSE   14   // CONFIRMED: FC_3V3_SENSE (ADC) -> ESP IO14
// CAN (SN65HVD230 bonus connector) and microSD are wired but not used by this
// firmware; documented for completeness only.
#define PIN_CAN_RX         21
#define PIN_CAN_TX         26
#define PIN_SD_MISO        35
#define PIN_SD_MOSI        34
#define PIN_SD_SCK         36
#define PIN_SD_CS          33

// ============================================================================
// Networking service ports / names.
// ============================================================================
#define WS_SERVER_PORT     81      // ws://<esp-ip>:81/  — GCS WebSocket clients subscribe here
#define BLE_DEVICE_NAME    "OZONE-TELECOM"
// Nordic UART Service (NUS) UUIDs — standard, matches nRF Connect / any
// generic "UART" BLE terminal app so no custom mobile app is required.
#define BLE_NUS_SERVICE_UUID  "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"
#define BLE_NUS_RX_CHAR_UUID  "6E400002-B5A3-F393-E0A9-E50E24DCCA9E" // phone -> hub (write)
#define BLE_NUS_TX_CHAR_UUID  "6E400003-B5A3-F393-E0A9-E50E24DCCA9E" // hub -> phone (notify)

// Line buffer sizing — generous for FCD1 descriptor JSON lines.
#define LINE_BUF_MAX       512

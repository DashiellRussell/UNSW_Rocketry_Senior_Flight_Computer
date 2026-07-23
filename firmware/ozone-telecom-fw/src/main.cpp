/**
 * OZONE TELECOM hub firmware — main.cpp
 *
 * Job: be a dumb, fast, concurrent pipe between the STM32 flight computer's
 * FCD/1 text link (UART) and three independent radio links (WiFi/WebSocket,
 * BLE/NUS, LoRa/E22), plus inject the local GNSS fix as extra TLM fields.
 *
 * SAFETY CONTRACT (read docs/telecom-command-protocol.md and
 * firmware/ozone-fw/app/Inc/pyro_trigger.h before touching this file):
 *   - This hub NEVER originates, rewrites, filters, or auto-repeats any
 *     command line. Every `do ...` / `set ...` / `whoami` byte that arrives
 *     from WiFi, BLE, or LoRa is forwarded to the FC UART **verbatim**,
 *     character for character, once.
 *   - The FC alone enforces arm state, key-switch continuity, token/CRC/seq
 *     checks, and fire_mode interlocks (pyro_trigger.c). This hub has no
 *     opinion on pyro safety and must never grow one — no "helpful" retry,
 *     no caching of the last fire command, no local echo-back of a token.
 *   - Any bug here should fail *closed* (drop a line) rather than *open*
 *     (invent, duplicate, or delay-then-fire a line).
 *
 * Concurrency: WiFi (WebSocket) and BLE share the ESP32-S3's single 2.4 GHz
 * radio, time-sliced by the coexistence firmware inside arduino-esp32/IDF —
 * fine at the low, bursty data rates here (short text lines, a few Hz).
 * LoRa (E22/SX1262) is a completely separate 915 MHz radio on its own SPI
 * bus, so it runs fully independently of the 2.4 GHz side.
 */
#include <Arduino.h>
#include "../include/config.h"
#include "fc_link.h"
#include "ws_link.h"
#include "ble_nus.h"
#include "lora_link.h"
#include "gnss_link.h"

namespace {

// Rate-limit the GNSS TLM injection so it doesn't dominate the (slow) LoRa
// link; WiFi/BLE can obviously take much more, but a single injection rate
// keeps the three links' views of "the stream" consistent.
uint32_t last_gnss_emit_ms = 0;
constexpr uint32_t GNSS_EMIT_PERIOD_MS = 1000; // 1 Hz

// --- Fan-out from the FC (or from GNSS) to all three downlinks -------------
void fanOutToAllLinks(const String &line) {
    ws_send_line(line);
    ble_nus_send_line(line);
    lora_send_line(line);
}

// --- Callbacks: a command line arrived on some uplink -> relay to the FC ---
// Every one of these does the exact same thing on purpose: forward verbatim,
// no branching on content. Do not add `if (line.startsWith("do fire"))`
// special-casing here — that is the FC's job, not this hub's.
void onLineFromWs(const String &line)   { fc_link_send_line(line); }
void onLineFromBle(const String &line)  { fc_link_send_line(line); }
void onLineFromLora(const String &line) { fc_link_send_line(line); }

// --- Callback: a line arrived from the FC -> fan out to all three downlinks
void onLineFromFc(const String &line) {
    fanOutToAllLinks(line);
}

} // namespace

void setup() {
    Serial.begin(115200); // USB debug console only — not part of the FCD fan-out
    delay(200);
    Serial.println("OZONE TELECOM hub booting...");

    fc_link_init();
    gnss_init();
    wifi_ws_init();
    ble_nus_init();

    if (!lora_init()) {
        Serial.println("LoRa init FAILED — check E22 wiring/config.h pins");
        // Deliberately continue: WiFi/BLE fan-out and the FC UART relay
        // should still work even if LoRa hardware isn't present/working on
        // the bench. LoRa failures are logged, not fatal.
    }

    Serial.println("OZONE TELECOM hub up.");
}

void loop() {
    // 1) FC -> everywhere (telemetry, logs, acks)
    fc_link_poll(onLineFromFc);

    // 2) everywhere -> FC (commands), each transport polled independently so
    //    none can starve another (all non-blocking).
    ws_poll(onLineFromWs);
    ble_nus_poll(onLineFromBle);
    lora_poll(onLineFromLora);

    // 3) local GNSS fix -> extra TLM line, fanned out same as FC telemetry.
    gnss_poll();
    uint32_t now = millis();
    if (now - last_gnss_emit_ms >= GNSS_EMIT_PERIOD_MS) {
        String gnssLine;
        if (gnss_build_tlm_line(gnssLine)) {
            fanOutToAllLinks(gnssLine);
        }
        last_gnss_emit_ms = now;
    }
}

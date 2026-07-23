/**
 * OZONE TELECOM hub firmware — main.cpp
 *
 * Job: be a dumb, fast, concurrent pipe between the STM32 flight computer's
 * FCD/1 text link (UART) and three independent radio links (WiFi/WebSocket,
 * BLE/NUS, LoRa/E22), plus inject the local GNSS fix as extra TLM fields.
 * Every line received from the FC is also mirrored to this board's own
 * microSD (sd_log.cpp) as a second, independent flight record, backing up
 * the FC's own OZONE*.CSV SD log in case that card is ever lost or damaged.
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
#include "sd_log.h"

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

// --- Callback: a line arrived from the FC -> fan out + SD backup ----------
// Every line the FC sends (TLM/EVT/LOG/PARAM/ACK/FCD1) goes to the three
// radio downlinks *and* to the telecom board's own microSD (sd_log.cpp) as
// an independent backup copy of the flight — mirroring the FC's own SD log.
// sd_log_line() is a fast RAM-buffer append (or true no-op with no card
// present); it never blocks, so it can't become the slowest link in this
// fan-out and can't stall the radio relay.
void onLineFromFc(const String &line) {
    fanOutToAllLinks(line);
    sd_log_line(line.c_str());

    // Flight events (LAUNCH/APOGEE/DEPLOY/PYRO/LANDED — see
    // firmware/tools/gcs/PROTOCOL.md) are rare and safety-relevant: force
    // them to the card immediately instead of waiting for the next timed
    // flush, so a power loss right after e.g. LANDED doesn't cost this
    // backup its most important line. Cheap to do — EVT lines are
    // infrequent by nature.
    if (line.startsWith("EVT ")) {
        sd_log_flush();
    }
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

    if (!sd_log_init()) {
        Serial.println("SD backup log NOT active (no/bad card on J8) — "
                        "relay unaffected, this is a best-effort backup only");
        // Same "log it, don't halt" treatment as LoRa above: the SD backup
        // is a nice-to-have second copy of the flight, never a dependency
        // of the actual comms-relay job this hub exists to do.
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
    //    (Not written to the SD backup — that file is meant to be a mirror
    //    of the FC's own record, and the GNSS fix is hub-local data the FC
    //    never saw; keep the backup an honest copy of the FCD stream only.)
    gnss_poll();
    uint32_t now = millis();
    if (now - last_gnss_emit_ms >= GNSS_EMIT_PERIOD_MS) {
        String gnssLine;
        if (gnss_build_tlm_line(gnssLine)) {
            fanOutToAllLinks(gnssLine);
        }
        last_gnss_emit_ms = now;
    }

    // 4) SD backup: flush the RAM-buffered FC lines to the microSD on a
    //    timer (sd_log.cpp) — never blocks the relay above.
    sd_log_poll();
}

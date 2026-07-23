/**
 * sd_log.h — microSD (J8, Molex 47219-2001) FCD-stream backup logger.
 *
 * Purpose: give the telecom hub its own, fully independent flight record.
 * The STM32 flight computer already logs to its own SD card
 * (OZONE000.CSV .. OZONE999.CSV, firmware/ozone-fw/app/Src/logging.c) — this
 * module writes every line the hub receives from the FC over UART (every
 * `TLM`, `EVT`, `LOG`, `PARAM`, `ACK`, and the `FCD1` descriptor —
 * firmware/tools/gcs/PROTOCOL.md) to the telecom board's own card, verbatim,
 * with a local millis() timestamp prefix. If the FC's card is ever damaged,
 * lost, or unreadable (recovery after a hard landing, water ingress, etc.),
 * the telecom board's card is a second, independently-powered, independently
 * wired copy of the same flight.
 *
 * Library: Arduino "SD" (bundled with the arduino-esp32 framework itself —
 * see the lib_deps comment in platformio.ini, do NOT add an external "SD"
 * package). Uses its own dedicated SPI bus (SD_SPI_HOST in config.h,
 * separate from the E22 LoRa radio's bus in lora_link.cpp) so a slow SD
 * write can never contend with or stall the radio SPI traffic.
 *
 * SAFETY / RELIABILITY CONTRACT — this is a BEST-EFFORT backup, not a
 * required subsystem:
 *   - sd_log_init() failing (no card, bad card, mount error) must NEVER be
 *     treated as fatal by main.cpp. The hub's actual job — relaying the FCD
 *     stream to WiFi/BLE/LoRa — must keep working with zero SD card at all.
 *   - sd_log_line() must be safe to call unconditionally, every time a line
 *     arrives from the FC, regardless of whether a card is present. It is a
 *     fast RAM-buffer append (or true no-op if there's no card) — never a
 *     blocking SD transaction — so it can sit directly in the same hot path
 *     as the WiFi/BLE/LoRa fan-out in main.cpp without becoming the slowest
 *     link in that chain.
 *   - The one place this module *does* block (briefly) is its own
 *     sd_log_poll()/sd_log_flush() write-to-card call, and that is timed to
 *     happen at most every SD_LOG_FLUSH_PERIOD_MS, not per line.
 */
#pragma once
#include <Arduino.h>

// Mounts the microSD card and opens a new sequential backup file
// (SD_LOG_FILENAME_FMT, config.h) for this power-up. Returns true if backup
// logging is active for this boot. The return value is informational only —
// main.cpp should log it and move on either way; every other function in
// this module is always safe to call regardless of what this returns.
bool sd_log_init();

// True once a card is mounted and a log file is open. Purely informational
// (status LED, a `whoami`-style hub status line, etc.) — never gate the FC
// relay's behaviour on this.
bool sd_log_active();

// Append one line received from the FC (verbatim FCD text, no trailing
// newline expected — see line_reader.h) to the RAM staging buffer, prefixed
// with "[<millis>] ". No-op if no card is mounted. Never blocks on SD I/O —
// see the contract above.
void sd_log_line(const char *line);

// Call every loop() iteration. Flushes the RAM buffer to the card once
// SD_LOG_FLUSH_PERIOD_MS has elapsed or the buffer is nearly full, whichever
// comes first. This is the only place (besides sd_log_flush() below) where
// this module actually touches the SPI bus / blocks briefly.
void sd_log_poll();

// Force an immediate flush regardless of the timer. Cheap to call rarely —
// main.cpp uses this right after a flight `EVT` line (LAUNCH/APOGEE/DEPLOY/
// PYRO/LANDED) so the rare, safety-relevant lines are physically committed
// to the card promptly rather than sitting in RAM until the next timed
// flush. No-op if no card is mounted.
void sd_log_flush();

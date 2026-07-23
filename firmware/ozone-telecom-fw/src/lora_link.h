/**
 * lora_link.h — E22-900M22S (Semtech SX1262) over SPI, via RadioLib.
 *
 * Library: RadioLib (jgromes/RadioLib, see platformio.ini for pinned
 * version). Chosen because it has first-class SX126x support including the
 * RXEN/TXEN front-end-switch pins that Ebyte's E22 modules need (plain
 * SX1262 breakouts don't have those — the E22 wraps the chip with its own
 * RF switch), is actively maintained, and is the de facto standard choice
 * for this radio family on Arduino-ESP32.
 *
 * This is an independent 915 MHz radio — no coexistence concerns with the
 * WiFi/BLE 2.4 GHz radio (different band, different silicon: the E22 has
 * its own SPI/antenna path entirely separate from the ESP32-S3's RF).
 */
#pragma once
#include <Arduino.h>

// Returns true on successful radio init.
bool lora_init();

// Queue one line for LoRa TX. Non-blocking: actual over-the-air send happens
// inside lora_poll() using RadioLib's interrupt-driven startTransmit(), so
// the FC UART relay is never blocked waiting on LoRa air time (LoRa at
// SF9/BW125 can take 100s of ms per packet — far too slow to block on).
void lora_send_line(const String &line);

// Call every loop() iteration: services the TX queue/state machine and
// checks for received packets (ground -> board commands arriving over the
// LoRa link), delivering complete lines via the callback.
void lora_poll(void (*on_line)(const String &));

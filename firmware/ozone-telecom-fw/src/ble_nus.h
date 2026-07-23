/**
 * ble_nus.h — Nordic UART Service (NUS) over BLE, using NimBLE-Arduino.
 *
 * Presents the same text stream FCD protocol over BLE so a phone/laptop
 * with any generic "BLE UART" terminal app (nRF Connect, Serial Bluetooth
 * Terminal, etc.) sees identical output to the WiFi WebSocket and the LoRa
 * downlink. No custom mobile app needed.
 *
 * BLE + WiFi coexistence note: the ESP32-S3 radio is a single 2.4 GHz
 * transceiver shared (time-sliced) between WiFi and BLE. At the telemetry
 * rates this hub deals with (a handful of short text lines per second) that
 * time-slicing is a non-issue — it only bites you at high WiFi throughput
 * (large file transfers) happening *simultaneously* with BLE activity. Log
 * download after landing (WiFi) should be fine even with BLE still
 * advertising; just don't expect max WiFi throughput while BLE is also busy.
 */
#pragma once
#include <Arduino.h>

void ble_nus_init();

// Non-blocking: notifies (if a central is subscribed) with `line` + '\n'.
// Chunks automatically if the line exceeds the negotiated MTU.
void ble_nus_send_line(const String &line);

// Call every loop() iteration. Drains any RX bytes written by a connected
// central into individual complete lines via the callback.
void ble_nus_poll(void (*on_line)(const String &));

bool ble_nus_connected();

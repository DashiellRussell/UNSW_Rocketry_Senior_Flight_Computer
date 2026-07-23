/**
 * ws_link.h — WiFi WebSocket server fan-out (and the WiFi bring-up itself).
 *
 * Any number of GCS/laptop clients can connect to ws://<esp-ip>:81/ and get
 * the identical text stream the FC emits, plus can send FCD commands back
 * (arm/set/do/whoami) which get relayed verbatim to the FC over UART.
 */
#pragma once
#include <Arduino.h>

void wifi_ws_init();

// Broadcast one line (with trailing '\n') to every connected WS client.
void ws_send_line(const String &line);

// Pumps the WebSocket server's internal event loop; must be called every
// loop() iteration. Delivers any complete text frames from clients (each
// frame == one command line, e.g. "do arm") via the callback.
void ws_poll(void (*on_line)(const String &));

bool wifi_connected();

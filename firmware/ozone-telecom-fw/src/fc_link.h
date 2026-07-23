/**
 * fc_link.h — UART link to the STM32 flight computer, carrying the FCD/1
 * text protocol (firmware/tools/gcs/PROTOCOL.md) verbatim in both
 * directions. This hub NEVER parses/originates/repeats a `do fire` or any
 * other command — see the "transparent pipe" note in main.cpp. The FC is
 * always the safety source of truth (docs/telecom-command-protocol.md,
 * pyro_trigger.h).
 */
#pragma once
#include <Arduino.h>

void fc_link_init();

// Non-blocking poll: delivers each complete line the FC sent (TLM/LOG/ACK/
// ERR/PARAM/FCD1/...) via the callback, unmodified.
void fc_link_poll(void (*on_line)(const String &));

// Send one line verbatim to the FC (a command relayed from WiFi/BLE/LoRa,
// or from this hub itself only for whoami/status — never a fire command).
void fc_link_send_line(const String &line);

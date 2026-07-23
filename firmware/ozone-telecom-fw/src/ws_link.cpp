#include "ws_link.h"
#include "../include/config.h"
#include <WiFi.h>
#include <WebSocketsServer.h>

namespace {
WebSocketsServer ws_(WS_SERVER_PORT);
void (*line_cb_)(const String &) = nullptr;

void onWsEvent(uint8_t num, WStype_t type, uint8_t *payload, size_t length) {
    switch (type) {
        case WStype_TEXT: {
            if (line_cb_ == nullptr) return;
            // A WS text frame is one already-delimited message; treat it as
            // one line straight through to the FC (strip any trailing \n
            // the client might have included).
            String s((char *)payload, length);
            while (s.endsWith("\n") || s.endsWith("\r")) s.remove(s.length() - 1);
            line_cb_(s);
            break;
        }
        default:
            break; // connect/disconnect/error/ping-pong — nothing to do
    }
}
} // namespace

void wifi_ws_init() {
#if WIFI_AP_MODE
    WiFi.mode(WIFI_AP);
    WiFi.softAP(WIFI_AP_SSID, WIFI_AP_PASSWORD);
#else
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    // Non-blocking: don't stall the FC UART relay waiting on WiFi. main.cpp
    // still services the FC link and other radios while this associates in
    // the background; ws_.begin() below is safe to call before an IP is up.
#endif
    ws_.begin();
    ws_.onEvent(onWsEvent);
}

bool wifi_connected() {
#if WIFI_AP_MODE
    return true; // AP is always "up" once softAP() succeeds
#else
    return WiFi.status() == WL_CONNECTED;
#endif
}

void ws_send_line(const String &line) {
    String withNl = line + "\n";
    ws_.broadcastTXT(withNl);
}

void ws_poll(void (*on_line)(const String &)) {
    line_cb_ = on_line;
    ws_.loop();
}

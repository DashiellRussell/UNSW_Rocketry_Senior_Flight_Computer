#include "gnss_link.h"
#include "../include/config.h"
#include <TinyGPSPlus.h>
#include <HardwareSerial.h>

namespace {
HardwareSerial gnssSerial(GNSS_UART_NUM);
TinyGPSPlus gps;
bool updated_since_last_build_ = false;
}

void gnss_init() {
    gnssSerial.begin(GNSS_UART_BAUD, SERIAL_8N1, PIN_GNSS_RX, PIN_GNSS_TX);
    pinMode(PIN_GNSS_PPS, INPUT);
}

void gnss_poll() {
    while (gnssSerial.available()) {
        if (gps.encode(gnssSerial.read())) {
            updated_since_last_build_ = true;
        }
    }
}

bool gnss_build_tlm_line(String &out) {
    if (!updated_since_last_build_) return false;
    updated_since_last_build_ = false;

    // Extra TLM fields, injected as their own TLM line (kept separate from
    // the FC's own TLM line rather than merged, so this hub never needs to
    // parse/rewrite the FC's stream — stays a transparent relay for
    // everything that comes from the FC, and only *adds* lines of its own).
    out = "TLM gnss_fix=";
    out += gps.location.isValid() ? "1" : "0";
    out += " gnss_sats=";
    out += gps.satellites.isValid() ? gps.satellites.value() : 0;
    if (gps.location.isValid()) {
        out += " gnss_lat=" + String(gps.location.lat(), 6);
        out += " gnss_lon=" + String(gps.location.lng(), 6);
    }
    if (gps.altitude.isValid()) {
        out += " gnss_alt_m=" + String(gps.altitude.meters(), 1);
    }
    if (gps.hdop.isValid()) {
        out += " gnss_hdop=" + String(gps.hdop.hdop(), 1);
    }
    return true;
}

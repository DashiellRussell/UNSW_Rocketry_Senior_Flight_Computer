/**
 * gnss_link.h — u-blox MAX-M10S NMEA reader (receive-only per hardware).
 *
 * Library: TinyGPSPlus (mikalhart/TinyGPSPlus). Simple, well-known, and the
 * MAX-M10S ships outputting standard NMEA by default so no UBX config is
 * required to get a fix — this hub just parses what's already coming out.
 */
#pragma once
#include <Arduino.h>

void gnss_init();

// Call every loop() iteration; drains available UART bytes into the parser.
void gnss_poll();

// Builds one extra "TLM gnss_lat=... gnss_lon=... gnss_alt_m=... gnss_fix=...
// gnss_sats=..." line reflecting the latest fix. Returns false (and leaves
// `out` untouched) if there has been no update since the last call, so
// callers can rate-limit injecting this into the fan-out stream.
bool gnss_build_tlm_line(String &out);

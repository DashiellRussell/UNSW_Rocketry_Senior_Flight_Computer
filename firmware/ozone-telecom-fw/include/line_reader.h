/**
 * line_reader.h — tiny newline-delimited line accumulator.
 *
 * The FCD protocol (firmware/tools/gcs/PROTOCOL.md) is plain text, one
 * message per '\n'-terminated line. This helper turns a byte-at-a-time
 * Stream (HardwareSerial, BLE RX buffer, WS frame, ...) into complete lines
 * without blocking, so it can be polled from the main loop for every
 * transport.
 */
#pragma once
#include <Arduino.h>

class LineReader {
public:
    explicit LineReader(size_t max_len) : max_len_(max_len) {
        buf_ = (char *)malloc(max_len_);
        len_ = 0;
    }

    // Feed one byte. Returns true and fills `out` when a full line (up to
    // but excluding the newline) is ready. Overlong lines are truncated
    // rather than dropped, so a runaway sender can't wedge the parser.
    bool feed(uint8_t c, String &out) {
        if (c == '\r') return false; // tolerate CRLF
        if (c == '\n') {
            buf_[len_] = 0;
            out = String(buf_);
            len_ = 0;
            return true;
        }
        if (len_ + 1 < max_len_) {
            buf_[len_++] = (char)c;
        }
        // else: silently drop extra bytes until the newline, keeps buffer valid
        return false;
    }

private:
    char *buf_;
    size_t len_;
    size_t max_len_;
};

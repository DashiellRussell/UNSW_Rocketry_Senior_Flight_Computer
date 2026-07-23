#include "sd_log.h"
#include "../include/config.h"
#include <SPI.h>
#include <SD.h>
#include <string.h>

namespace {

// Dedicated SPI bus for the microSD, independent of the E22 LoRa radio's
// HSPI bus (lora_link.cpp) — see the header comment for why that matters.
SPIClass sdSpi(SD_SPI_HOST);

File logFile;
bool card_present_ = false;

char buf_[SD_LOG_BUF_CAP];
size_t buf_len_ = 0;
uint32_t last_flush_ms_ = 0;

// Actually touches the SPI bus. The only blocking call in this module.
void flushBuffer() {
    if (!card_present_ || buf_len_ == 0) return;

    size_t written = logFile.write((const uint8_t *)buf_, buf_len_);
    logFile.flush(); // fsync the directory entry/FAT — deliberately only
                      // done here, not per line (see header contract).

    if (written != buf_len_) {
        // Card died mid-flight (full, pulled, worn out). Disable the
        // backup rather than risk repeated retries turning a "best effort"
        // side feature into something that eats loop() time. The FC's own
        // SD log is still the primary record either way.
        Serial.println("sd_log: write error — disabling SD backup for this boot");
        logFile.close();
        card_present_ = false;
    }
    buf_len_ = 0;
}

} // namespace

bool sd_log_init() {
    sdSpi.begin(PIN_SD_SCK, PIN_SD_MISO, PIN_SD_MOSI, PIN_SD_CS);

    // No card-detect line is routed to the ESP for J8 (see config.h) — the
    // mount attempt itself is the presence test, same approach the FC's own
    // logging.c takes after its PC3 card-detect switch proved unreliable.
    if (!SD.begin(PIN_SD_CS, sdSpi, SD_SPI_FREQ_HZ)) {
        Serial.println("sd_log: no microSD detected on J8 — backup logging "
                        "disabled, FC relay unaffected");
        card_present_ = false;
        return false;
    }

    // Find a free sequential filename: TCM000.LOG .. TCM999.LOG, mirroring
    // the FC's own OZONE000.CSV .. OZONE999.CSV scheme so the two cards'
    // files are recognisable as siblings of the same flight.
    char name[24];
    uint32_t idx = 0;
    for (; idx < SD_LOG_MAX_INDEX; idx++) {
        snprintf(name, sizeof(name), SD_LOG_FILENAME_FMT, (unsigned)idx);
        if (!SD.exists(name)) break;
    }
    if (idx >= SD_LOG_MAX_INDEX) {
        Serial.println("sd_log: TCM000-999.LOG all taken — disabling SD backup");
        card_present_ = false;
        return false;
    }

    logFile = SD.open(name, FILE_WRITE);
    if (!logFile) {
        Serial.printf("sd_log: failed to open %s — backup disabled\n", name);
        card_present_ = false;
        return false;
    }

    buf_len_ = 0;
    last_flush_ms_ = millis();
    card_present_ = true;

    Serial.printf("sd_log: backup logging active -> %s\n", name);

    // Self-describing header so the file makes sense if it's ever pulled
    // and opened cold, without needing this source file for context.
    char header[112];
    int n = snprintf(header, sizeof(header),
                      "# OZONE TELECOM SD backup — independent mirror of the "
                      "FCD stream. Session start millis=%lu\n",
                      (unsigned long)last_flush_ms_);
    if (n > 0 && (size_t)n < SD_LOG_BUF_CAP) {
        memcpy(buf_, header, (size_t)n);
        buf_len_ = (size_t)n;
    }
    return true;
}

bool sd_log_active() { return card_present_; }

void sd_log_line(const char *line) {
    if (!card_present_ || !line) return;

    char ts[16];
    int tsLen = snprintf(ts, sizeof(ts), "[%lu] ", (unsigned long)millis());
    if (tsLen < 0) tsLen = 0;
    size_t lineLen = strlen(line);

    // +1 for the trailing '\n' this function adds back (FC lines arrive
    // stripped of it — see line_reader.h).
    if (buf_len_ + (size_t)tsLen + lineLen + 1 > SD_LOG_BUF_CAP) {
        flushBuffer();
        if (!card_present_) return; // the flush just found a dead card
    }

    // A single line longer than the whole staging buffer shouldn't happen
    // (FCD lines are capped at LINE_BUF_MAX, well under SD_LOG_BUF_CAP) but
    // truncate defensively rather than block on a mid-line flush.
    if ((size_t)tsLen + lineLen + 1 > SD_LOG_BUF_CAP) {
        lineLen = SD_LOG_BUF_CAP - (size_t)tsLen - 1;
    }

    memcpy(buf_ + buf_len_, ts, (size_t)tsLen);
    buf_len_ += (size_t)tsLen;
    memcpy(buf_ + buf_len_, line, lineLen);
    buf_len_ += lineLen;
    buf_[buf_len_++] = '\n';
}

void sd_log_poll() {
    if (!card_present_) return;
    uint32_t now = millis();
    bool timerDue = (now - last_flush_ms_) >= SD_LOG_FLUSH_PERIOD_MS;
    bool bufferFull = buf_len_ > (SD_LOG_BUF_CAP - 256);
    if (timerDue || bufferFull) {
        flushBuffer();
        last_flush_ms_ = now;
    }
}

void sd_log_flush() {
    if (!card_present_) return;
    flushBuffer();
    last_flush_ms_ = millis();
}

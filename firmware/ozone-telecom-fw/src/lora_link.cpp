#include "lora_link.h"
#include "../include/config.h"
#include <RadioLib.h>
#include <SPI.h>
#include <queue>

namespace {

SPIClass loraSpi(HSPI);
Module mod(PIN_E22_NSS, PIN_E22_DIO1, PIN_E22_NRST, RADIOLIB_NC, loraSpi);
SX1262 radio(&mod);

std::queue<String> tx_queue_;
std::queue<String> rx_queue_;

volatile bool irq_fired_ = false;
enum class State { IDLE, TRANSMITTING, RECEIVING };
State state_ = State::IDLE;

void IRAM_ATTR onDio1() { irq_fired_ = true; }

void startListening() {
    int st = radio.startReceive();
    state_ = (st == RADIOLIB_ERR_NONE) ? State::RECEIVING : State::IDLE;
}

} // namespace

bool lora_init() {
    // E22 module SPI: 10 MHz is comfortably within SX1262's SPI spec and the
    // module's transparent-mode datasheet examples; drop it if you see
    // glitches on a long/noisy SPI run to the module.
    loraSpi.begin(PIN_E22_SCK, PIN_E22_MISO, PIN_E22_MOSI, PIN_E22_NSS);

    int state = radio.begin(LORA_FREQ_MHZ, LORA_BW_KHZ, LORA_SF, LORA_CR,
                             LORA_SYNC_WORD, LORA_TX_DBM, LORA_PREAMBLE_LEN);
    if (state != RADIOLIB_ERR_NONE) {
        return false;
    }

    // E22-900M22S wraps the SX1262 with its own RF-switch (RXEN/TXEN) — tell
    // RadioLib to drive those pins automatically on every TX/RX transition
    // instead of the SX1262's internal DIO2-as-antswitch (which the E22
    // doesn't use).
    radio.setRfSwitchPins(PIN_E22_RXEN, PIN_E22_TXEN);

    radio.setDio1Action(onDio1);
    startListening();
    return true;
}

void lora_send_line(const String &line) {
    // Each FCD line becomes one LoRa packet. Long descriptor/whoami lines
    // may exceed a single LoRa payload's practical size at SF9 — RadioLib
    // will still accept up to 256 bytes but very long packets cost a lot of
    // air time. TLM/LOG/ACK lines in normal operation are short; whoami's
    // FCD1 descriptor is the one line worth keeping compact in firmware.
    if (line.length() == 0) return;
    tx_queue_.push(line);
}

void lora_poll(void (*on_line)(const String &)) {
    if (irq_fired_) {
        irq_fired_ = false;
        if (state_ == State::TRANSMITTING) {
            radio.finishTransmit();
            startListening();
        } else if (state_ == State::RECEIVING) {
            String data;
            int st = radio.readData(data);
            if (st == RADIOLIB_ERR_NONE && data.length() > 0) {
                rx_queue_.push(data);
            }
            startListening(); // re-arm RX
        }
    }

    // Kick off the next queued TX once the radio is idle/listening. Half
    // duplex: a TX in flight briefly pauses RX, same as any single-antenna
    // LoRa link (matches the E22's transceiver architecture).
    if (state_ == State::RECEIVING && !tx_queue_.empty()) {
        String line = tx_queue_.front();
        tx_queue_.pop();
        int st = radio.startTransmit(line);
        state_ = (st == RADIOLIB_ERR_NONE) ? State::TRANSMITTING : State::IDLE;
        if (state_ == State::IDLE) startListening();
    }

    while (!rx_queue_.empty()) {
        if (on_line) on_line(rx_queue_.front());
        rx_queue_.pop();
    }
}

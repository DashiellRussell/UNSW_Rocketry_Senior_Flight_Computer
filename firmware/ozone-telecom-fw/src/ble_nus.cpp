#include "ble_nus.h"
#include "../include/config.h"
#include <NimBLEDevice.h>
#include <queue>

namespace {

NimBLEServer *server_ = nullptr;
NimBLECharacteristic *tx_char_ = nullptr;
NimBLECharacteristic *rx_char_ = nullptr;
volatile bool connected_ = false;
std::queue<String> rx_queue_; // bytes received from a central, queued as complete lines
String rx_partial_;

class ServerCallbacks : public NimBLEServerCallbacks {
    void onConnect(NimBLEServer *s) override {
        connected_ = true;
    }
    void onDisconnect(NimBLEServer *s) override {
        connected_ = false;
        // Restart advertising so the ground crew can reconnect without a reboot.
        NimBLEDevice::startAdvertising();
    }
};

class RxCallbacks : public NimBLECharacteristicCallbacks {
    void onWrite(NimBLECharacteristic *c) override {
        std::string v = c->getValue();
        for (char ch : v) {
            if (ch == '\r') continue;
            if (ch == '\n') {
                rx_queue_.push(rx_partial_);
                rx_partial_ = "";
            } else {
                rx_partial_ += ch;
                if (rx_partial_.length() > LINE_BUF_MAX) rx_partial_ = ""; // guard
            }
        }
    }
};

} // namespace

void ble_nus_init() {
    NimBLEDevice::init(BLE_DEVICE_NAME);
    // Boost TX power a touch; BLE range is a bench/pad-proximity link only
    // (arming/config on the pad, log pull after landing) so default is fine,
    // bump if the ground crew wants a bit more standoff distance.
    NimBLEDevice::setPower(ESP_PWR_LVL_P6);

    server_ = NimBLEDevice::createServer();
    server_->setCallbacks(new ServerCallbacks());

    NimBLEService *svc = server_->createService(BLE_NUS_SERVICE_UUID);

    tx_char_ = svc->createCharacteristic(
        BLE_NUS_TX_CHAR_UUID,
        NIMBLE_PROPERTY::NOTIFY);

    rx_char_ = svc->createCharacteristic(
        BLE_NUS_RX_CHAR_UUID,
        NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR);
    rx_char_->setCallbacks(new RxCallbacks());

    svc->start();

    NimBLEAdvertising *adv = NimBLEDevice::getAdvertising();
    adv->addServiceUUID(BLE_NUS_SERVICE_UUID);
    adv->setScanResponse(true);
    NimBLEDevice::startAdvertising();
}

bool ble_nus_connected() { return connected_; }

void ble_nus_send_line(const String &line) {
    if (!connected_ || tx_char_ == nullptr) return;
    String withNl = line + "\n";
    // NimBLE handles fragmentation across the negotiated MTU internally for
    // notify() as long as we call it once per logical message; still cap to
    // a sane max to avoid stalling on a huge FCD1 descriptor line.
    const size_t chunk = 500;
    for (size_t i = 0; i < withNl.length(); i += chunk) {
        tx_char_->setValue((uint8_t *)withNl.c_str() + i,
                            min(chunk, withNl.length() - i));
        tx_char_->notify();
    }
}

void ble_nus_poll(void (*on_line)(const String &)) {
    while (!rx_queue_.empty()) {
        on_line(rx_queue_.front());
        rx_queue_.pop();
    }
}

#include "fc_link.h"
#include "../include/config.h"
#include "../include/line_reader.h"
#include <HardwareSerial.h>

namespace {
HardwareSerial fcSerial(FC_UART_NUM);
LineReader reader(LINE_BUF_MAX);
}

void fc_link_init() {
    fcSerial.begin(FC_UART_BAUD, SERIAL_8N1, PIN_FC_UART_RX, PIN_FC_UART_TX);
}

void fc_link_poll(void (*on_line)(const String &)) {
    while (fcSerial.available()) {
        String line;
        if (reader.feed((uint8_t)fcSerial.read(), line)) {
            if (on_line) on_line(line);
        }
    }
}

void fc_link_send_line(const String &line) {
    fcSerial.print(line);
    fcSerial.print('\n');
}

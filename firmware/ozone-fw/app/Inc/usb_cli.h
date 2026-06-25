/**
 * usb_cli.h - USB-C virtual COM port transport for the OZONE console.
 *
 * Plug the board into a laptop and open the serial port (115200, but baud is
 * ignored for USB CDC). Provides line-buffered input (with echo) and a
 * non-blocking printf so a stalled/absent host never blocks the flight loop
 * (the lesson from the MPR logger: CDC writes block when no host is reading).
 *
 * Wiring: CDC_Receive_FS() in USB_DEVICE/App/usbd_cdc_if.c must call
 * usb_cli_rx_push() (added in its USER CODE region).
 */
#ifndef USB_CLI_H
#define USB_CLI_H

#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>

void usb_cli_init(void);

/* Push received bytes into the RX ring. Called from the USB interrupt context
 * (CDC_Receive_FS). Lock-free single-producer/single-consumer ring. */
void usb_cli_rx_push(const uint8_t *buf, uint32_t len);

/* Drain the RX ring into an internal line buffer, echoing as it goes. Returns
 * true once a complete line (CR or LF terminated) is ready in `out`. */
bool usb_cli_get_line(char *out, size_t maxlen);

/* True if a host has enumerated and configured the CDC interface. */
bool usb_connected(void);

/* Non-blocking-ish formatted print over USB CDC. Drops output if no host is
 * reading (bounded ~10 ms retry), so it never stalls the super-loop. */
int usb_printf(const char *fmt, ...);

/* Raw write (same non-blocking semantics). */
void usb_write(const char *s);

#endif /* USB_CLI_H */

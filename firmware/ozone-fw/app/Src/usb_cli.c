#include "usb_cli.h"
#include "main.h"
#include "usbd_cdc_if.h"
#include "usb_device.h"
#include <stdarg.h>
#include <stdio.h>
#include <string.h>

extern USBD_HandleTypeDef hUsbDeviceFS;

#define RX_RING_SZ   256u
#define LINE_MAX     96u
#define TX_BUF_SZ    256u

static volatile uint8_t  s_rx[RX_RING_SZ];
static volatile uint16_t s_head = 0;   /* written by ISR  */
static volatile uint16_t s_tail = 0;   /* read by main    */

static char     s_line[LINE_MAX];
static size_t   s_line_len = 0;

void usb_cli_init(void)
{
    s_head = s_tail = 0;
    s_line_len = 0;
}

bool usb_connected(void)
{
    return hUsbDeviceFS.dev_state == USBD_STATE_CONFIGURED;
}

void usb_cli_rx_push(const uint8_t *buf, uint32_t len)
{
    for (uint32_t i = 0; i < len; i++) {
        uint16_t next = (uint16_t)((s_head + 1) % RX_RING_SZ);
        if (next == s_tail) return;          /* ring full -> drop */
        s_rx[s_head] = buf[i];
        s_head = next;
    }
}

void usb_write(const char *s)
{
    if (!usb_connected() || s == NULL) return;
    uint16_t len = (uint16_t)strlen(s);
    if (len == 0) return;
    uint32_t start = HAL_GetTick();
    while (CDC_Transmit_FS((uint8_t *)s, len) == USBD_BUSY) {
        if ((HAL_GetTick() - start) > 10u) return;   /* host not reading */
    }
}

int usb_printf(const char *fmt, ...)
{
    static char buf[TX_BUF_SZ];          /* static: keep off the stack */
    va_list ap;
    va_start(ap, fmt);
    int n = vsnprintf(buf, sizeof(buf), fmt, ap);
    va_end(ap);
    if (n <= 0) return 0;
    if (n > (int)sizeof(buf) - 1) n = sizeof(buf) - 1;
    usb_write(buf);
    return n;
}

bool usb_cli_get_line(char *out, size_t maxlen)
{
    while (s_tail != s_head) {
        uint8_t c = s_rx[s_tail];
        s_tail = (uint16_t)((s_tail + 1) % RX_RING_SZ);

        if (c == '\r' || c == '\n') {
            if (s_line_len == 0) {
                usb_write("\r\n");           /* bare enter -> reprompt */
                out[0] = '\0';
                return true;
            }
            usb_write("\r\n");
            size_t n = (s_line_len < maxlen - 1) ? s_line_len : maxlen - 1;
            memcpy(out, s_line, n);
            out[n] = '\0';
            s_line_len = 0;
            return true;
        }
        else if (c == 0x08 || c == 0x7F) {   /* backspace / delete */
            if (s_line_len > 0) {
                s_line_len--;
                usb_write("\b \b");
            }
        }
        else if (c >= 0x20 && c < 0x7F) {    /* printable */
            if (s_line_len < LINE_MAX - 1) {
                s_line[s_line_len++] = (char)c;
                char echo[2] = { (char)c, '\0' };
                usb_write(echo);             /* live echo */
            }
        }
    }
    return false;
}

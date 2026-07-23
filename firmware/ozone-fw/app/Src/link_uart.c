#include "link_uart.h"
#include "main.h"          /* HAL + huart2 */
#include <stdarg.h>
#include <stdio.h>
#include <string.h>

extern UART_HandleTypeDef huart2;   /* defined in main.c (USART2) */

/* --- RX ring (single-producer ISR / single-consumer super-loop) ------------- */
#define RX_RING_SZ 256u              /* power of two                            */
static volatile uint8_t  s_rx[RX_RING_SZ];
static volatile uint16_t s_head;     /* written by ISR                          */
static volatile uint16_t s_tail;     /* read by consumer                        */

static char     s_line[128];
static uint16_t s_len;

void link_uart_init(void)
{
    s_head = s_tail = 0;
    s_len = 0;
    /* Enable RX-not-empty interrupt + NVIC (CubeMX leaves the NVIC box off). */
    __HAL_UART_ENABLE_IT(&huart2, UART_IT_RXNE);
    HAL_NVIC_SetPriority(USART2_IRQn, 6, 0);
    HAL_NVIC_EnableIRQ(USART2_IRQn);
}

/* USART2 ISR: push each received byte into the ring; clear overrun. */
void USART2_IRQHandler(void)
{
    USART_TypeDef *u = huart2.Instance;
    uint32_t isr = u->ISR;

    if (isr & USART_ISR_ORE) u->ICR = USART_ICR_ORECF;   /* drop overrun, keep going */

    if (isr & USART_ISR_RXNE) {
        uint8_t b = (uint8_t)(u->RDR & 0xFFu);           /* reading RDR clears RXNE */
        uint16_t nh = (uint16_t)((s_head + 1u) & (RX_RING_SZ - 1u));
        if (nh != s_tail) {                              /* drop on overflow */
            s_rx[s_head] = b;
            s_head = nh;
        }
    }
}

bool link_uart_get_line(char *out, size_t maxlen)
{
    while (s_tail != s_head) {
        uint8_t c = s_rx[s_tail];
        s_tail = (uint16_t)((s_tail + 1u) & (RX_RING_SZ - 1u));

        if (c == '\r' || c == '\n') {
            if (s_len == 0) continue;                    /* swallow blank lines */
            size_t n = (s_len < maxlen - 1) ? s_len : maxlen - 1;
            memcpy(out, s_line, n);
            out[n] = '\0';
            s_len = 0;
            return true;
        }
        if (s_len < sizeof(s_line) - 1) s_line[s_len++] = (char)c;
        else s_len = 0;                                  /* overlong -> resync */
    }
    return false;
}

void link_uart_write(const char *s)
{
    /* Blocking with a short timeout: a ~120-char line at 115200 is ~10 ms; the
     * timeout guards against a wedged link stalling the flight loop. */
    HAL_UART_Transmit(&huart2, (uint8_t *)s, (uint16_t)strlen(s), 30);
}

int link_uart_printf(const char *fmt, ...)
{
    char buf[192];
    va_list ap; va_start(ap, fmt);
    int n = vsnprintf(buf, sizeof(buf), fmt, ap);
    va_end(ap);
    if (n > 0) link_uart_write(buf);
    return n;
}

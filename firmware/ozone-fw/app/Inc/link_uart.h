/**
 * link_uart.h - USART2 transport for the OZONE telecom link (FCD over UART).
 *
 * USART2 (PA2 TX / PA3 RX, 115200 8N1) is the FC<->telecom-board link (header
 * J5 -> ESP32-S3 hub). CubeMX brings the UART up TX-only; this adds an
 * interrupt-driven RX ring + non-blocking line reader so the board can receive
 * ground commands, plus a short-timeout TX so a stalled link never hangs the
 * flight super-loop.
 *
 * Regen-safe: defines USART2_IRQHandler itself and enables the NVIC line in
 * link_uart_init() (the CubeMX USART2 global-interrupt box is left unticked;
 * if it is ever ticked, remove this handler to avoid a duplicate symbol).
 */
#ifndef LINK_UART_H
#define LINK_UART_H

#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>

void link_uart_init(void);

/* Drain the RX ring into an internal line buffer. Returns true once a complete
 * CR/LF-terminated line is ready in `out` (NUL-terminated, terminator stripped). */
bool link_uart_get_line(char *out, size_t maxlen);

/* Formatted / raw TX over USART2 (blocking with a short timeout). */
int  link_uart_printf(const char *fmt, ...);
void link_uart_write(const char *s);

#endif /* LINK_UART_H */

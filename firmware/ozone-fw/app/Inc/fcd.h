/**
 * fcd.h - Flight Computer Descriptor (fcd/1) protocol engine for OZONE.
 *
 * Implements the self-describing telemetry/command protocol
 * (docs/fcd-protocol.md) over the telecom UART (link_uart / USART2):
 *   whoami -> FCD1 {descriptor}   TLM key=value stream   LOG <lvl> <msg>
 *   get / set <id> <v>            do <id> [k=v]   (arm/preflight/log/pyro...)
 *
 * Transport-agnostic core: it drives the UART itself, but fcd_handle_line()
 * lets any other transport (e.g. the USB console) feed a line and get replies,
 * so the same protocol works over USB CDC and the radio link.
 *
 * The board stays the source of truth for safety: pyro fire requests go through
 * pyro_trigger (fire_mode handshake) and pyro.c (key switch + continuity).
 */
#ifndef FCD_H
#define FCD_H

#include "sensors.h"
#include "flight.h"
#include "pyro.h"
#include <stdint.h>
#include <stdbool.h>

typedef struct {
    sensor_sample_t *sample;
    flight_ctx_t    *flight;

    /* state reads */
    float (*read_vbat)(void);
    float (*read_pyro_vbat)(void);

    /* actions (owned by ozone_app so it keeps control of safety state) */
    void  (*arm)(void);
    void  (*disarm)(void);
    void  (*zero_ground)(void);
    bool  (*fire)(pyro_channel_t ch);   /* immediate fire AFTER auth passes    */
    void  (*log_start)(void);
    void  (*log_stop)(void);
    void  (*identify)(void);            /* blink LED + chirp to locate the board */
    bool  (*power_good)(void);          /* buck-boost PG (power rail in regulation) */
    bool  (*sd_ok)(void);               /* SD mounted + logging active              */
} fcd_ctx_t;

void fcd_init(const fcd_ctx_t *ctx);

/* Super-loop service: pump UART command lines, run the trigger timers, and
 * emit the TLM stream at the configured rate. Non-blocking. */
void fcd_task(uint32_t now_ms);

/* Feed a single already-assembled command line from an arbitrary transport;
 * replies are written via `reply`. Used to expose FCD over the USB console. */
void fcd_handle_line(const char *line, void (*reply)(const char *));

/* Emit a LOG line on the UART link (faults/events surfaced to the ground). */
void fcd_log(char level, const char *msg);   /* level: 'E' 'W' 'I' 'D' */

#endif /* FCD_H */

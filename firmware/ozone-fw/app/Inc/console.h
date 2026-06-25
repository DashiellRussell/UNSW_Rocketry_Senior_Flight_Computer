/**
 * console.h - Menu-driven ground console over USB-C (CDC).
 *
 * Modelled on the MPR altitude logger's preflight / test / post-flight menus.
 * Plug the board into a laptop, open the serial port, and you get an
 * interactive menu: run preflight checks, exercise each subsystem from the
 * test menu, stream live status, and do post-flight recovery.
 *
 * The console is non-blocking and state-driven; it only acts when a full line
 * arrives, so it never stalls the flight super-loop. It is purely a ground
 * tool - it reads system state through the context and triggers actions via
 * callbacks owned by ozone_app.
 */
#ifndef CONSOLE_H
#define CONSOLE_H

#include "sensors.h"
#include "flight.h"
#include <stdint.h>

typedef struct {
    sensor_suite_t  *sensors;
    sensor_sample_t *sample;
    flight_ctx_t    *flight;

    /* Actions (owned by ozone_app, keep it in control of safety state). */
    void  (*arm)(void);
    void  (*disarm)(void);
    void  (*ground_test)(int channel);   /* 0 = ch1, 1 = ch2 */
    void  (*zero_ground)(void);
    float (*read_vbat)(void);
    float (*read_pyro_vbat)(void);
} console_ctx_t;

void console_init(const console_ctx_t *ctx);

/* Call every super-loop iteration. Handles connect banner, menu input, and
 * live status streaming. */
void console_task(uint32_t now_ms);

#endif /* CONSOLE_H */

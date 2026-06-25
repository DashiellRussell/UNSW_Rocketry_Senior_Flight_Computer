/**
 * flight.h - OZONE flight state machine + 2-of-3 apogee voting (doc 13 / 15.4).
 *
 * Pure logic: it consumes fused sensor samples and emits deployment commands.
 * It never touches hardware directly - the app layer calls pyro_fire() when
 * the machine requests it. This keeps the safety logic unit-testable on a PC.
 */
#ifndef FLIGHT_H
#define FLIGHT_H

#include "sensors.h"
#include <stdbool.h>
#include <stdint.h>

typedef enum {
    FS_INIT = 0,
    FS_IDLE,            /* on pad, disarmed */
    FS_ARMED,           /* armed, waiting for launch */
    FS_BOOST,           /* powered flight */
    FS_COAST,           /* unpowered ascent */
    FS_DROGUE,          /* apogee detected, drogue commanded */
    FS_MAIN_DESCENT,    /* drogue out, descending to main alt */
    FS_LANDED,
    FS_FAULT,
} flight_state_t;

typedef enum {
    DEPLOY_NONE = 0,
    DEPLOY_DROGUE,      /* fire PYRO_CH1 */
    DEPLOY_MAIN,        /* fire PYRO_CH2 */
} deploy_cmd_t;

typedef struct {
    flight_state_t state;
    uint32_t       launch_ms;          /* tick at launch detect */
    uint32_t       state_entry_ms;
    float          max_alt_agl;        /* running apogee tracker */
    float          last_alt_agl;
    uint32_t       last_alt_ms;
    float          vel_mps;            /* filtered vertical velocity */
    uint32_t       launch_hold_ms;     /* high-g persistence timer */
    uint32_t       land_hold_ms;       /* landing persistence timer */
    bool           drogue_fired;
    bool           main_fired;
} flight_ctx_t;

void flight_init(flight_ctx_t *f);

/* Called when ground crew arms (external key + BT/auto). */
void flight_arm(flight_ctx_t *f);

/* Advance the state machine with a fresh sample. Returns a deployment command
 * (DEPLOY_NONE most ticks). The caller must enforce continuity/arm before
 * actually firing; lockouts (altitude/velocity) are checked HERE. */
deploy_cmd_t flight_update(flight_ctx_t *f, const sensor_sample_t *s, uint32_t now_ms);

const char *flight_state_name(flight_state_t st);

#endif /* FLIGHT_H */

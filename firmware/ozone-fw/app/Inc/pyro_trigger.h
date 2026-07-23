/**
 * pyro_trigger.h - Ground->board pyro trigger handshake (fire_mode state machine).
 *
 * Sits ABOVE pyro.c and the app's fire hook. Decides *whether* a remote fire
 * request is authorised, per the selected fire_mode; the actual gate drive still
 * happens in pyro.c and is still gated by the external key switch (hardware),
 * continuity, and the flight state machine's lockouts. This layer only governs
 * the ground->board handshake so a manual deploy can be both SAFE and FAST.
 *
 * HW-free / testable: no HAL calls. Time is passed in (now_ms); presence of
 * "armed" and "continuity" and the act of firing are injected callbacks, so the
 * whole mode logic runs in a host unit test. See docs/telecom-command-protocol.md.
 */
#ifndef PYRO_TRIGGER_H
#define PYRO_TRIGGER_H

#include "pyro.h"
#include <stdbool.h>
#include <stdint.h>

typedef enum {
    FIRE_MODE_SAFE = 0,   /* staged per-fire nonce: prime -> fire token= (ground tests) */
    FIRE_MODE_SESSION,    /* flight "password" set at flight-mode entry, req'd every fire */
    FIRE_MODE_HOT,        /* deploy-ready: rolling token, 1-key fire (emergency)         */
    FIRE_MODE_DIRECT,     /* armed -> fire, no token (fastest, least safe)               */
} fire_mode_t;

/* Result of a trigger request - maps to an FCD ACK/ERR reply. */
typedef enum {
    TRIG_FIRED = 0,       /* channel fired                                        */
    TRIG_PRIMED,          /* prime accepted; token issued (out_token valid)       */
    TRIG_DEPLOY_READY,    /* deploy-ready latched (hot mode)                      */
    TRIG_SESSION_SET,     /* session key established (out_token = the key)        */
    TRIG_SAFED,           /* prime / deploy-ready / session key cleared            */
    TRIG_ERR_MODE,        /* command not valid in the current fire_mode           */
    TRIG_ERR_NOT_ARMED,   /* board not armed (key switch open / not armed)         */
    TRIG_ERR_NO_CONT,     /* no continuity on that channel                         */
    TRIG_ERR_NO_TOKEN,    /* fire needs a token/key in this mode and none/invalid  */
    TRIG_ERR_BAD_TOKEN,   /* token / session-key mismatch                          */
    TRIG_ERR_EXPIRED,     /* fire window elapsed                                   */
    TRIG_ERR_NOT_READY,   /* fire before prime / deploy_ready / session key set    */
    TRIG_ERR_CHANNEL,     /* bad channel index                                     */
} trig_result_t;

/* Injected environment - keeps this module HW- and app-free for testing. */
typedef struct {
    bool (*is_armed)(void);                 /* pyro_is_armed()                    */
    bool (*continuity)(pyro_channel_t ch);  /* pyro_continuity(ch)                */
    bool (*fire)(pyro_channel_t ch);        /* do the actual fire (pyro_fire/app) */
    uint32_t seed;                          /* token PRNG seed (e.g. HAL_GetTick) */
} pyro_trigger_env_t;

void pyro_trigger_init(const pyro_trigger_env_t *env, fire_mode_t mode);
void pyro_trigger_set_mode(fire_mode_t mode);
fire_mode_t pyro_trigger_mode(void);
const char *pyro_trigger_mode_name(fire_mode_t m);

/* Periodic service: expires stale windows, rotates the hot rolling token.
 * Call from the super-loop with a millisecond timebase. */
void pyro_trigger_task(uint32_t now_ms);

/* --- command entry points (called by the FCD 'do' dispatcher) --------------- */

/* SESSION mode: establish the flight pyro key at flight-mode entry. Pass
 * supplied!=0 to use a ground-chosen key, or supplied==0 to have the board roll
 * a random one. Writes the effective key to *out_key. Valid until safe/disarm. */
trig_result_t pyro_trigger_arm_session(uint32_t supplied, uint32_t now_ms,
                                       uint32_t *out_key);

/* SAFE mode: issue a fresh one-shot token + open the fire window for ch. */
trig_result_t pyro_trigger_prime(pyro_channel_t ch, uint32_t now_ms,
                                 uint32_t *out_token);

/* HOT mode: latch deploy-ready for ch (starts the rolling token + window). */
trig_result_t pyro_trigger_deploy_ready(pyro_channel_t ch, uint32_t now_ms);

/* Fire a channel. has_token=false when no token/key was supplied. */
trig_result_t pyro_trigger_fire(pyro_channel_t ch, bool has_token,
                                uint32_t token, uint32_t now_ms);

/* Clear all prime / deploy-ready / session state (also called on disarm). */
void pyro_trigger_safe(void);

/* Current live token for ch (0 if none) - streamed in telemetry so the ground
 * station can bind a one-key fire in HOT mode. (SESSION key is NOT streamed.) */
uint32_t pyro_trigger_live_token(pyro_channel_t ch);

const char *pyro_trigger_result_str(trig_result_t r);

#endif /* PYRO_TRIGGER_H */

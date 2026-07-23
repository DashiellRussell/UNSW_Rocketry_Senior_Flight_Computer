#include "pyro_trigger.h"
#include "ozone_config.h"
#include <string.h>

/* Tunables (see docs/telecom-command-protocol.md). */
#ifndef OZONE_TRIG_SAFE_WINDOW_MS
#define OZONE_TRIG_SAFE_WINDOW_MS   10000u   /* SAFE: prime->fire window          */
#endif
#ifndef OZONE_TRIG_HOT_ROTATE_MS
#define OZONE_TRIG_HOT_ROTATE_MS     4000u   /* HOT: rolling-token rotation period */
#endif
/* HOT window is two rotations so the token is never briefly absent between rolls. */
#define OZONE_TRIG_HOT_WINDOW_MS   (2u * OZONE_TRIG_HOT_ROTATE_MS)

#define NCH  2

typedef struct {
    uint32_t token;        /* active token (0 = none)                            */
    uint32_t deadline_ms;  /* fire window closes at this tick                     */
    bool     ready;        /* HOT: deploy-ready latched for this channel          */
    uint32_t next_roll_ms; /* HOT: when to rotate the token next                  */
} chan_t;

static pyro_trigger_env_t s_env;
static fire_mode_t        s_mode = FIRE_MODE_SAFE;
static chan_t             s_ch[NCH];
static uint32_t           s_session_key;   /* SESSION mode flight password (0=unset) */
static uint32_t           s_rng;           /* xorshift32 state                   */

/* --- small helpers ---------------------------------------------------------- */

static uint32_t next_rand(void)
{
    /* xorshift32 - not cryptographic; just unpredictable enough to defeat a
     * replayed/garbled single packet. Never returns 0 (0 = "none"). */
    uint32_t x = s_rng;
    x ^= x << 13; x ^= x >> 17; x ^= x << 5;
    s_rng = x ? x : 0xA5A5A5A5u;
    return s_rng ? s_rng : 1u;
}

static bool valid_ch(pyro_channel_t ch) { return (int)ch >= 0 && (int)ch < NCH; }

static void clear_ch(pyro_channel_t ch)
{
    s_ch[ch].token = 0; s_ch[ch].deadline_ms = 0;
    s_ch[ch].ready = false; s_ch[ch].next_roll_ms = 0;
}

/* --- lifecycle -------------------------------------------------------------- */

void pyro_trigger_init(const pyro_trigger_env_t *env, fire_mode_t mode)
{
    s_env  = *env;
    s_mode = mode;
    s_rng  = env->seed ? env->seed : 0xC0FFEEu;
    s_session_key = 0;
    for (int i = 0; i < NCH; i++) clear_ch((pyro_channel_t)i);
}

void pyro_trigger_set_mode(fire_mode_t mode)
{
    s_mode = mode;
    s_session_key = 0;
    for (int i = 0; i < NCH; i++) clear_ch((pyro_channel_t)i);  /* re-safe on mode change */
}

fire_mode_t pyro_trigger_mode(void) { return s_mode; }

const char *pyro_trigger_mode_name(fire_mode_t m)
{
    switch (m) {
        case FIRE_MODE_SAFE:    return "safe";
        case FIRE_MODE_SESSION: return "session";
        case FIRE_MODE_HOT:     return "hot";
        case FIRE_MODE_DIRECT:  return "direct";
        default:                return "?";
    }
}

void pyro_trigger_task(uint32_t now_ms)
{
    if (s_mode != FIRE_MODE_HOT) {
        /* SAFE: expire one-shot token windows. (SESSION/DIRECT have no windows.) */
        for (int i = 0; i < NCH; i++) {
            chan_t *c = &s_ch[i];
            if (c->token && (int32_t)(now_ms - c->deadline_ms) > 0) clear_ch((pyro_channel_t)i);
        }
        return;
    }
    for (int i = 0; i < NCH; i++) {
        chan_t *c = &s_ch[i];
        if (!c->ready) continue;
        /* If the board dropped out of armed (key switch opened), re-safe. */
        if (s_env.is_armed && !s_env.is_armed()) { clear_ch((pyro_channel_t)i); continue; }
        /* Rotate the rolling token and keep the window alive. */
        if ((int32_t)(now_ms - c->next_roll_ms) >= 0) {
            c->token        = next_rand();
            c->next_roll_ms = now_ms + OZONE_TRIG_HOT_ROTATE_MS;
        }
        c->deadline_ms = now_ms + OZONE_TRIG_HOT_WINDOW_MS;
    }
}

/* --- commands --------------------------------------------------------------- */

trig_result_t pyro_trigger_arm_session(uint32_t supplied, uint32_t now_ms,
                                       uint32_t *out_key)
{
    (void)now_ms;
    if (s_mode != FIRE_MODE_SESSION)         return TRIG_ERR_MODE;
    /* No armed-check here: the session key is just the flight password and is
     * set at flight-mode entry (arming is a deferred request actioned next
     * super-loop, so it isn't armed yet at this instant). FIRING still requires
     * armed + the key + continuity. */
    s_session_key = supplied ? supplied : next_rand();
    if (out_key) *out_key = s_session_key;
    return TRIG_SESSION_SET;
}

trig_result_t pyro_trigger_prime(pyro_channel_t ch, uint32_t now_ms,
                                 uint32_t *out_token)
{
    if (s_mode != FIRE_MODE_SAFE)            return TRIG_ERR_MODE;
    if (!valid_ch(ch))                       return TRIG_ERR_CHANNEL;
    if (s_env.is_armed && !s_env.is_armed()) return TRIG_ERR_NOT_ARMED;

    s_ch[ch].token       = next_rand();
    s_ch[ch].deadline_ms = now_ms + OZONE_TRIG_SAFE_WINDOW_MS;
    s_ch[ch].ready       = false;
    if (out_token) *out_token = s_ch[ch].token;
    return TRIG_PRIMED;
}

trig_result_t pyro_trigger_deploy_ready(pyro_channel_t ch, uint32_t now_ms)
{
    if (s_mode != FIRE_MODE_HOT)             return TRIG_ERR_MODE;
    if (!valid_ch(ch))                       return TRIG_ERR_CHANNEL;
    if (s_env.is_armed && !s_env.is_armed()) return TRIG_ERR_NOT_ARMED;

    s_ch[ch].ready        = true;
    s_ch[ch].token        = next_rand();
    s_ch[ch].next_roll_ms = now_ms + OZONE_TRIG_HOT_ROTATE_MS;
    s_ch[ch].deadline_ms  = now_ms + OZONE_TRIG_HOT_WINDOW_MS;
    return TRIG_DEPLOY_READY;
}

trig_result_t pyro_trigger_fire(pyro_channel_t ch, bool has_token,
                                uint32_t token, uint32_t now_ms)
{
    if (!valid_ch(ch))                       return TRIG_ERR_CHANNEL;
    if (s_env.is_armed && !s_env.is_armed())  return TRIG_ERR_NOT_ARMED;

    switch (s_mode) {
    case FIRE_MODE_DIRECT:
        /* No token required. Key switch + continuity are the guards. */
        break;

    case FIRE_MODE_SESSION:
        if (!s_session_key)                   return TRIG_ERR_NOT_READY;   /* no flight key set */
        if (!has_token)                       return TRIG_ERR_NO_TOKEN;
        if (token != s_session_key)           return TRIG_ERR_BAD_TOKEN;
        break;                                /* session-long: no per-fire window */

    case FIRE_MODE_SAFE:
        if (!s_ch[ch].token)                  return TRIG_ERR_NOT_READY;   /* not primed */
        if ((int32_t)(now_ms - s_ch[ch].deadline_ms) > 0) {
            clear_ch(ch);                     return TRIG_ERR_EXPIRED;
        }
        if (!has_token)                       return TRIG_ERR_NO_TOKEN;
        if (token != s_ch[ch].token)          return TRIG_ERR_BAD_TOKEN;
        break;

    case FIRE_MODE_HOT:
        if (!s_ch[ch].ready)                  return TRIG_ERR_NOT_READY;   /* not deploy-ready */
        if (!has_token)                       return TRIG_ERR_NO_TOKEN;
        if ((int32_t)(now_ms - s_ch[ch].deadline_ms) > 0) return TRIG_ERR_EXPIRED;
        if (token != s_ch[ch].token)          return TRIG_ERR_BAD_TOKEN;
        break;

    default:                                  return TRIG_ERR_MODE;
    }

    if (s_env.continuity && !s_env.continuity(ch)) return TRIG_ERR_NO_CONT;

    if (!s_env.fire || !s_env.fire(ch))       return TRIG_ERR_NOT_ARMED;   /* pyro.c refused */

    /* SAFE/HOT are one-shot per stage; re-prime / re-ready to fire again. SESSION
     * keeps its key so the other channel (or a re-fire) can use it this flight. */
    if (s_mode == FIRE_MODE_SAFE || s_mode == FIRE_MODE_HOT) clear_ch(ch);
    return TRIG_FIRED;
}

void pyro_trigger_safe(void)
{
    s_session_key = 0;
    for (int i = 0; i < NCH; i++) clear_ch((pyro_channel_t)i);
}

uint32_t pyro_trigger_live_token(pyro_channel_t ch)
{
    /* HOT rolling token is streamed for the 1-key fire; SAFE primed token too.
     * SESSION key is deliberately NOT exposed here (operator holds it). */
    if (!valid_ch(ch) || s_mode == FIRE_MODE_SESSION || s_mode == FIRE_MODE_DIRECT)
        return 0;
    return s_ch[ch].token;
}

const char *pyro_trigger_result_str(trig_result_t r)
{
    switch (r) {
        case TRIG_FIRED:          return "fired";
        case TRIG_PRIMED:         return "primed";
        case TRIG_DEPLOY_READY:   return "deploy-ready";
        case TRIG_SESSION_SET:    return "session key set";
        case TRIG_SAFED:          return "safed";
        case TRIG_ERR_MODE:       return "wrong fire_mode";
        case TRIG_ERR_NOT_ARMED:  return "not armed (close key switch)";
        case TRIG_ERR_NO_CONT:    return "no continuity";
        case TRIG_ERR_NO_TOKEN:   return "token/key required";
        case TRIG_ERR_BAD_TOKEN:  return "bad token/key";
        case TRIG_ERR_EXPIRED:    return "window expired";
        case TRIG_ERR_NOT_READY:  return "not primed/ready/keyed";
        case TRIG_ERR_CHANNEL:    return "bad channel";
        default:                  return "err";
    }
}

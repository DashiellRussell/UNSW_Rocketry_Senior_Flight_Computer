#include "flight.h"
#include "ozone_config.h"
#include <math.h>

static void enter(flight_ctx_t *f, flight_state_t st, uint32_t now_ms)
{
    f->state = st;
    f->state_entry_ms = now_ms;
}

void flight_init(flight_ctx_t *f)
{
    f->state = FS_INIT;
    f->launch_ms = 0;
    f->state_entry_ms = 0;
    f->max_alt_agl = 0.0f;
    f->last_alt_agl = 0.0f;
    f->last_alt_ms = 0;
    f->vel_mps = 0.0f;
    f->launch_hold_ms = 0;
    f->land_hold_ms = 0;
    f->drogue_fired = false;
    f->main_fired = false;
}

void flight_arm(flight_ctx_t *f)
{
    if (f->state == FS_IDLE || f->state == FS_INIT)
        f->state = FS_ARMED;
}

const char *flight_state_name(flight_state_t st)
{
    switch (st) {
        case FS_INIT:         return "INIT";
        case FS_IDLE:         return "IDLE";
        case FS_ARMED:        return "ARMED";
        case FS_BOOST:        return "BOOST";
        case FS_COAST:        return "COAST";
        case FS_DROGUE:       return "DROGUE";
        case FS_MAIN_DESCENT: return "MAIN_DESCENT";
        case FS_LANDED:       return "LANDED";
        case FS_FAULT:        return "FAULT";
    }
    return "?";
}

/* Update the filtered vertical velocity from successive altitude samples. */
static void update_velocity(flight_ctx_t *f, float alt_agl, uint32_t now_ms)
{
    if (f->last_alt_ms != 0) {
        float dt = (now_ms - f->last_alt_ms) / 1000.0f;
        if (dt > 0.0f) {
            float v = (alt_agl - f->last_alt_agl) / dt;
            /* simple low-pass to suppress baro noise */
            f->vel_mps = 0.7f * f->vel_mps + 0.3f * v;
        }
    }
    f->last_alt_agl = alt_agl;
    f->last_alt_ms  = now_ms;
}

/* 2-of-3 apogee voting (doc 15.4): barometric, accelerometric, timer. */
static bool apogee_detected(flight_ctx_t *f, const sensor_sample_t *s, uint32_t now_ms)
{
    int votes = 0;

    /* 1. Barometric: vertical velocity has gone negative. */
    if (s->baro_valid && f->vel_mps < OZONE_APOGEE_BARO_DV) votes++;

    /* 2. Accelerometric: low-g sensor near freefall (|a| ~ 0 g). */
    if (s->accel_valid && fabsf(s->lo_g_mag) < 0.25f) votes++;

    /* 3. Timer backup: enough time since launch and still high up. */
    if (f->launch_ms != 0 &&
        (now_ms - f->launch_ms) > OZONE_APOGEE_TIMER_MS &&
        s->altitude_agl_m > OZONE_ALT_LOCKOUT_M) votes++;

    return votes >= 2;
}

static bool deploy_allowed(flight_ctx_t *f, const sensor_sample_t *s)
{
    /* Altitude lockout + descent-velocity lockout (doc 7.5). */
    return (s->altitude_agl_m > OZONE_ALT_LOCKOUT_M) &&
           (f->vel_mps < -OZONE_VEL_LOCKOUT_MS);
}

deploy_cmd_t flight_update(flight_ctx_t *f, const sensor_sample_t *s, uint32_t now_ms)
{
    if (s->baro_valid) {
        update_velocity(f, s->altitude_agl_m, now_ms);
        if (s->altitude_agl_m > f->max_alt_agl) f->max_alt_agl = s->altitude_agl_m;
    }

    switch (f->state) {
        case FS_INIT:
            enter(f, FS_IDLE, now_ms);
            break;

        case FS_IDLE:
            /* Stays here until armed externally (flight_arm). */
            break;

        case FS_ARMED:
            /* Launch detect: high-g sustained for OZONE_LAUNCH_HOLD_MS.
             * launch_hold_ms stores the tick the threshold was first crossed. */
            if (s->accel_valid && s->hi_g_mag > OZONE_LAUNCH_ACCEL_G) {
                if (f->launch_hold_ms == 0) f->launch_hold_ms = now_ms;
                if ((now_ms - f->launch_hold_ms) >= OZONE_LAUNCH_HOLD_MS) {
                    f->launch_ms = now_ms;
                    enter(f, FS_BOOST, now_ms);
                }
            } else {
                f->launch_hold_ms = 0;
            }
            break;

        case FS_BOOST:
            /* Transition to coast when high-g drops below ~1.5 g (burnout). */
            if (s->accel_valid && s->hi_g_mag < 1.5f)
                enter(f, FS_COAST, now_ms);
            break;

        case FS_COAST:
            if (apogee_detected(f, s, now_ms) && deploy_allowed(f, s)) {
                f->drogue_fired = true;
                enter(f, FS_DROGUE, now_ms);
                return DEPLOY_DROGUE;
            }
            break;

        case FS_DROGUE:
            /* Descending under drogue; wait for main-deploy altitude. */
            if (s->baro_valid &&
                s->altitude_agl_m <= OZONE_MAIN_DEPLOY_AGL_M &&
                f->vel_mps < 0.0f) {
                f->main_fired = true;
                enter(f, FS_MAIN_DESCENT, now_ms);
                return DEPLOY_MAIN;
            }
            break;

        case FS_MAIN_DESCENT:
            /* Landing: altitude stable + low velocity, held for a while. */
            if (fabsf(f->vel_mps) < 1.0f &&
                fabsf(s->altitude_agl_m - f->last_alt_agl) < OZONE_LAND_ALT_STABLE_M) {
                if (f->land_hold_ms == 0) f->land_hold_ms = now_ms;
                else if ((now_ms - f->land_hold_ms) >= OZONE_LAND_HOLD_MS)
                    enter(f, FS_LANDED, now_ms);
            } else {
                f->land_hold_ms = 0;
            }
            break;

        case FS_LANDED:
        case FS_FAULT:
            break;
    }
    return DEPLOY_NONE;
}

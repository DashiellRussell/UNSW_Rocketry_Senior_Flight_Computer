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
    for (int i = 0; i < FLIGHT_ALT_AVG_N; i++) f->alt_hist[i] = 0.0f;
    f->alt_hist_i = 0;
    f->alt_hist_n = 0;
    f->alt_smooth = 0.0f;
    f->peak_smooth_agl = 0.0f;
    f->descent_count = 0;
    f->tt_apogee_s = 0.0f;
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

/* Rolling-average altitude -> running peak + sustained-descent debounce (the
 * noise-robust apogee trigger), plus a clean velocity from the SMOOTHED
 * altitude and a coast time-to-apogee estimate. Replaces the old EMA of the
 * raw single-sample derivative (which was fooled by baro noise into flipping
 * velocity negative on the way up). */
static void update_apogee_track(flight_ctx_t *f, float alt_agl, uint32_t now_ms)
{
    /* moving average over the last FLIGHT_ALT_AVG_N samples */
    f->alt_hist[f->alt_hist_i] = alt_agl;
    f->alt_hist_i = (uint8_t)((f->alt_hist_i + 1u) % FLIGHT_ALT_AVG_N);
    if (f->alt_hist_n < FLIGHT_ALT_AVG_N) f->alt_hist_n++;
    float sum = 0.0f;
    for (uint8_t i = 0; i < f->alt_hist_n; i++) sum += f->alt_hist[i];
    float prev_smooth = f->alt_smooth;
    f->alt_smooth = sum / (float)f->alt_hist_n;

    /* velocity from the SMOOTHED altitude = clean, low-noise differential */
    if (f->last_alt_ms != 0) {
        float dt = (now_ms - f->last_alt_ms) / 1000.0f;
        if (dt > 0.0f) f->vel_mps = (f->alt_smooth - prev_smooth) / dt;
    }
    f->last_alt_agl = alt_agl;
    f->last_alt_ms  = now_ms;

    /* running peak of the smoothed altitude + sustained-descent debounce */
    if (f->alt_smooth > f->peak_smooth_agl) f->peak_smooth_agl = f->alt_smooth;
    if ((f->peak_smooth_agl - f->alt_smooth) > OZONE_APOGEE_DROP_M) {
        if (f->descent_count < 0xFFFFu) f->descent_count++;
    } else {
        f->descent_count = 0;
    }

    /* rough coast time-to-apogee: still climbing -> vel / ~g decel (telemetry) */
    f->tt_apogee_s = (f->vel_mps > 0.5f) ? (f->vel_mps / 9.81f) : 0.0f;
}

/* Apogee detection. PRIMARY: the rolling-average peak-drop — the smoothed
 * altitude has fallen OZONE_APOGEE_DROP_M below its running peak for
 * OZONE_APOGEE_DEBOUNCE_N consecutive samples. That's a real, sustained descent
 * and can't be faked by single-sample baro noise (the old velocity-sign vote
 * could). FALLBACK (baro totally failed): accelerometer freefall + timer. */
static bool apogee_detected(flight_ctx_t *f, const sensor_sample_t *s, uint32_t now_ms)
{
    if (s->baro_valid)
        return f->descent_count >= OZONE_APOGEE_DEBOUNCE_N;

    bool freefall = s->accel_valid && fabsf(s->lo_g_mag) < 0.25f;
    bool timer    = (f->launch_ms != 0) &&
                    (now_ms - f->launch_ms) > OZONE_APOGEE_TIMER_MS;
    return freefall && timer;                 /* last resort with no baro */
}

static bool deploy_allowed(flight_ctx_t *f, const sensor_sample_t *s)
{
    (void)f;
    /* Altitude verification: never deploy below the lockout AGL when baro is
     * healthy. If baro failed, trust the accel+timer fallback (altitude is
     * unknowable) — apogee_detected already gated that path. */
    if (s->baro_valid) return s->altitude_agl_m > OZONE_ALT_LOCKOUT_M;
    return true;
}

deploy_cmd_t flight_update(flight_ctx_t *f, const sensor_sample_t *s, uint32_t now_ms)
{
    if (s->baro_valid) {
        update_apogee_track(f, s->altitude_agl_m, now_ms);
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

#include "sensors.h"
#include "ozone_config.h"
#include <math.h>

float sensors_pressure_to_alt(float pressure_pa)
{
    if (pressure_pa <= 0.0f) return 0.0f;
    /* h = 44330 * (1 - (P/P0)^(1/5.255)) */
    return 44330.0f * (1.0f - powf(pressure_pa / OZONE_SEALEVEL_PA, 0.190295f));
}

static float accel_mag(float x, float y, float z)
{
    return sqrtf(x * x + y * y + z * z);
}

bool sensors_init(sensor_suite_t *s)
{
    s->ground_alt_m = 0.0f;

    bool b1 = ms5611_init(&s->baro1, OZ_CS_MS5611_1_PORT, OZ_CS_MS5611_1_PIN,
                          MS5611_OSR_4096);
    bool b2 = ms5611_init(&s->baro2, OZ_CS_MS5611_2_PORT, OZ_CS_MS5611_2_PIN,
                          MS5611_OSR_4096);
    bool a1 = h3lis_init(&s->hi_g, OZONE_H3LIS_RANGE_G);
    bool a2 = lis3dh_init(&s->lo_g, OZONE_LIS3DH_RANGE_G);

    s->all_healthy = b1 && b2 && a1 && a2;
    return s->all_healthy;
}

static void read_accels(sensor_suite_t *s, sensor_sample_t *out)
{
    bool ok = true;
    if (s->hi_g.healthy && h3lis_read(&s->hi_g)) {
        out->hi_g_x = s->hi_g.g_x; out->hi_g_y = s->hi_g.g_y; out->hi_g_z = s->hi_g.g_z;
        out->hi_g_mag = accel_mag(out->hi_g_x, out->hi_g_y, out->hi_g_z);
    } else { ok = false; }

    if (s->lo_g.healthy && lis3dh_read(&s->lo_g)) {
        out->lo_g_x = s->lo_g.g_x; out->lo_g_y = s->lo_g.g_y; out->lo_g_z = s->lo_g.g_z;
        out->lo_g_mag = accel_mag(out->lo_g_x, out->lo_g_y, out->lo_g_z);
    } else { ok = false; }

    out->accel_valid = ok;
}

bool sensors_update(sensor_suite_t *s, sensor_sample_t *out, uint32_t now_ms)
{
    out->timestamp_ms = now_ms;
    read_accels(s, out);

    bool f1 = ms5611_poll(&s->baro1, now_ms);
    bool f2 = ms5611_poll(&s->baro2, now_ms);

    if (f1 || f2) {
        float sum_p = 0.0f, sum_t = 0.0f;
        int n = 0;
        if (s->baro1.healthy) { sum_p += s->baro1.pressure_pa; sum_t += s->baro1.temperature_c; n++; }
        if (s->baro2.healthy) { sum_p += s->baro2.pressure_pa; sum_t += s->baro2.temperature_c; n++; }
        if (n > 0) {
            out->pressure_pa    = sum_p / n;
            out->temperature_c  = sum_t / n;
            out->altitude_m     = sensors_pressure_to_alt(out->pressure_pa);
            out->altitude_agl_m = out->altitude_m - s->ground_alt_m;
            out->baro_valid     = true;
            return true;
        }
    }
    return false;
}

void sensors_zero_ground(sensor_suite_t *s, sensor_sample_t *out)
{
    /* Average ~2 s of barometric altitude to set the ground reference. */
    float sum = 0.0f;
    int n = 0;
    uint32_t start = HAL_GetTick();
    while ((HAL_GetTick() - start) < 2000) {
        if (sensors_update(s, out, HAL_GetTick())) {
            sum += out->altitude_m;
            n++;
        }
    }
    if (n > 0) s->ground_alt_m = sum / n;
    out->altitude_agl_m = 0.0f;
}

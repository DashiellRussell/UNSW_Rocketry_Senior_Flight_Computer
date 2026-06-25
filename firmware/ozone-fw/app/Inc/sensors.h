/**
 * sensors.h - Aggregate sensor suite: 2x MS5611, H3LIS331DL, LIS3DH.
 *
 * Owns the four device structs, runs WHO_AM_I/PROM bring-up, and produces a
 * single fused sample (averaged barometric altitude + both accelerometers).
 */
#ifndef SENSORS_H
#define SENSORS_H

#include "ms5611.h"
#include "h3lis331dl.h"
#include "lis3dh.h"
#include <stdbool.h>

typedef struct {
    /* Barometric (averaged over the two healthy MS5611s). */
    float pressure_pa;
    float temperature_c;
    float altitude_m;        /* absolute, from sea-level ref */
    float altitude_agl_m;    /* relative to ground (set at calibration) */

    /* Accelerometers (g). */
    float hi_g_x, hi_g_y, hi_g_z, hi_g_mag;   /* H3LIS331DL */
    float lo_g_x, lo_g_y, lo_g_z, lo_g_mag;   /* LIS3DH     */

    bool baro_valid;
    bool accel_valid;
    uint32_t timestamp_ms;
} sensor_sample_t;

typedef struct {
    ms5611_t baro1;
    ms5611_t baro2;
    h3lis_t  hi_g;
    lis3dh_t lo_g;
    float    ground_alt_m;
    bool     all_healthy;
} sensor_suite_t;

/* Bring-up: reset/verify every device. Returns true only if all are healthy.
 * Individual .healthy flags let the caller proceed degraded if desired. */
bool sensors_init(sensor_suite_t *s);

/* Capture ground level altitude (average several baro samples while idle). */
void sensors_zero_ground(sensor_suite_t *s, sensor_sample_t *out);

/* Service the barometer conversion state machines + read accelerometers.
 * Populates `out`. Returns true when a fresh barometric value landed. */
bool sensors_update(sensor_suite_t *s, sensor_sample_t *out, uint32_t now_ms);

/* Pressure (Pa) -> altitude (m) using the international barometric formula. */
float sensors_pressure_to_alt(float pressure_pa);

#endif /* SENSORS_H */

/**
 * telemetry.h - Human-readable status over USART2 (external BT module, doc 8.2).
 * Used for preflight health checks from a safe distance.
 */
#ifndef TELEMETRY_H
#define TELEMETRY_H

#include "sensors.h"
#include "flight.h"
#include <stdbool.h>

void telemetry_init(void);

/* Blocking printf-style line over USART2. */
void telemetry_printf(const char *fmt, ...);

/* One-line status summary (sensors, battery, pyro, state). */
void telemetry_status(const sensor_sample_t *s, flight_state_t st,
                      float vbat, float pyro_vbat,
                      bool cont1, bool cont2, bool armed);

#endif /* TELEMETRY_H */

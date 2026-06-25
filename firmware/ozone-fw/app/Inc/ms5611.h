/**
 * ms5611.h - MS5611-01BA03 barometer driver (SPI mode).
 *
 * Command-based protocol (doc 15.3): send a D1/D2 conversion command, wait the
 * conversion time, then read the 24-bit result. The driver is non-blocking at
 * the API level: start a conversion, poll elapsed time, then read.
 *
 * Two instances live on OZONE (CS_MS5611_1 = PB2, CS_MS5611_2 = PB12).
 */
#ifndef MS5611_H
#define MS5611_H

#include "spi_bus.h"
#include <stdbool.h>

typedef enum {
    MS5611_OSR_256  = 0x00,
    MS5611_OSR_512  = 0x02,
    MS5611_OSR_1024 = 0x04,
    MS5611_OSR_2048 = 0x06,
    MS5611_OSR_4096 = 0x08,   /* default; ~9.04 ms conversion */
} ms5611_osr_t;

typedef enum {
    MS5611_IDLE = 0,
    MS5611_CONV_D1,           /* pressure conversion in progress */
    MS5611_CONV_D2,           /* temperature conversion in progress */
} ms5611_phase_t;

typedef struct {
    GPIO_TypeDef *cs_port;
    uint16_t      cs_pin;
    uint16_t      prom[8];    /* factory calibration coefficients */
    ms5611_osr_t  osr;

    ms5611_phase_t phase;
    uint32_t      conv_start_ms;
    uint32_t      d1;         /* raw pressure  */
    uint32_t      d2;         /* raw temperature */

    float         pressure_pa;
    float         temperature_c;
    bool          healthy;
} ms5611_t;

/* Reset, read PROM, validate CRC. Returns true on success. */
bool ms5611_init(ms5611_t *dev, GPIO_TypeDef *cs_port, uint16_t cs_pin,
                 ms5611_osr_t osr);

/* Non-blocking sampling state machine. Call repeatedly; `now_ms` = HAL_GetTick().
 * Returns true on the tick a fresh pressure+temperature pair becomes available. */
bool ms5611_poll(ms5611_t *dev, uint32_t now_ms);

/* Conversion time in ms for the configured OSR. */
uint32_t ms5611_conv_time_ms(ms5611_osr_t osr);

#endif /* MS5611_H */

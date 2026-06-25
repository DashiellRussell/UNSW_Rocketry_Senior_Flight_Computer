/**
 * adc_sense.h - Battery + pyro-battery voltage sensing on ADC1 (PC4/PC5).
 */
#ifndef ADC_SENSE_H
#define ADC_SENSE_H

#include "ozone_hal.h"
#include <stdint.h>

/* Read one ADC channel (polled). Returns raw 12-bit count, 0xFFFF on error. */
uint16_t adc_read_raw(uint32_t channel);

/* Main avionics battery voltage (V), via the VBAT_SENSE divider. */
float adc_read_vbat(void);

/* Pyro battery voltage (V), via the PYRO_BATT_SENSE divider. */
float adc_read_pyro_vbat(void);

#endif /* ADC_SENSE_H */

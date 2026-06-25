/**
 * spi_bus.h - Shared SPI1 helpers for the four OZONE sensors.
 *
 * All four sensors share SPI1 (PA5/6/7) with individual GPIO chip-selects.
 * Transfers are blocking; sensor reads are sequential by design (doc 12).
 */
#ifndef SPI_BUS_H
#define SPI_BUS_H

#include "ozone_hal.h"
#include <stdint.h>

/* Drive all four CS lines high (deselect everything). Call before SPI init
 * and as the very first GPIO step at boot (doc 6.4 / 15.2). */
void spi_bus_deselect_all(void);

/* Single register write: assert cs, send {reg, val}, release cs. */
HAL_StatusTypeDef spi_reg_write(GPIO_TypeDef *port, uint16_t pin,
                                uint8_t reg, uint8_t val);

/* Single register read: assert cs, send reg, read 1 byte, release cs.
 * `reg` must already include any read/auto-increment flag bits the device
 * needs (callers in the sensor drivers OR these in). */
HAL_StatusTypeDef spi_reg_read(GPIO_TypeDef *port, uint16_t pin,
                               uint8_t reg, uint8_t *val);

/* Burst read of `len` bytes starting at `reg` (reg includes flag bits). */
HAL_StatusTypeDef spi_burst_read(GPIO_TypeDef *port, uint16_t pin,
                                 uint8_t reg, uint8_t *buf, uint16_t len);

/* Raw transfer with CS held by the caller (MS5611 command protocol). */
HAL_StatusTypeDef spi_xfer(uint8_t *tx, uint8_t *rx, uint16_t len);

#endif /* SPI_BUS_H */

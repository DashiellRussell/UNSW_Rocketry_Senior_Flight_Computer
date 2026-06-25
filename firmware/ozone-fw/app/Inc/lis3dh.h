/**
 * lis3dh.h - Low-g accelerometer (+/-2/4/8/16 g) on SPI1, CS=PB1.
 * Role: apogee voter (gravity vector) + low-g flight dynamics (doc 6.3).
 */
#ifndef LIS3DH_H
#define LIS3DH_H

#include "spi_bus.h"
#include <stdbool.h>

#define LIS3DH_WHOAMI  0x33

typedef struct {
    float g_x, g_y, g_z;
    float scale;          /* g per LSB */
    bool  healthy;
} lis3dh_t;

/* Verify WHO_AM_I, set range + 100 Hz, high-resolution. range_g: 2/4/8/16. */
bool lis3dh_init(lis3dh_t *dev, int range_g);

uint8_t lis3dh_whoami(void);
bool lis3dh_read(lis3dh_t *dev);

#endif /* LIS3DH_H */

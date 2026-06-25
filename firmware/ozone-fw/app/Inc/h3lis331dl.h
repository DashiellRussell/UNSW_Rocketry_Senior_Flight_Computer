/**
 * h3lis331dl.h - High-g accelerometer (+/-100/200/400 g) on SPI1, CS=PB0.
 * Role: launch detection + landing shock (doc 6.2).
 */
#ifndef H3LIS331DL_H
#define H3LIS331DL_H

#include "spi_bus.h"
#include <stdbool.h>

#define H3LIS_WHOAMI  0x32

typedef struct {
    float g_x, g_y, g_z;
    float scale;          /* g per LSB */
    bool  healthy;
} h3lis_t;

/* Verify WHO_AM_I, set range + 50 Hz output. range_g: 100/200/400. */
bool h3lis_init(h3lis_t *dev, int range_g);

/* Read WHO_AM_I (for bring-up checks). */
uint8_t h3lis_whoami(void);

/* Read all three axes (g). Returns false on SPI error. */
bool h3lis_read(h3lis_t *dev);

#endif /* H3LIS331DL_H */

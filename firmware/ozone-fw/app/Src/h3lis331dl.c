#include "h3lis331dl.h"

/* Registers */
#define REG_WHO_AM_I   0x0F
#define REG_CTRL1      0x20
#define REG_CTRL4      0x23
#define REG_OUT_X_L    0x28

/* SPI access flags (ST MEMS): bit7=READ, bit6=auto-increment (MS). */
#define SPI_READ       0x80
#define SPI_AUTOINC    0x40

uint8_t h3lis_whoami(void)
{
    uint8_t v = 0;
    spi_reg_read(OZ_CS_H3LIS_PORT, OZ_CS_H3LIS_PIN, REG_WHO_AM_I | SPI_READ, &v);
    return v;
}

bool h3lis_init(h3lis_t *dev, int range_g)
{
    dev->healthy = false;
    if (h3lis_whoami() != H3LIS_WHOAMI) return false;

    /* CTRL_REG1: PM=normal(001), DR=50Hz(00), Zen Yen Xen = 1 -> 0x27 */
    spi_reg_write(OZ_CS_H3LIS_PORT, OZ_CS_H3LIS_PIN, REG_CTRL1, 0x27);

    /* CTRL_REG4: BDU=1(0x80) | FS[5:4]. 00=100g, 01=200g, 11=400g. */
    uint8_t fs;
    switch (range_g) {
        case 100: fs = 0x00; dev->scale = 100.0f / 32768.0f; break;
        case 200: fs = 0x10; dev->scale = 200.0f / 32768.0f; break;
        case 400:
        default:  fs = 0x30; dev->scale = 400.0f / 32768.0f; break;
    }
    spi_reg_write(OZ_CS_H3LIS_PORT, OZ_CS_H3LIS_PIN, REG_CTRL4, (uint8_t)(0x80 | fs));

    dev->healthy = true;
    return true;
}

bool h3lis_read(h3lis_t *dev)
{
    uint8_t b[6];
    if (spi_burst_read(OZ_CS_H3LIS_PORT, OZ_CS_H3LIS_PIN,
                       REG_OUT_X_L | SPI_READ | SPI_AUTOINC, b, 6) != HAL_OK)
        return false;

    int16_t x = (int16_t)((b[1] << 8) | b[0]);
    int16_t y = (int16_t)((b[3] << 8) | b[2]);
    int16_t z = (int16_t)((b[5] << 8) | b[4]);
    dev->g_x = x * dev->scale;
    dev->g_y = y * dev->scale;
    dev->g_z = z * dev->scale;
    return true;
}

#include "lis3dh.h"

#define REG_WHO_AM_I   0x0F
#define REG_CTRL1      0x20
#define REG_CTRL4      0x23
#define REG_OUT_X_L    0x28

#define SPI_READ       0x80
#define SPI_AUTOINC    0x40

uint8_t lis3dh_whoami(void)
{
    uint8_t v = 0;
    spi_reg_read(OZ_CS_LIS3DH_PORT, OZ_CS_LIS3DH_PIN, REG_WHO_AM_I | SPI_READ, &v);
    return v;
}

bool lis3dh_init(lis3dh_t *dev, int range_g)
{
    dev->healthy = false;
    if (lis3dh_whoami() != LIS3DH_WHOAMI) return false;

    /* CTRL_REG1: ODR=100Hz(0101), LPen=0, Zen Yen Xen=1 -> 0x57 */
    spi_reg_write(OZ_CS_LIS3DH_PORT, OZ_CS_LIS3DH_PIN, REG_CTRL1, 0x57);

    /* CTRL_REG4: BDU=1(0x80) | FS[5:4] | HR=1(0x08). High-resolution mode. */
    uint8_t fs;
    switch (range_g) {
        case 2:  fs = 0x00; dev->scale = 1.0f  / 1000.0f; break; /* mg/LSB @ HR */
        case 4:  fs = 0x10; dev->scale = 2.0f  / 1000.0f; break;
        case 8:  fs = 0x20; dev->scale = 4.0f  / 1000.0f; break;
        case 16:
        default: fs = 0x30; dev->scale = 12.0f / 1000.0f; break;
    }
    spi_reg_write(OZ_CS_LIS3DH_PORT, OZ_CS_LIS3DH_PIN, REG_CTRL4,
                  (uint8_t)(0x80 | fs | 0x08));

    dev->healthy = true;
    return true;
}

bool lis3dh_read(lis3dh_t *dev)
{
    uint8_t b[6];
    if (spi_burst_read(OZ_CS_LIS3DH_PORT, OZ_CS_LIS3DH_PIN,
                       REG_OUT_X_L | SPI_READ | SPI_AUTOINC, b, 6) != HAL_OK)
        return false;

    /* 12-bit left-justified in HR mode: shift right 4. */
    int16_t x = (int16_t)((b[1] << 8) | b[0]) >> 4;
    int16_t y = (int16_t)((b[3] << 8) | b[2]) >> 4;
    int16_t z = (int16_t)((b[5] << 8) | b[4]) >> 4;
    dev->g_x = x * dev->scale;
    dev->g_y = y * dev->scale;
    dev->g_z = z * dev->scale;
    return true;
}

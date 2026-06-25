#include "ms5611.h"

/* MS5611 command set */
#define MS5611_CMD_RESET    0x1E
#define MS5611_CMD_ADC_READ 0x00
#define MS5611_CMD_CONV_D1  0x40   /* + OSR */
#define MS5611_CMD_CONV_D2  0x50   /* + OSR */
#define MS5611_CMD_PROM_RD  0xA0   /* + 2*coef index */

uint32_t ms5611_conv_time_ms(ms5611_osr_t osr)
{
    switch (osr) {
        case MS5611_OSR_256:  return 1;
        case MS5611_OSR_512:  return 2;
        case MS5611_OSR_1024: return 3;
        case MS5611_OSR_2048: return 5;
        case MS5611_OSR_4096:
        default:              return 10;  /* datasheet max 9.04 ms, round up */
    }
}

static void ms5611_send_cmd(ms5611_t *dev, uint8_t cmd)
{
    OZ_CS_LOW(dev->cs_port, dev->cs_pin);
    HAL_SPI_Transmit(&hspi1, &cmd, 1, 50);
    OZ_CS_HIGH(dev->cs_port, dev->cs_pin);
}

static uint16_t ms5611_read_prom(ms5611_t *dev, uint8_t index)
{
    uint8_t tx[3] = { (uint8_t)(MS5611_CMD_PROM_RD + (index * 2)), 0x00, 0x00 };
    uint8_t rx[3] = { 0 };
    OZ_CS_LOW(dev->cs_port, dev->cs_pin);
    HAL_SPI_TransmitReceive(&hspi1, tx, rx, 3, 50);
    OZ_CS_HIGH(dev->cs_port, dev->cs_pin);
    return (uint16_t)((rx[1] << 8) | rx[2]);
}

static uint32_t ms5611_read_adc(ms5611_t *dev)
{
    uint8_t tx[4] = { MS5611_CMD_ADC_READ, 0, 0, 0 };
    uint8_t rx[4] = { 0 };
    OZ_CS_LOW(dev->cs_port, dev->cs_pin);
    HAL_SPI_TransmitReceive(&hspi1, tx, rx, 4, 50);
    OZ_CS_HIGH(dev->cs_port, dev->cs_pin);
    return ((uint32_t)rx[1] << 16) | ((uint32_t)rx[2] << 8) | rx[3];
}

/* 4-bit CRC over the 8 PROM words, per AN520. */
static uint8_t ms5611_crc4(uint16_t *prom)
{
    uint16_t n_rem = 0x00;
    uint16_t crc_read = prom[7];
    prom[7] = (0xFF00 & prom[7]);   /* CRC byte cleared for calc */

    for (int cnt = 0; cnt < 16; cnt++) {
        if (cnt % 2 == 1)
            n_rem ^= (uint16_t)((prom[cnt >> 1]) & 0x00FF);
        else
            n_rem ^= (uint16_t)(prom[cnt >> 1] >> 8);

        for (int bit = 8; bit > 0; bit--) {
            if (n_rem & 0x8000)
                n_rem = (n_rem << 1) ^ 0x3000;
            else
                n_rem = (n_rem << 1);
        }
    }
    n_rem = (0x000F & (n_rem >> 12));
    prom[7] = crc_read;             /* restore */
    return (uint8_t)(n_rem ^ 0x00);
}

bool ms5611_init(ms5611_t *dev, GPIO_TypeDef *cs_port, uint16_t cs_pin,
                 ms5611_osr_t osr)
{
    dev->cs_port = cs_port;
    dev->cs_pin  = cs_pin;
    dev->osr     = osr;
    dev->phase   = MS5611_IDLE;
    dev->healthy = false;

    OZ_CS_HIGH(cs_port, cs_pin);
    ms5611_send_cmd(dev, MS5611_CMD_RESET);
    HAL_Delay(5);   /* reset reload time ~2.8 ms */

    for (int i = 0; i < 8; i++)
        dev->prom[i] = ms5611_read_prom(dev, (uint8_t)i);

    /* All-zero or all-ones PROM => no device. */
    if ((dev->prom[1] == 0x0000) || (dev->prom[1] == 0xFFFF))
        return false;

    uint8_t crc_calc = ms5611_crc4(dev->prom);
    uint8_t crc_read = (uint8_t)(dev->prom[7] & 0x000F);
    dev->healthy = (crc_calc == crc_read);
    return dev->healthy;
}

/* First/second-order pressure compensation (datasheet). */
static void ms5611_compensate(ms5611_t *dev)
{
    int64_t C1 = dev->prom[1], C2 = dev->prom[2], C3 = dev->prom[3];
    int64_t C4 = dev->prom[4], C5 = dev->prom[5], C6 = dev->prom[6];

    int64_t dT   = (int64_t)dev->d2 - (C5 << 8);
    int64_t TEMP = 2000 + ((dT * C6) >> 23);

    int64_t OFF  = (C2 << 16) + ((C4 * dT) >> 7);
    int64_t SENS = (C1 << 15) + ((C3 * dT) >> 8);

    /* Second-order temperature compensation. */
    if (TEMP < 2000) {
        int64_t T2    = (dT * dT) >> 31;
        int64_t dTemp = TEMP - 2000;
        int64_t OFF2  = (5 * dTemp * dTemp) >> 1;
        int64_t SENS2 = (5 * dTemp * dTemp) >> 2;
        if (TEMP < -1500) {
            int64_t dTemp2 = TEMP + 1500;
            OFF2  += 7 * dTemp2 * dTemp2;
            SENS2 += (11 * dTemp2 * dTemp2) >> 1;
        }
        TEMP -= T2;
        OFF  -= OFF2;
        SENS -= SENS2;
    }

    int64_t P = (((int64_t)dev->d1 * SENS) >> 21) - OFF;
    P >>= 15;

    dev->temperature_c = (float)TEMP / 100.0f;
    dev->pressure_pa   = (float)P;   /* result is already in Pa */
}

bool ms5611_poll(ms5611_t *dev, uint32_t now_ms)
{
    if (!dev->healthy) return false;
    uint32_t conv = ms5611_conv_time_ms(dev->osr);

    switch (dev->phase) {
        case MS5611_IDLE:
            ms5611_send_cmd(dev, (uint8_t)(MS5611_CMD_CONV_D1 + dev->osr));
            dev->conv_start_ms = now_ms;
            dev->phase = MS5611_CONV_D1;
            return false;

        case MS5611_CONV_D1:
            if ((now_ms - dev->conv_start_ms) < conv) return false;
            dev->d1 = ms5611_read_adc(dev);
            ms5611_send_cmd(dev, (uint8_t)(MS5611_CMD_CONV_D2 + dev->osr));
            dev->conv_start_ms = now_ms;
            dev->phase = MS5611_CONV_D2;
            return false;

        case MS5611_CONV_D2:
            if ((now_ms - dev->conv_start_ms) < conv) return false;
            dev->d2 = ms5611_read_adc(dev);
            ms5611_compensate(dev);
            dev->phase = MS5611_IDLE;
            return true;
    }
    return false;
}

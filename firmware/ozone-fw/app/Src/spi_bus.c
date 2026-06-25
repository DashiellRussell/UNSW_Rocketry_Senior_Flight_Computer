#include "spi_bus.h"

#define SPI_TIMEOUT_MS  50

void spi_bus_deselect_all(void)
{
    OZ_CS_HIGH(OZ_CS_H3LIS_PORT,    OZ_CS_H3LIS_PIN);
    OZ_CS_HIGH(OZ_CS_LIS3DH_PORT,   OZ_CS_LIS3DH_PIN);
    OZ_CS_HIGH(OZ_CS_MS5611_1_PORT, OZ_CS_MS5611_1_PIN);
    OZ_CS_HIGH(OZ_CS_MS5611_2_PORT, OZ_CS_MS5611_2_PIN);
}

HAL_StatusTypeDef spi_xfer(uint8_t *tx, uint8_t *rx, uint16_t len)
{
    return HAL_SPI_TransmitReceive(&hspi1, tx, rx, len, SPI_TIMEOUT_MS);
}

HAL_StatusTypeDef spi_reg_write(GPIO_TypeDef *port, uint16_t pin,
                                uint8_t reg, uint8_t val)
{
    uint8_t tx[2] = { reg, val };
    OZ_CS_LOW(port, pin);
    HAL_StatusTypeDef st = HAL_SPI_Transmit(&hspi1, tx, 2, SPI_TIMEOUT_MS);
    OZ_CS_HIGH(port, pin);
    return st;
}

HAL_StatusTypeDef spi_reg_read(GPIO_TypeDef *port, uint16_t pin,
                               uint8_t reg, uint8_t *val)
{
    uint8_t tx[2] = { reg, 0x00 };
    uint8_t rx[2] = { 0 };
    OZ_CS_LOW(port, pin);
    HAL_StatusTypeDef st = HAL_SPI_TransmitReceive(&hspi1, tx, rx, 2, SPI_TIMEOUT_MS);
    OZ_CS_HIGH(port, pin);
    *val = rx[1];
    return st;
}

HAL_StatusTypeDef spi_burst_read(GPIO_TypeDef *port, uint16_t pin,
                                 uint8_t reg, uint8_t *buf, uint16_t len)
{
    HAL_StatusTypeDef st;
    OZ_CS_LOW(port, pin);
    st = HAL_SPI_Transmit(&hspi1, &reg, 1, SPI_TIMEOUT_MS);
    if (st == HAL_OK) {
        st = HAL_SPI_Receive(&hspi1, buf, len, SPI_TIMEOUT_MS);
    }
    OZ_CS_HIGH(port, pin);
    return st;
}

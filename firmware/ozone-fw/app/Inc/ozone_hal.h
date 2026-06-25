/**
 * ozone_hal.h - Bridge between OZONE app modules and CubeMX-generated HAL.
 *
 * CubeMX generates the peripheral handles (hspi1, huart2, ...) in main.c and
 * the pin macros (CS_H3LIS_GPIO_Port, PYRO1_GATE_Pin, ...) in main.h, derived
 * from the "User Label" you set on each pin. This header re-exports them so the
 * app modules never include CubeMX internals directly.
 *
 * If a label below does not match what CubeMX produced, fix it HERE only.
 */
#ifndef OZONE_HAL_H
#define OZONE_HAL_H

#include "main.h"            /* CubeMX: pin macros + HAL includes */

/* ---- Peripheral handles (defined by CubeMX in main.c / *.c) -------- */
extern SPI_HandleTypeDef   hspi1;
extern UART_HandleTypeDef  huart2;
extern ADC_HandleTypeDef   hadc1;
extern TIM_HandleTypeDef   htim1;    /* RGB LED PWM            */
extern TIM_HandleTypeDef   htim6;    /* buzzer software-PWM timebase (PB9 has
                                        no timer channel on the L452) */

/* ---- Convenience CS helpers (active-low) --------------------------- */
#define OZ_CS_LOW(port, pin)   HAL_GPIO_WritePin((port), (pin), GPIO_PIN_RESET)
#define OZ_CS_HIGH(port, pin)  HAL_GPIO_WritePin((port), (pin), GPIO_PIN_SET)

/* Sensor chip-selects (labels from the CubeMX walkthrough). */
#define OZ_CS_H3LIS_PORT     CS_H3LIS_GPIO_Port
#define OZ_CS_H3LIS_PIN      CS_H3LIS_Pin
#define OZ_CS_LIS3DH_PORT    CS_LIS3DH_GPIO_Port
#define OZ_CS_LIS3DH_PIN     CS_LIS3DH_Pin
#define OZ_CS_MS5611_1_PORT  CS_MS5611_1_GPIO_Port
#define OZ_CS_MS5611_1_PIN   CS_MS5611_1_Pin
#define OZ_CS_MS5611_2_PORT  CS_MS5611_2_GPIO_Port
#define OZ_CS_MS5611_2_PIN   CS_MS5611_2_Pin

/* Pyro control / indication GPIO. */
#define OZ_PYRO1_GATE_PORT   PYRO1_GATE_GPIO_Port
#define OZ_PYRO1_GATE_PIN    PYRO1_GATE_Pin
#define OZ_PYRO2_GATE_PORT   PYRO2_GATE_GPIO_Port
#define OZ_PYRO2_GATE_PIN    PYRO2_GATE_Pin
#define OZ_PYRO_ARM_PORT     PYRO_ARM_GPIO_Port
#define OZ_PYRO_ARM_PIN      PYRO_ARM_Pin
#define OZ_PYRO1_CONT_PORT   PYRO1_CONT_GPIO_Port
#define OZ_PYRO1_CONT_PIN    PYRO1_CONT_Pin
#define OZ_PYRO2_CONT_PORT   PYRO2_CONT_GPIO_Port
#define OZ_PYRO2_CONT_PIN    PYRO2_CONT_Pin
#define OZ_PYRO1_CONT_LED_PORT PYRO1_CONT_LED_GPIO_Port
#define OZ_PYRO1_CONT_LED_PIN  PYRO1_CONT_LED_Pin
#define OZ_PYRO2_CONT_LED_PORT PYRO2_CONT_LED_GPIO_Port
#define OZ_PYRO2_CONT_LED_PIN  PYRO2_CONT_LED_Pin

/* Buzzer GPIO (PB9, software-toggled - no timer channel on this pin). */
#define OZ_BUZZER_PORT       BUZZER_GPIO_Port
#define OZ_BUZZER_PIN        BUZZER_Pin

/* Status LEDs. */
#define OZ_LED_HB_PORT       LED_HEARTBEAT_GPIO_Port
#define OZ_LED_HB_PIN        LED_HEARTBEAT_Pin
#define OZ_LED_ERR_PORT      LED_ERROR_GPIO_Port
#define OZ_LED_ERR_PIN       LED_ERROR_Pin

/* Power-good input from TPS63060. */
#define OZ_PG_BUCK_PORT      PG_BUCKBOOST_GPIO_Port
#define OZ_PG_BUCK_PIN       PG_BUCKBOOST_Pin

/* ADC channels (CubeMX ranks). Only IN13/IN14 are real ADC pins. */
#define OZ_ADC_CH_VBAT       ADC_CHANNEL_13   /* PC4 */
#define OZ_ADC_CH_PYRO_BATT  ADC_CHANNEL_14   /* PC5 */

#endif /* OZONE_HAL_H */

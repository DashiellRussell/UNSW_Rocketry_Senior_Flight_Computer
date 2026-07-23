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

/* Pyro control / indication GPIO.
 *
 * ERR-007 (2026-07-23): the CubeMX .ioc pyro pin assignments are STALE and do
 * NOT match the fabbed board. Both v0.0 and v1.0 schematics agree on the pinout
 * below (verified via kicad-cli netlist); the .ioc/main.h macros were never
 * synced (they had PC6/PC7 continuity, and PB gates/arm/cont-LED permuted). We
 * define the OZ_ pins DIRECTLY here (overriding main.h) so the app drives the
 * real hardware pins. The GPIOB output pins {PB10,11,13,14,15} are the same set
 * either way, so main.c's MX_GPIO_Init still configures them correctly (all
 * push-pull out, init low); the continuity inputs move C6/C7 -> A0/A1, which
 * pyro_init() now configures. Re-sync the .ioc in CubeMX when convenient.
 *
 * Note PYRO1/2_CONT are on PA0/PA1 which ARE ADC-capable (IN5/IN6) -> this also
 * obsoletes ERR-002; analog continuity is possible on this board (future rev). */
#define OZ_PYRO1_GATE_PORT     GPIOB
#define OZ_PYRO1_GATE_PIN      GPIO_PIN_14
#define OZ_PYRO2_GATE_PORT     GPIOB
#define OZ_PYRO2_GATE_PIN      GPIO_PIN_15
#define OZ_PYRO_ARM_PORT       GPIOB
#define OZ_PYRO_ARM_PIN        GPIO_PIN_13
#define OZ_PYRO1_CONT_PORT     GPIOA
#define OZ_PYRO1_CONT_PIN      GPIO_PIN_0
#define OZ_PYRO2_CONT_PORT     GPIOA
#define OZ_PYRO2_CONT_PIN      GPIO_PIN_1
#define OZ_PYRO1_CONT_LED_PORT GPIOB
#define OZ_PYRO1_CONT_LED_PIN  GPIO_PIN_10
#define OZ_PYRO2_CONT_LED_PORT GPIOB
#define OZ_PYRO2_CONT_LED_PIN  GPIO_PIN_11

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
#define OZ_ADC_CH_PYRO_BATT  ADC_CHANNEL_9    /* PA4 (IN9) - schematic PYRO_BATT_SENSE; was stale ADC_CHANNEL_14/PC5 (ERR-007) */
/* Continuity is an analog divider (R25/R26 = 10k/3.3k) on ADC-capable pins,
 * read via the ADC and thresholded in software (ERR-007; obsoletes ERR-002). */
#define OZ_ADC_CH_PYRO1_CONT ADC_CHANNEL_5    /* PA0 */
#define OZ_ADC_CH_PYRO2_CONT ADC_CHANNEL_6    /* PA1 */

#endif /* OZONE_HAL_H */

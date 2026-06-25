/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.h
  * @brief          : Header for main.c file.
  *                   This file contains the common defines of the application.
  ******************************************************************************
  * @attention
  *
  * Copyright (c) 2026 STMicroelectronics.
  * All rights reserved.
  *
  * This software is licensed under terms that can be found in the LICENSE file
  * in the root directory of this software component.
  * If no LICENSE file comes with this software, it is provided AS-IS.
  *
  ******************************************************************************
  */
/* USER CODE END Header */

/* Define to prevent recursive inclusion -------------------------------------*/
#ifndef __MAIN_H
#define __MAIN_H

#ifdef __cplusplus
extern "C" {
#endif

/* Includes ------------------------------------------------------------------*/
#include "stm32l4xx_hal.h"

/* Private includes ----------------------------------------------------------*/
/* USER CODE BEGIN Includes */

/* USER CODE END Includes */

/* Exported types ------------------------------------------------------------*/
/* USER CODE BEGIN ET */

/* USER CODE END ET */

/* Exported constants --------------------------------------------------------*/
/* USER CODE BEGIN EC */

/* USER CODE END EC */

/* Exported macro ------------------------------------------------------------*/
/* USER CODE BEGIN EM */

/* USER CODE END EM */

void HAL_TIM_MspPostInit(TIM_HandleTypeDef *htim);

/* Exported functions prototypes ---------------------------------------------*/
void Error_Handler(void);

/* USER CODE BEGIN EFP */

/* USER CODE END EFP */

/* Private defines -----------------------------------------------------------*/
#define INT1_H3LIS_Pin GPIO_PIN_0
#define INT1_H3LIS_GPIO_Port GPIOC
#define INT1_LIS3DH_Pin GPIO_PIN_1
#define INT1_LIS3DH_GPIO_Port GPIOC
#define INT2_LIS3DH_Pin GPIO_PIN_2
#define INT2_LIS3DH_GPIO_Port GPIOC
#define SD_CD_Pin GPIO_PIN_3
#define SD_CD_GPIO_Port GPIOC
#define CS_H3LIS_Pin GPIO_PIN_0
#define CS_H3LIS_GPIO_Port GPIOB
#define CS_LIS3DH_Pin GPIO_PIN_1
#define CS_LIS3DH_GPIO_Port GPIOB
#define CS_MS5611_1_Pin GPIO_PIN_2
#define CS_MS5611_1_GPIO_Port GPIOB
#define PYRO1_GATE_Pin GPIO_PIN_10
#define PYRO1_GATE_GPIO_Port GPIOB
#define PYRO2_GATE_Pin GPIO_PIN_11
#define PYRO2_GATE_GPIO_Port GPIOB
#define CS_MS5611_2_Pin GPIO_PIN_12
#define CS_MS5611_2_GPIO_Port GPIOB
#define PYRO1_CONT_LED_Pin GPIO_PIN_13
#define PYRO1_CONT_LED_GPIO_Port GPIOB
#define PYRO2_CONT_LED_Pin GPIO_PIN_14
#define PYRO2_CONT_LED_GPIO_Port GPIOB
#define PYRO_ARM_Pin GPIO_PIN_15
#define PYRO_ARM_GPIO_Port GPIOB
#define PYRO1_CONT_Pin GPIO_PIN_6
#define PYRO1_CONT_GPIO_Port GPIOC
#define PYRO2_CONT_Pin GPIO_PIN_7
#define PYRO2_CONT_GPIO_Port GPIOC
#define LED_HEARTBEAT_Pin GPIO_PIN_6
#define LED_HEARTBEAT_GPIO_Port GPIOB
#define LED_ERROR_Pin GPIO_PIN_7
#define LED_ERROR_GPIO_Port GPIOB
#define PG_BUCKBOOST_Pin GPIO_PIN_8
#define PG_BUCKBOOST_GPIO_Port GPIOB
#define BUZZER_Pin GPIO_PIN_9
#define BUZZER_GPIO_Port GPIOB

/* USER CODE BEGIN Private defines */

/* USER CODE END Private defines */

#ifdef __cplusplus
}
#endif

#endif /* __MAIN_H */

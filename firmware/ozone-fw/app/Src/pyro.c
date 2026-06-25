#include "pyro.h"
#include "ozone_config.h"

static bool s_armed = false;

void pyro_init(void)
{
    HAL_GPIO_WritePin(OZ_PYRO_ARM_PORT,   OZ_PYRO_ARM_PIN,   GPIO_PIN_RESET);
    HAL_GPIO_WritePin(OZ_PYRO1_GATE_PORT, OZ_PYRO1_GATE_PIN, GPIO_PIN_RESET);
    HAL_GPIO_WritePin(OZ_PYRO2_GATE_PORT, OZ_PYRO2_GATE_PIN, GPIO_PIN_RESET);
    pyro_set_cont_led(PYRO_CH1, false);
    pyro_set_cont_led(PYRO_CH2, false);
    s_armed = false;
}

void pyro_arm(void)
{
    HAL_GPIO_WritePin(OZ_PYRO_ARM_PORT, OZ_PYRO_ARM_PIN, GPIO_PIN_SET);
    s_armed = true;
}

void pyro_disarm(void)
{
    HAL_GPIO_WritePin(OZ_PYRO1_GATE_PORT, OZ_PYRO1_GATE_PIN, GPIO_PIN_RESET);
    HAL_GPIO_WritePin(OZ_PYRO2_GATE_PORT, OZ_PYRO2_GATE_PIN, GPIO_PIN_RESET);
    HAL_GPIO_WritePin(OZ_PYRO_ARM_PORT,   OZ_PYRO_ARM_PIN,   GPIO_PIN_RESET);
    s_armed = false;
}

bool pyro_is_armed(void) { return s_armed; }

bool pyro_fire(pyro_channel_t ch)
{
    if (!s_armed) return false;

    GPIO_TypeDef *port = (ch == PYRO_CH1) ? OZ_PYRO1_GATE_PORT : OZ_PYRO2_GATE_PORT;
    uint16_t      pin  = (ch == PYRO_CH1) ? OZ_PYRO1_GATE_PIN  : OZ_PYRO2_GATE_PIN;

    HAL_GPIO_WritePin(port, pin, GPIO_PIN_SET);
    HAL_Delay(OZONE_PYRO_FIRE_MS);
    HAL_GPIO_WritePin(port, pin, GPIO_PIN_RESET);
    return true;
}

bool pyro_continuity(pyro_channel_t ch)
{
    GPIO_TypeDef *port = (ch == PYRO_CH1) ? OZ_PYRO1_CONT_PORT : OZ_PYRO2_CONT_PORT;
    uint16_t      pin  = (ch == PYRO_CH1) ? OZ_PYRO1_CONT_PIN  : OZ_PYRO2_CONT_PIN;
    return HAL_GPIO_ReadPin(port, pin) == OZONE_CONT_PRESENT_LEVEL;
}

void pyro_set_cont_led(pyro_channel_t ch, bool on)
{
    GPIO_TypeDef *port = (ch == PYRO_CH1) ? OZ_PYRO1_CONT_LED_PORT : OZ_PYRO2_CONT_LED_PORT;
    uint16_t      pin  = (ch == PYRO_CH1) ? OZ_PYRO1_CONT_LED_PIN  : OZ_PYRO2_CONT_LED_PIN;
    HAL_GPIO_WritePin(port, pin, on ? GPIO_PIN_SET : GPIO_PIN_RESET);
}

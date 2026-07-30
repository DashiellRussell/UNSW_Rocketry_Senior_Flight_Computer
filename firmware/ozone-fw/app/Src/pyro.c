#include "pyro.h"
#include "ozone_config.h"
#include "adc_sense.h"   /* analog continuity read (ERR-007) */

static bool s_armed = false;

void pyro_init(void)
{
    /* Continuity sense inputs on PA0/PA1 (ERR-007 re-pin to match the fabbed
     * board). Configured here rather than main.c's MX_GPIO_Init so the fix is
     * CubeMX-regen-safe. GPIOA clock is already enabled in MX_GPIO_Init. */
    GPIO_InitTypeDef gi = {0};
    gi.Pin  = OZ_PYRO1_CONT_PIN | OZ_PYRO2_CONT_PIN | GPIO_PIN_4;  /* PA0|PA1 cont, PA4 pyro-batt sense */
    gi.Mode = GPIO_MODE_ANALOG;                        /* dividers -> ADC (ERR-007) */
    gi.Pull = GPIO_NOPULL;
    HAL_GPIO_Init(GPIOA, &gi);

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
    /* ERR-007: analog read of the R25/R26 (or R27/R28) divider node. The node
     * sits near PYRO_BATT when an e-match bridges the live pyro rail, ~0 V open. */
    uint32_t chan = (ch == PYRO_CH1) ? OZ_ADC_CH_PYRO1_CONT : OZ_ADC_CH_PYRO2_CONT;
    uint16_t raw  = adc_read_raw(chan);
    if (raw == 0xFFFF) return false;
    float node_v = ((float)raw / OZONE_ADC_FULL_SCALE) * OZONE_ADC_VREF
                   * OZONE_PYRO_CONT_DIV_RATIO;
    return node_v > OZONE_CONT_THRESH_V;
}

uint16_t pyro_cont_node_mv(pyro_channel_t ch)
{
    uint32_t chan = (ch == PYRO_CH1) ? OZ_ADC_CH_PYRO1_CONT : OZ_ADC_CH_PYRO2_CONT;
    uint16_t raw  = adc_read_raw(chan);
    if (raw == 0xFFFF) return 0;
    float node_v = ((float)raw / OZONE_ADC_FULL_SCALE) * OZONE_ADC_VREF
                   * OZONE_PYRO_CONT_DIV_RATIO;
    return (uint16_t)(node_v * 1000.0f);
}

void pyro_set_cont_led(pyro_channel_t ch, bool on)
{
    GPIO_TypeDef *port = (ch == PYRO_CH1) ? OZ_PYRO1_CONT_LED_PORT : OZ_PYRO2_CONT_LED_PORT;
    uint16_t      pin  = (ch == PYRO_CH1) ? OZ_PYRO1_CONT_LED_PIN  : OZ_PYRO2_CONT_LED_PIN;
    HAL_GPIO_WritePin(port, pin, on ? GPIO_PIN_SET : GPIO_PIN_RESET);
}

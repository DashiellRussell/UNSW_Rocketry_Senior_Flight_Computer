#include "adc_sense.h"
#include "ozone_config.h"

uint16_t adc_read_raw(uint32_t channel)
{
    ADC_ChannelConfTypeDef cfg = {0};
    cfg.Channel      = channel;
    cfg.Rank         = ADC_REGULAR_RANK_1;
    cfg.SamplingTime = ADC_SAMPLETIME_247CYCLES_5;   /* high-Z dividers */
    cfg.SingleDiff   = ADC_SINGLE_ENDED;
    cfg.OffsetNumber = ADC_OFFSET_NONE;
    cfg.Offset       = 0;
    if (HAL_ADC_ConfigChannel(&hadc1, &cfg) != HAL_OK) return 0xFFFF;

    if (HAL_ADC_Start(&hadc1) != HAL_OK) return 0xFFFF;
    uint16_t raw = 0xFFFF;
    if (HAL_ADC_PollForConversion(&hadc1, 10) == HAL_OK)
        raw = (uint16_t)HAL_ADC_GetValue(&hadc1);
    HAL_ADC_Stop(&hadc1);
    return raw;
}

static float raw_to_node_v(uint16_t raw)
{
    return ((float)raw / OZONE_ADC_FULL_SCALE) * OZONE_ADC_VREF;
}

float adc_read_vbat(void)
{
    uint16_t raw = adc_read_raw(OZ_ADC_CH_VBAT);
    if (raw == 0xFFFF) return -1.0f;
    return raw_to_node_v(raw) * OZONE_VBAT_DIV_RATIO;
}

float adc_read_pyro_vbat(void)
{
    uint16_t raw = adc_read_raw(OZ_ADC_CH_PYRO_BATT);
    if (raw == 0xFFFF) return -1.0f;
    return raw_to_node_v(raw) * OZONE_PYRO_DIV_RATIO;
}

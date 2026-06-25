#include "telemetry.h"
#include "ozone_hal.h"
#include <stdarg.h>
#include <stdio.h>
#include <string.h>

void telemetry_init(void) { /* USART2 brought up by CubeMX MX_USART2_UART_Init */ }

void telemetry_printf(const char *fmt, ...)
{
    char buf[160];
    va_list ap;
    va_start(ap, fmt);
    int n = vsnprintf(buf, sizeof(buf), fmt, ap);
    va_end(ap);
    if (n < 0) return;
    if (n > (int)sizeof(buf)) n = sizeof(buf);
    HAL_UART_Transmit(&huart2, (uint8_t *)buf, (uint16_t)n, 100);
}

void telemetry_status(const sensor_sample_t *s, flight_state_t st,
                      float vbat, float pyro_vbat,
                      bool cont1, bool cont2, bool armed)
{
    telemetry_printf(
        "[OZONE] st=%s alt=%.1fm agl=%.1fm P=%.0fPa T=%.1fC "
        "hi_g=%.1f lo_g=%.2f vbat=%.2fV pyro=%.2fV cont1=%d cont2=%d arm=%d\r\n",
        flight_state_name(st),
        s->altitude_m, s->altitude_agl_m, s->pressure_pa, s->temperature_c,
        s->hi_g_mag, s->lo_g_mag, vbat, pyro_vbat,
        cont1 ? 1 : 0, cont2 ? 1 : 0, armed ? 1 : 0);
}

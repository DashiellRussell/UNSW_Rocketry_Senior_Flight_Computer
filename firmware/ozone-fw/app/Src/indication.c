#include "indication.h"

/* TIM1 ARR = 1000-1 (see CubeMX walkthrough): duty 0..1000. */
#define PWM_MAX  1000

static ind_state_t s_state = IND_IDLE;
static bool        s_buzzer_pattern = false;
static uint32_t    s_buzzer_last = 0;
static bool        s_buzzer_on = false;

static void rgb_write(uint16_t r, uint16_t g, uint16_t b)
{
    __HAL_TIM_SET_COMPARE(&htim1, TIM_CHANNEL_1, r);
    __HAL_TIM_SET_COMPARE(&htim1, TIM_CHANNEL_2, g);
    __HAL_TIM_SET_COMPARE(&htim1, TIM_CHANNEL_3, b);
}

void indication_init(void)
{
    HAL_TIM_PWM_Start(&htim1, TIM_CHANNEL_1);
    HAL_TIM_PWM_Start(&htim1, TIM_CHANNEL_2);
    HAL_TIM_PWM_Start(&htim1, TIM_CHANNEL_3);
    buzzer_off();              /* TIM6 stays stopped until a tone is requested */
    rgb_write(0, 0, 0);
    s_state = IND_IDLE;
}

void indication_set(ind_state_t st) { s_state = st; }

/* ---- startup signalling -------------------------------------------- */
/* Tones chosen near the CPT-9019S piezo resonance (~4 kHz) so they're loud;
 * pitch still rises/falls audibly to distinguish boot states. */
#define NOTE_LO   2200u
#define NOTE_MID  3300u
#define NOTE_HI   4400u

static void beep(uint32_t freq, uint32_t ms)
{
    buzzer_tone(freq); HAL_Delay(ms); buzzer_off();
}

void indication_post_lamptest(void)
{
    /* R/G/B channel test + a rising 3-note chirp = power, buzzer and all three
     * LED channels verified in one go. */
    rgb_write(PWM_MAX, 0, 0); beep(NOTE_LO, 150);  HAL_Delay(70);
    rgb_write(0, PWM_MAX, 0); beep(NOTE_MID, 150); HAL_Delay(70);
    rgb_write(0, 0, PWM_MAX); beep(NOTE_HI, 150);  HAL_Delay(70);
    rgb_write(0, 0, 0);       HAL_Delay(120);
}

void indication_boot_begin(void)
{
    rgb_write(0, 0, PWM_MAX);                    /* steady blue */
}

void indication_boot_ok(void)
{
    /* green double-flash + quick happy rising chime */
    rgb_write(0, PWM_MAX, 0); beep(NOTE_MID, 90); HAL_Delay(40);
    rgb_write(0, 0, 0);       HAL_Delay(60);
    rgb_write(0, PWM_MAX, 0); beep(NOTE_HI, 140);
    rgb_write(0, PWM_MAX, 0);                    /* settle green */
}

void indication_boot_fault(uint8_t code)
{
    /* low error tone, then `code` red blinks each with a beep (audible code) */
    rgb_write(PWM_MAX, 0, 0); beep(NOTE_LO, 600);
    HAL_Delay(250);
    for (uint8_t i = 0; i < code; i++) {
        rgb_write(0, 0, 0);       HAL_Delay(250);
        rgb_write(PWM_MAX, 0, 0); beep(NOTE_MID, 200); HAL_Delay(60);
    }
    rgb_write(PWM_MAX, 0, 0);                     /* hold red */
}

void indication_heartbeat_toggle(void)
{
    HAL_GPIO_TogglePin(OZ_LED_HB_PORT, OZ_LED_HB_PIN);
}

void indication_error(bool on)
{
    HAL_GPIO_WritePin(OZ_LED_ERR_PORT, OZ_LED_ERR_PIN,
                      on ? GPIO_PIN_SET : GPIO_PIN_RESET);
}

/* Triangle wave 0..MAX..0 over ~2 s for "breathing". */
static uint16_t breathe(uint32_t now_ms)
{
    uint32_t p = now_ms % 2000;
    uint32_t v = (p < 1000) ? p : (2000 - p);
    return (uint16_t)(v * PWM_MAX / 1000);
}

void indication_task(uint32_t now_ms)
{
    switch (s_state) {
        case IND_IDLE:       rgb_write(0, PWM_MAX, 0); break;       /* green   */
        case IND_ARMED:      rgb_write(0, 0, breathe(now_ms)); break;/* blue br.*/
        case IND_FLIGHT:     rgb_write(PWM_MAX, 0, PWM_MAX); break; /* magenta */
        case IND_LANDED:     rgb_write(0, PWM_MAX, PWM_MAX); break; /* cyan    */
        case IND_FAULT:      rgb_write(PWM_MAX, 0, 0); break;       /* red     */
        case IND_LOW_BATT:
            rgb_write((now_ms % 600 < 300) ? PWM_MAX : 0, 0, 0);   /* red blink*/
            break;
        case IND_PYRO_FIRED:
            rgb_write((now_ms % 200 < 100) ? PWM_MAX : 0,
                      (now_ms % 200 < 100) ? PWM_MAX : 0,
                      (now_ms % 200 < 100) ? PWM_MAX : 0);         /* white fl.*/
            break;
    }

    /* Recovery beep: 200 ms tone every 2 s. */
    if (s_buzzer_pattern) {
        if (!s_buzzer_on && (now_ms - s_buzzer_last) >= 2000) {
            buzzer_tone(4000); s_buzzer_on = true; s_buzzer_last = now_ms;
        } else if (s_buzzer_on && (now_ms - s_buzzer_last) >= 200) {
            buzzer_off(); s_buzzer_on = false; s_buzzer_last = now_ms;
        }
    }
}

/*
 * Software PWM: PB9 has no timer channel on the STM32L452, so the buzzer is a
 * GPIO toggled at 2x the tone frequency from the TIM6 update interrupt.
 * TIM6 kernel clock = 80 MHz (PSC left at 0 in CubeMX; driver sets ARR).
 */
void buzzer_tone(uint32_t freq_hz)
{
    if (freq_hz == 0) { buzzer_off(); return; }
    uint32_t arr = (80000000UL / (2UL * freq_hz)) - 1UL;   /* toggle at 2*f */
    __HAL_TIM_SET_AUTORELOAD(&htim6, arr);
    __HAL_TIM_SET_COUNTER(&htim6, 0);
    HAL_TIM_Base_Start_IT(&htim6);
}

void buzzer_off(void)
{
    HAL_TIM_Base_Stop_IT(&htim6);
    HAL_GPIO_WritePin(OZ_BUZZER_PORT, OZ_BUZZER_PIN, GPIO_PIN_RESET);
}

/* TIM6 update ISR -> toggle the buzzer pin. If you use other timer-base
 * interrupts, merge their handling into this single weak-override callback. */
void HAL_TIM_PeriodElapsedCallback(TIM_HandleTypeDef *htim)
{
    if (htim->Instance == TIM6)
        HAL_GPIO_TogglePin(OZ_BUZZER_PORT, OZ_BUZZER_PIN);
}

void buzzer_recovery_pattern(bool enable)
{
    s_buzzer_pattern = enable;
    if (!enable) buzzer_off();
}

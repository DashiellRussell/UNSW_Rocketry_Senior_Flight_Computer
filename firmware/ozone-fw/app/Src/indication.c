#include "indication.h"
#include "ozone_config.h"

/* TIM1 ARR = 1000-1 (see CubeMX walkthrough): duty 0..1000. */
#define PWM_MAX  1000

/* ── RGB channel + brightness mapping ───────────────────────────────────
 * The fitted 5050 part is pin-order G-R-B (TCWIN TC5050RGBF08), while the
 * board nets RGB_R/G/B map to TIM1 CH1/CH2/CH3. If a colour comes out wrong on
 * the bench, change which TIM_CHANNEL each logical colour drives below.
 * The *_SCALE factors (0..100 %) trim per-channel brightness in software so you
 * can balance white without touching the 150/100/100 resistors. */
/* Final map confirmed 2026-06-26 against the schematic pin->colour nets:
 *   pin 41 = PA8  = TIM1_CH1 = BLUE die
 *   pin 42 = PA9  = TIM1_CH2 = RED die
 *   pin 43 = PA10 = TIM1_CH3 = GREEN die
 * (Earlier guess had RED on CH3 / GREEN on CH2 swapped, so green never lit -
 *  "green" drove pin 42 = red die. Now each logical colour drives its real pin.) */
#define RGB_CH_RED     TIM_CHANNEL_2     /* PA9  / pin 42 -> RED die   */
#define RGB_CH_GREEN   TIM_CHANNEL_3     /* PA10 / pin 43 -> GREEN die */
#define RGB_CH_BLUE    TIM_CHANNEL_1     /* PA8  / pin 41 -> BLUE die  */
#define RGB_SCALE_RED    100
#define RGB_SCALE_GREEN  100
#define RGB_SCALE_BLUE   100

static ind_state_t s_state = IND_IDLE;
static bool        s_buzzer_pattern = false;
static uint32_t    s_buzzer_last = 0;
static bool        s_buzzer_on = false;

static void rgb_write(uint16_t r, uint16_t g, uint16_t b)
{
    __HAL_TIM_SET_COMPARE(&htim1, RGB_CH_RED,   (uint16_t)(r * RGB_SCALE_RED   / 100));
    __HAL_TIM_SET_COMPARE(&htim1, RGB_CH_GREEN, (uint16_t)(g * RGB_SCALE_GREEN / 100));
    __HAL_TIM_SET_COMPARE(&htim1, RGB_CH_BLUE,  (uint16_t)(b * RGB_SCALE_BLUE  / 100));
}

void indication_init(void)
{
    /* CubeMX generated TIM1_CH3 as Output-Compare "timing" mode
     * (TIM_OCMODE_TIMING in MX_TIM1_Init), which drives NO pin output - so the
     * GREEN channel (CH3 / PA10 / pin 43) could never light no matter the colour
     * map. Re-arm CH3 as real PWM here (regen-safe). Permanent fix: in CubeMX
     * set TIM1 Channel3 = "PWM Generation CH3" and regenerate, then this block
     * is harmless/redundant. */
    TIM_OC_InitTypeDef oc = {0};
    oc.OCMode       = TIM_OCMODE_PWM1;
    oc.Pulse        = 0;
    oc.OCPolarity   = TIM_OCPOLARITY_HIGH;
    oc.OCNPolarity  = TIM_OCNPOLARITY_HIGH;
    oc.OCFastMode   = TIM_OCFAST_DISABLE;
    oc.OCIdleState  = TIM_OCIDLESTATE_RESET;
    oc.OCNIdleState = TIM_OCNIDLESTATE_RESET;
    HAL_TIM_PWM_ConfigChannel(&htim1, &oc, TIM_CHANNEL_3);

    HAL_TIM_PWM_Start(&htim1, TIM_CHANNEL_1);
    HAL_TIM_PWM_Start(&htim1, TIM_CHANNEL_2);
    HAL_TIM_PWM_Start(&htim1, TIM_CHANNEL_3);

    /* Enable the TIM6 update interrupt here (the CubeMX NVIC checkbox for
     * "TIM6 global interrupt" was not ticked). This is what makes the buzzer
     * ISR below actually fire. Doing it in our code keeps it regen-safe.
     * NOTE: if you ever tick that box in CubeMX, remove our TIM6_DAC_IRQHandler
     * below to avoid a duplicate-symbol link error. */
    HAL_NVIC_SetPriority(TIM6_DAC_IRQn, 5, 0);
    HAL_NVIC_EnableIRQ(TIM6_DAC_IRQn);

    buzzer_off();              /* TIM6 stays stopped until a tone is requested */
    rgb_write(0, 0, 0);
    s_state = IND_IDLE;
}

/* TIM6 update IRQ (vector is weak in the startup file; defining it here
 * overrides it). Routes into HAL -> HAL_TIM_PeriodElapsedCallback -> toggles
 * the buzzer pin. */
void TIM6_DAC_IRQHandler(void)
{
    HAL_TIM_IRQHandler(&htim6);
}

/* Continuous armed tone: audible reminder that the pyro rail is live.
 * Edge-triggered so repeated indication_set(IND_ARMED) calls each loop don't
 * keep resetting TIM6's counter. */
void indication_set(ind_state_t st)
{
    if (st == s_state) return;
    if (st == IND_ARMED) {
        buzzer_tone(OZONE_BUZZER_RESONANCE_HZ);
    } else if (s_state == IND_ARMED) {
        buzzer_off();
    }
    s_state = st;
}

void indication_solid(uint16_t r, uint16_t g, uint16_t b) { rgb_write(r, g, b); }

/* ---- startup signalling -------------------------------------------- */
/* The CPT-9019S is loudest right at resonance, so keep all tones clustered
 * tightly around OZONE_BUZZER_RESONANCE_HZ - a small +/- spread is still
 * audibly distinguishable but stays in the loud part of the response curve.
 * (The old 2.2/3.3 kHz tones were well off resonance => very quiet.) */
#define NOTE_LO   (OZONE_BUZZER_RESONANCE_HZ - 600u)   /* ~3400 Hz */
#define NOTE_MID  (OZONE_BUZZER_RESONANCE_HZ)          /* ~4000 Hz, loudest */
#define NOTE_HI   (OZONE_BUZZER_RESONANCE_HZ + 500u)   /* ~4500 Hz */

static void beep(uint32_t freq, uint32_t ms)
{
    buzzer_tone(freq); HAL_Delay(ms); buzzer_off();
}

/* "Ode to Joy" opening phrase - Beethoven's 9th Symphony main theme
 * (public domain, composed 1824). ~4.8 s at a moderate quarter-note tempo.
 * freq_hz==0 is a rest. Blocking; fine for a deliberate ground-op novelty
 * action, same pattern as indication_post_lamptest(). */
void buzzer_play_tune(void)
{
    static const struct { uint32_t freq_hz, ms; } notes[] = {
        {330, 300}, {330, 300}, {349, 300}, {392, 300},   /* E E F G   */
        {392, 300}, {349, 300}, {330, 300}, {294, 300},   /* G F E D   */
        {262, 300}, {262, 300}, {294, 300}, {330, 300},   /* C C D E   */
        {330, 450}, {294, 150}, {294, 600},                /* E. D D.  */
    };
    for (int i = 0; i < (int)(sizeof(notes) / sizeof(notes[0])); i++) {
        if (notes[i].freq_hz) beep(notes[i].freq_hz, notes[i].ms);
        else                  HAL_Delay(notes[i].ms);
    }
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

    /* Recovery beep: 200 ms tone every 2 s - drive at resonance so the
     * post-landing locator is as loud as possible. */
    if (s_buzzer_pattern) {
        if (!s_buzzer_on && (now_ms - s_buzzer_last) >= 2000) {
            buzzer_tone(OZONE_BUZZER_RESONANCE_HZ); s_buzzer_on = true; s_buzzer_last = now_ms;
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

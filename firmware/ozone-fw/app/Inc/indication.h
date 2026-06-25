/**
 * indication.h - RGB status LED (TIM1 PWM), heartbeat/error LEDs, piezo buzzer.
 *
 * RGB colour map mirrors doc 10.1. Call indication_task() periodically (e.g.
 * every loop) to service blink/breathe/buzzer timing; it is non-blocking.
 */
#ifndef INDICATION_H
#define INDICATION_H

#include "ozone_hal.h"
#include <stdbool.h>
#include <stdint.h>

typedef enum {
    IND_IDLE = 0,       /* green steady   */
    IND_ARMED,          /* blue breathing */
    IND_FLIGHT,         /* magenta        */
    IND_LANDED,         /* cyan           */
    IND_FAULT,          /* red steady     */
    IND_LOW_BATT,       /* red blink      */
    IND_PYRO_FIRED,     /* white flash    */
} ind_state_t;

void indication_init(void);
void indication_set(ind_state_t st);
void indication_task(uint32_t now_ms);

/* ---- startup signalling (blocking, boot-time only) ---------------- */
/* Lamp test: flash Red, Green, Blue in turn so you can confirm all three
 * RGB channels work right after soldering. */
void indication_post_lamptest(void);
/* Steady blue = bring-up / self-test in progress. */
void indication_boot_begin(void);
/* Green confirmation flash = all checks passed. */
void indication_boot_ok(void);
/* Red, then `code` slow red blinks, then steady red. Blink count = which
 * subsystem failed: 1=barometers 2=accelerometers 3=SD card. */
void indication_boot_fault(uint8_t code);

/* Heartbeat LED (PB6) toggle - call from a 1 Hz-ish cadence. */
void indication_heartbeat_toggle(void);
void indication_error(bool on);

/* Buzzer: start a continuous tone (Hz) or a recovery beep pattern. */
void buzzer_tone(uint32_t freq_hz);
void buzzer_off(void);
void buzzer_recovery_pattern(bool enable);

#endif /* INDICATION_H */

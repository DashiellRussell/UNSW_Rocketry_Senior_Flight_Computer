/**
 * ozone_config.h - Mission-tunable constants for Project OZONE flight computer.
 *
 * Everything a team member might want to change between flights lives here.
 * Values flagged "CALIBRATE" must be measured on the bench before flight.
 */
#ifndef OZONE_CONFIG_H
#define OZONE_CONFIG_H

/* ------------------------------------------------------------------ */
/* Buzzer (Same Sky/CUI CPT-9019S-SMT-TR PIEZO transducer, externally driven) */
/* ------------------------------------------------------------------ */
/* Datasheet: rated freq 4000 Hz, SPL 65 dB @10cm @3Vp-p, ~12 nF capacitance,
 * absolute max 25 Vp-p (lots of drive headroom). Being PIEZO it's a capacitor,
 * not a coil - it needs a DISCHARGE RESISTOR across it (~1k) or it can't swing
 * and is very quiet (see ERR-006). The broadband response peaks above 4 kHz,
 * so use the buzzer-test sweep (3-6 kHz) to find the loudest point for THIS
 * unit and set it here. Driver already outputs a 50%% square wave. */
#define OZONE_BUZZER_RESONANCE_HZ   4000u   /* TUNE: loudest freq from sweep */

/* ------------------------------------------------------------------ */
/* Power / battery sensing                                            */
/* ------------------------------------------------------------------ */
/* VBAT_SENSE divider (schematic Power sheet: R6=100k top, R7=33k bottom). */
/* Single-point cal 2026-06-26: nominal 133/33 read 5.38 V where the DMM said
 * 5.99 V (resistor tolerance + VREF error), so trim by 5.99/5.38. Re-check at a
 * second voltage; if the error isn't a constant ratio it's an offset not gain. */
#define OZONE_VBAT_DIV_RATIO        (133.0f / 33.0f * (5.99f / 5.38f))
/* PYRO_BATT_SENSE divider (Pyro sheet: R15=10k top, R16=3.3k bottom).      */
#define OZONE_PYRO_DIV_RATIO        (13.3f / 3.3f)     /* CALIBRATE against DMM */
#define OZONE_ADC_VREF              (3.30f)
#define OZONE_ADC_FULL_SCALE        (4095.0f)          /* 12-bit */

#define OZONE_VBAT_LOW_1S           (3.60f)            /* low-batt warning, 1S */
#define OZONE_VBAT_LOW_2S           (7.20f)            /* low-batt warning, 2S */

/* ------------------------------------------------------------------ */
/* Sensor full-scale ranges                                          */
/* ------------------------------------------------------------------ */
#define OZONE_H3LIS_RANGE_G         400                /* 100 / 200 / 400 */
#define OZONE_LIS3DH_RANGE_G        16                 /* 2 / 4 / 8 / 16  */

/* ------------------------------------------------------------------ */
/* Flight state machine thresholds                                   */
/* ------------------------------------------------------------------ */
/* Launch detect: sustained high-g on the high-g accelerometer.       */
#define OZONE_LAUNCH_ACCEL_G        4.0f               /* g, sustained   */
#define OZONE_LAUNCH_HOLD_MS        100                /* must persist   */

/* Apogee voting / deployment safety (doc section 7.5, 15.4).          */
#define OZONE_APOGEE_BARO_DV        (-0.5f)            /* m/s, vel crosses neg (legacy) */
#define OZONE_APOGEE_TIMER_MS       30000              /* timer backup voter   */
#define OZONE_ALT_LOCKOUT_M         200.0f             /* no fire below this AGL*/
#define OZONE_VEL_LOCKOUT_MS        3.0f               /* min descent m/s (legacy) */
/* Rolling-average apogee detector (primary, noise-robust): apogee = smoothed
 * altitude fell OZONE_APOGEE_DROP_M below its peak for DEBOUNCE_N samples. */
#define OZONE_APOGEE_DROP_M         10.0f              /* CALIBRATE: peak drop margin */
#define OZONE_APOGEE_DEBOUNCE_N     5                  /* sustained descent samples   */

/* Main chute deploy altitude AGL (doc: typ. 500-1000 ft -> ~150-300 m). */
#define OZONE_MAIN_DEPLOY_AGL_M     300.0f

/* Landing detect: low accel + stable altitude for a hold time.        */
#define OZONE_LAND_ALT_STABLE_M     2.0f
#define OZONE_LAND_HOLD_MS          5000

/* Pyro firing pulse + ground-test mandatory delay.                    */
#define OZONE_PYRO_FIRE_MS          1000               /* gate-high duration   */
#define OZONE_GROUND_TEST_DELAY_MS  10000              /* doc section 13.5     */

/* Continuity: PC6/PC7 are GPIO (not ADC on L452). HIGH at the divider */
/* node = e-match present. Active level set here in case of inversion.  */
/* ERR-007: continuity is an ANALOG divider (R25/R26 = 10k/3.3k, same ratio as
 * OZONE_PYRO_DIV_RATIO) read via the ADC, NOT a digital pin. "Present" = the
 * sensed node voltage exceeds this threshold (node ~ PYRO_BATT when an e-match
 * bridges the live pyro rail; ~0 V when open). CALIBRATE against your pack. */
#define OZONE_CONT_THRESH_V         (1.0f)   /* volts at the divider node */

/* ------------------------------------------------------------------ */
/* Logging                                                           */
/* ------------------------------------------------------------------ */
#define OZONE_LOG_RATE_HZ           20                 /* sample rate during flight */
#define OZONE_LOG_FILENAME_FMT      "OZONE%03u.CSV"
#define OZONE_LOG_PREALLOC_BYTES    (8u * 1024u * 1024u)

/* Sea-level reference pressure for altitude (Pa). Set from pad reading. */
#define OZONE_SEALEVEL_PA           101325.0f

#endif /* OZONE_CONFIG_H */

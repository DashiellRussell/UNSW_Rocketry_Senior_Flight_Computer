/**
 * ozone_config.h - Mission-tunable constants for Project OZONE flight computer.
 *
 * Everything a team member might want to change between flights lives here.
 * Values flagged "CALIBRATE" must be measured on the bench before flight.
 */
#ifndef OZONE_CONFIG_H
#define OZONE_CONFIG_H

/* ------------------------------------------------------------------ */
/* Power / battery sensing                                            */
/* ------------------------------------------------------------------ */
/* VBAT_SENSE divider (schematic Power sheet: R6=100k top, R7=33k bottom). */
#define OZONE_VBAT_DIV_RATIO        (133.0f / 33.0f)   /* CALIBRATE against DMM */
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
#define OZONE_APOGEE_BARO_DV        (-0.5f)            /* m/s, vel crosses neg */
#define OZONE_APOGEE_TIMER_MS       30000              /* timer backup voter   */
#define OZONE_ALT_LOCKOUT_M         200.0f             /* no fire below this AGL*/
#define OZONE_VEL_LOCKOUT_MS        3.0f               /* min descent m/s      */

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
#define OZONE_CONT_PRESENT_LEVEL    GPIO_PIN_SET

/* ------------------------------------------------------------------ */
/* Logging                                                           */
/* ------------------------------------------------------------------ */
#define OZONE_LOG_RATE_HZ           20                 /* sample rate during flight */
#define OZONE_LOG_FILENAME_FMT      "OZONE%03u.CSV"
#define OZONE_LOG_PREALLOC_BYTES    (8u * 1024u * 1024u)

/* Sea-level reference pressure for altitude (Pa). Set from pad reading. */
#define OZONE_SEALEVEL_PA           101325.0f

#endif /* OZONE_CONFIG_H */

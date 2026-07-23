#include "ozone_app.h"
#include "ozone_hal.h"
#include "ozone_config.h"
#include "spi_bus.h"
#include "sensors.h"
#include "adc_sense.h"
#include "pyro.h"
#include "indication.h"
#include "logging.h"
#include "telemetry.h"
#include "flight.h"
#include "usb_cli.h"
#include "console.h"
#include "link_uart.h"
#include "fcd.h"

/* ---- subsystem state ---------------------------------------------- */
static sensor_suite_t  g_sensors;
static sensor_sample_t g_sample;
static flight_ctx_t    g_flight;

static volatile bool g_arm_request = false;
static volatile bool g_disarm_request = false;
static volatile int  g_ground_test_request = -1;   /* -1 none, 0/1 channel */
static uint32_t      g_ground_test_start = 0;

static uint32_t g_last_log_ms = 0;
static uint32_t g_last_tele_ms = 0;
static uint32_t g_last_hb_ms = 0;

/* ---- request hooks (called from console / BT parser) -------------- */
void ozone_app_request_arm(void) { g_arm_request = true; }
void ozone_app_request_ground_test(int ch) { g_ground_test_request = ch; }
static void app_disarm(void)      { g_disarm_request = true; }
static void app_zero_ground(void) { sensors_zero_ground(&g_sensors, &g_sample); }

/* FCD telecom hooks. */
static void app_log_start(void)   { logging_init(); }
static void app_log_stop(void)    { logging_close(); }

/* Physical "identify / locate": cyan flash + chirp x3 so the operator can tell
 * which board this ground-station link is talking to. Brief blocking ground op. */
static void app_identify(void)
{
    for (int i = 0; i < 3; i++) {
        indication_solid(0, 1000, 1000);            /* cyan */
        buzzer_tone(OZONE_BUZZER_RESONANCE_HZ);
        HAL_Delay(120);
        indication_solid(0, 0, 0);
        buzzer_off();
        HAL_Delay(100);
    }
}

/* Subsystem health for the FCD telemetry (drives the ground-station checks). */
static bool app_power_good(void)
{
    return HAL_GPIO_ReadPin(OZ_PG_BUCK_PORT, OZ_PG_BUCK_PIN) == GPIO_PIN_SET;
}
static bool app_sd_ok(void) { return logging_active(); }
static bool app_fire(pyro_channel_t ch)   /* immediate fire after trigger auth */
{
    logging_event(HAL_GetTick(), ch == PYRO_CH1 ? "FIRE_DROGUE" : "FIRE_MAIN");
    indication_set(IND_PYRO_FIRED);
    return pyro_fire(ch);
}

/* ---- init --------------------------------------------------------- */
void ozone_app_init(void)
{
    /* Safety first: deselect sensors, pyro gates low (doc 15.2). */
    spi_bus_deselect_all();
    pyro_init();
    indication_init();
    telemetry_init();
    usb_cli_init();

    /* Startup signalling: RGB lamp test, then steady blue = bring-up. */
    indication_post_lamptest();
    indication_boot_begin();

    telemetry_printf("\r\n[OZONE] boot\r\n");

    /* Sensor bring-up + WHO_AM_I report. */
    bool ok = sensors_init(&g_sensors);
    telemetry_printf("[OZONE] sensors: baro1=%d baro2=%d hi_g=%d(0x%02X) lo_g=%d(0x%02X)\r\n",
                     g_sensors.baro1.healthy, g_sensors.baro2.healthy,
                     g_sensors.hi_g.healthy, h3lis_whoami(),
                     g_sensors.lo_g.healthy, lis3dh_whoami());

    /* SD card. */
    log_status_t ls = logging_init();
    telemetry_printf("[OZONE] sdcard: %d\r\n", ls);

    /* Boot result on the RGB: green flash if all good, else red + blink code
     * (1=baro, 2=accel, 3=SD) so you can diagnose at a glance after soldering. */
    if (!ok || ls != LOG_OK) {
        uint8_t fault = 0;
        if (!g_sensors.baro1.healthy || !g_sensors.baro2.healthy) fault = 1;
        else if (!g_sensors.hi_g.healthy || !g_sensors.lo_g.healthy) fault = 2;
        else if (ls != LOG_OK) fault = 3;
        indication_error(true);
        indication_boot_fault(fault);
        indication_set(IND_FAULT);
    } else {
        indication_error(false);   /* clear any stale error latch on a clean boot */
        indication_boot_ok();
        indication_set(IND_IDLE);
    }

    /* Establish ground-level altitude reference while idle on the pad. */
    sensors_zero_ground(&g_sensors, &g_sample);
    telemetry_printf("[OZONE] ground alt set to %.1f m\r\n", g_sensors.ground_alt_m);

    flight_init(&g_flight);
    logging_event(HAL_GetTick(), "BOOT");

    /* USB-C ground console (preflight / test / post-flight menus). */
    static const console_ctx_t cctx = {
        .sensors        = &g_sensors,
        .sample         = &g_sample,
        .flight         = &g_flight,
        .arm            = ozone_app_request_arm,
        .disarm         = app_disarm,
        .ground_test    = ozone_app_request_ground_test,
        .zero_ground    = app_zero_ground,
        .read_vbat      = adc_read_vbat,
        .read_pyro_vbat = adc_read_pyro_vbat,
    };
    console_init(&cctx);

    /* Telecom link: FCD self-describing protocol over USART2 (radio / ESP32
     * hub). Enables UART RX + streams telemetry + accepts ground commands.
     * Pyro fire requests go through pyro_trigger (fire_mode handshake); the
     * key switch + continuity in pyro.c remain the hardware guards. */
    link_uart_init();
    static const fcd_ctx_t fctx = {
        .sample         = &g_sample,
        .flight         = &g_flight,
        .read_vbat      = adc_read_vbat,
        .read_pyro_vbat = adc_read_pyro_vbat,
        .arm            = ozone_app_request_arm,
        .disarm         = app_disarm,
        .zero_ground    = app_zero_ground,
        .fire           = app_fire,
        .log_start      = app_log_start,
        .log_stop       = app_log_stop,
        .identify       = app_identify,
        .power_good     = app_power_good,
        .sd_ok          = app_sd_ok,
    };
    fcd_init(&fctx);
}

/* ---- helpers ------------------------------------------------------ */
static void map_indication(flight_state_t st, float vbat)
{
    bool low = vbat > 0 && vbat < OZONE_VBAT_LOW_1S;   /* refine for 2S in fw */
    switch (st) {
        case FS_IDLE:  indication_set(low ? IND_LOW_BATT : IND_IDLE);  break;
        case FS_ARMED: indication_set(IND_ARMED);  break;
        case FS_BOOST:
        case FS_COAST:
        case FS_DROGUE:
        case FS_MAIN_DESCENT: indication_set(IND_FLIGHT); break;
        case FS_LANDED: indication_set(IND_LANDED); break;
        case FS_FAULT:  indication_set(IND_FAULT);  break;
        default: break;
    }
}

static void do_deploy(deploy_cmd_t cmd)
{
    if (cmd == DEPLOY_DROGUE) {
        logging_event(HAL_GetTick(), "FIRE_DROGUE");
        indication_set(IND_PYRO_FIRED);
        pyro_fire(PYRO_CH1);
    } else if (cmd == DEPLOY_MAIN) {
        logging_event(HAL_GetTick(), "FIRE_MAIN");
        indication_set(IND_PYRO_FIRED);
        pyro_fire(PYRO_CH2);
    }
}

/* ---- super-loop iteration ----------------------------------------- */
void ozone_app_run(void)
{
    uint32_t now = HAL_GetTick();

    /* 1. Sensors (barometer SM + accelerometers). */
    bool fresh_baro = sensors_update(&g_sensors, &g_sample, now);

    /* 2. Arm / disarm request handling (console / external key / BT). */
    if (g_arm_request && g_flight.state == FS_IDLE) {
        g_arm_request = false;
        pyro_arm();
        flight_arm(&g_flight);
        logging_event(now, "ARMED");
    }
    if (g_disarm_request) {
        g_disarm_request = false;
        pyro_disarm();
        if (g_flight.state == FS_ARMED) g_flight.state = FS_IDLE;
        logging_event(now, "DISARMED");
    }

    /* 3. Flight state machine -> deployment. */
    flight_state_t prev = g_flight.state;
    deploy_cmd_t cmd = flight_update(&g_flight, &g_sample, now);
    if (g_flight.state != prev)
        logging_event(now, flight_state_name(g_flight.state));
    if (cmd != DEPLOY_NONE)
        do_deploy(cmd);

    if (g_flight.state == FS_LANDED) {
        buzzer_recovery_pattern(true);
        logging_close();      /* idempotent after first call */
        pyro_disarm();
    }

    /* 4. Ground-test fire (bench only): 10 s mandatory delay (doc 13.5). */
    if (g_ground_test_request >= 0) {
        if (g_ground_test_start == 0) {
            g_ground_test_start = now;
            telemetry_printf("[OZONE] ground-test ch%d: 10s countdown\r\n",
                             g_ground_test_request + 1);
        } else if ((now - g_ground_test_start) >= OZONE_GROUND_TEST_DELAY_MS) {
            if (pyro_is_armed())
                pyro_fire(g_ground_test_request == 0 ? PYRO_CH1 : PYRO_CH2);
            g_ground_test_request = -1;
            g_ground_test_start = 0;
        }
    }

    /* 5. Continuity LEDs (preflight check aid). */
    bool c1 = pyro_continuity(PYRO_CH1);
    bool c2 = pyro_continuity(PYRO_CH2);
    pyro_set_cont_led(PYRO_CH1, c1);
    pyro_set_cont_led(PYRO_CH2, c2);

    /* 6. Logging at configured rate. */
    if (g_flight.state != FS_LANDED &&
        (now - g_last_log_ms) >= (1000u / OZONE_LOG_RATE_HZ)) {
        g_last_log_ms = now;
        if (logging_write(&g_sample, g_flight.state, c1, c2,
                          g_flight.drogue_fired, g_flight.main_fired) == LOG_WRITE_FAIL)
            indication_error(true);
    }

    /* 7. Telemetry + battery at ~2 Hz. */
    float vbat = -1.0f, pyro_vbat = -1.0f;
    if ((now - g_last_tele_ms) >= 500) {
        g_last_tele_ms = now;
        vbat = adc_read_vbat();
        pyro_vbat = adc_read_pyro_vbat();
        telemetry_status(&g_sample, g_flight.state, vbat, pyro_vbat,
                         c1, c2, pyro_is_armed());
        map_indication(g_flight.state, vbat);
    }

    /* 8. Heartbeat + indication animation. */
    if ((now - g_last_hb_ms) >= 500) {
        g_last_hb_ms = now;
        indication_heartbeat_toggle();
    }
    indication_task(now);

    /* 9. USB-C ground console (menus + live stream). Non-blocking. */
    console_task(now);

    /* 10. Telecom FCD link over USART2 (UART commands + telemetry). Non-blocking. */
    fcd_task(now);

    (void)fresh_baro;
}

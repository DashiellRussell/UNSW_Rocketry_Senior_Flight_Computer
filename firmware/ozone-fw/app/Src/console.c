#include "console.h"
#include "usb_cli.h"
#include "ozone_hal.h"
#include "ozone_config.h"
#include "pyro.h"
#include "indication.h"
#include "adc_sense.h"
#include "logging.h"
#include "fatfs.h"
#include <string.h>
#include <math.h>

/* ── menu state ──────────────────────────────────────────────── */
typedef enum { M_MAIN, M_TEST, M_POST } menu_t;

static console_ctx_t s_ctx;
static menu_t   s_menu       = M_MAIN;
static bool     s_was_conn   = false;
static bool     s_stream     = false;
static uint32_t s_last_stream = 0;
static char     s_line[96];

/* ── small helpers ───────────────────────────────────────────── */
#define P(...)   usb_printf(__VA_ARGS__)
#define LINE     "----------------------------------------------\r\n"

static const char *yesno(bool b)  { return b ? "yes" : "no"; }

/* Pull a few fresh barometric samples (baro is a conversion state machine). */
static void refresh_baro(int rounds)
{
    for (int i = 0; i < rounds; i++) {
        sensors_update(s_ctx.sensors, s_ctx.sample, HAL_GetTick());
        HAL_Delay(12);
    }
}

/* ── banners / menus ─────────────────────────────────────────── */
static void banner(void)
{
    P("\r\n");
    P("==============================================\r\n");
    P("   PROJECT OZONE - Senior Flight Computer\r\n");
    P("   UNSW Rocketry  |  USB-C ground console\r\n");
    P("==============================================\r\n");
}

static void main_menu(void)
{
    P("\r\n MAIN MENU   (state: %s)\r\n", flight_state_name(s_ctx.flight->state));
    P(LINE);
    P("  1) Preflight checks\r\n");
    P("  2) Test menu (hardware self-tests)\r\n");
    P("  3) Post-flight / recovery\r\n");
    P("  4) Live status stream: %s\r\n", s_stream ? "ON" : "off");
    P("  5) ARM pyro system\r\n");
    P("  6) DISARM\r\n");
    P("  s) Status snapshot      h) This menu\r\n");
    P("ozone> ");
}

static void test_menu(void)
{
    P("\r\n TEST MENU\r\n");
    P(LINE);
    P("  1) Sensors  - all, live snapshot\r\n");
    P("  2) Barometers (x2)\r\n");
    P("  3) Accelerometers (hi-g + lo-g)\r\n");
    P("  4) SD card\r\n");
    P("  5) Pyro continuity\r\n");
    P("  6) Power / battery\r\n");
    P("  7) LEDs (RGB + status)\r\n");
    P("  8) Buzzer\r\n");
    P("  9) GROUND-TEST FIRE - Channel 1 (drogue)\r\n");
    P("  0) GROUND-TEST FIRE - Channel 2 (main)\r\n");
    P("  b) Back\r\n");
    P("test> ");
}

static void post_menu(void)
{
    P("\r\n POST-FLIGHT / RECOVERY\r\n");
    P(LINE);
    P("  1) Last flight summary\r\n");
    P("  2) Recovery beacon (buzzer) toggle\r\n");
    P("  3) List SD log files\r\n");
    P("  4) Disarm + make safe\r\n");
    P("  b) Back\r\n");
    P("post> ");
}

/* ── status line ─────────────────────────────────────────────── */
static void status_line(void)
{
    sensor_sample_t *s = s_ctx.sample;
    P("[%s] alt=%.1fm agl=%.1fm vel=%.1fm/s P=%.0fPa T=%.1fC | "
      "hi_g=%.1f lo_g=%.2f | vbat=%.2fV pyro=%.2fV armed=%s cont=%d/%d\r\n",
      flight_state_name(s_ctx.flight->state),
      s->altitude_m, s->altitude_agl_m, s_ctx.flight->vel_mps,
      s->pressure_pa, s->temperature_c, s->hi_g_mag, s->lo_g_mag,
      s_ctx.read_vbat(), s_ctx.read_pyro_vbat(), yesno(pyro_is_armed()),
      pyro_continuity(PYRO_CH1), pyro_continuity(PYRO_CH2));
}

/* ── preflight ───────────────────────────────────────────────── */
static void run_preflight(void)
{
    int fails = 0, warns = 0;
    banner();
    P(" PREFLIGHT CHECKS\r\n");
    P(LINE);

    /* 1. Power */
    float vbat = s_ctx.read_vbat();
    float pyro_v = s_ctx.read_pyro_vbat();
    bool pg = (HAL_GPIO_ReadPin(OZ_PG_BUCK_PORT, OZ_PG_BUCK_PIN) == GPIO_PIN_SET);
    if (!pg) { P("[FAIL] [1/5] Power     - buck-boost PG low (out of reg)\r\n"); fails++; }
    else if (vbat > 0 && vbat < OZONE_VBAT_LOW_1S)
        { P("[WARN] [1/5] Power     - vbat low %.2fV\r\n", vbat); warns++; }
    else  P("[ OK ] [1/5] Power     - vbat %.2fV  PG ok\r\n", vbat);

    /* 2. Barometers */
    refresh_baro(8);
    bool b1 = s_ctx.sensors->baro1.healthy, b2 = s_ctx.sensors->baro2.healthy;
    if (!b1 || !b2) { P("[%s] [2/5] Baro      - baro1=%s baro2=%s\r\n",
                        (!b1 && !b2) ? "FAIL" : "WARN", yesno(b1), yesno(b2));
                      (!b1 && !b2) ? fails++ : warns++; }
    else P("[ OK ] [2/5] Baro      - both ok, %.0f Pa, %.1f C, alt %.1f m\r\n",
           s_ctx.sample->pressure_pa, s_ctx.sample->temperature_c,
           s_ctx.sample->altitude_m);

    /* 3. Accelerometers */
    uint8_t hw_hi = h3lis_whoami(), hw_lo = lis3dh_whoami();
    bool a_ok = (hw_hi == H3LIS_WHOAMI) && (hw_lo == LIS3DH_WHOAMI);
    if (!a_ok) { P("[FAIL] [3/5] Accel     - h3lis=0x%02X(exp32) lis3dh=0x%02X(exp33)\r\n",
                   hw_hi, hw_lo); fails++; }
    else {
        h3lis_read(&s_ctx.sensors->hi_g); lis3dh_read(&s_ctx.sensors->lo_g);
        P("[ OK ] [3/5] Accel     - hi-g %.2fg  lo-g %.2fg (rest ~1g)\r\n",
          sqrtf(s_ctx.sensors->hi_g.g_x*s_ctx.sensors->hi_g.g_x +
                s_ctx.sensors->hi_g.g_y*s_ctx.sensors->hi_g.g_y +
                s_ctx.sensors->hi_g.g_z*s_ctx.sensors->hi_g.g_z),
          sqrtf(s_ctx.sensors->lo_g.g_x*s_ctx.sensors->lo_g.g_x +
                s_ctx.sensors->lo_g.g_y*s_ctx.sensors->lo_g.g_y +
                s_ctx.sensors->lo_g.g_z*s_ctx.sensors->lo_g.g_z));
    }

    /* 4. SD card */
    if (!logging_card_present()) { P("[FAIL] [4/5] SD card   - no card detected\r\n"); fails++; }
    else {
        FATFS *fs; DWORD fre;
        if (f_getfree(SDPath, &fre, &fs) == FR_OK) {
            uint32_t free_mb = (uint32_t)(((uint64_t)fre * fs->csize) / 2048u);
            P("[ OK ] [4/5] SD card   - present, %lu MB free\r\n", (unsigned long)free_mb);
        } else { P("[WARN] [4/5] SD card   - present but not mounted\r\n"); warns++; }
    }

    /* 5. Pyro */
    bool c1 = pyro_continuity(PYRO_CH1), c2 = pyro_continuity(PYRO_CH2);
    P("[%s] [5/5] Pyro      - armed=%s cont ch1=%s ch2=%s pyro_v=%.2fV\r\n",
      "INFO", yesno(pyro_is_armed()), yesno(c1), yesno(c2), pyro_v);

    P(LINE);
    if (fails)      P(" RESULT: FAIL  (%d error(s), %d warning(s)) - DO NOT FLY\r\n", fails, warns);
    else if (warns) P(" RESULT: PASS WITH WARNINGS (%d)\r\n", warns);
    else            P(" RESULT: ALL CHECKS PASSED\r\n");
}

/* ── individual tests ────────────────────────────────────────── */
static void test_sensors(void)
{
    P("Reading all sensors...\r\n");
    refresh_baro(6);
    h3lis_read(&s_ctx.sensors->hi_g);
    lis3dh_read(&s_ctx.sensors->lo_g);
    status_line();
}

static void test_baro(void)
{
    P("Barometers (5 samples)...\r\n");
    for (int i = 0; i < 5; i++) {
        refresh_baro(3);
        P("  #%d  baro1 %.0fPa %.1fC | baro2 %.0fPa %.1fC | avg alt %.2fm\r\n", i + 1,
          s_ctx.sensors->baro1.pressure_pa, s_ctx.sensors->baro1.temperature_c,
          s_ctx.sensors->baro2.pressure_pa, s_ctx.sensors->baro2.temperature_c,
          s_ctx.sample->altitude_m);
    }
}

static void test_accel(void)
{
    P("Accelerometers (hold still; rest = ~1g on one axis)...\r\n");
    for (int i = 0; i < 5; i++) {
        h3lis_read(&s_ctx.sensors->hi_g);
        lis3dh_read(&s_ctx.sensors->lo_g);
        P("  hi-g [% .1f % .1f % .1f]  lo-g [% .2f % .2f % .2f]\r\n",
          s_ctx.sensors->hi_g.g_x, s_ctx.sensors->hi_g.g_y, s_ctx.sensors->hi_g.g_z,
          s_ctx.sensors->lo_g.g_x, s_ctx.sensors->lo_g.g_y, s_ctx.sensors->lo_g.g_z);
        HAL_Delay(150);
    }
}

static void test_sd(void)
{
    if (!logging_card_present()) { P("[FAIL] no card detected (PC3)\r\n"); return; }
    FATFS *fs; DWORD fre;
    if (f_getfree(SDPath, &fre, &fs) == FR_OK) {
        uint32_t total_mb = (uint32_t)(((uint64_t)(fs->n_fatent - 2) * fs->csize) / 2048u);
        uint32_t free_mb  = (uint32_t)(((uint64_t)fre * fs->csize) / 2048u);
        P("[ OK ] card present - %lu MB free of %lu MB\r\n",
          (unsigned long)free_mb, (unsigned long)total_mb);
    } else {
        P("[WARN] card present but f_getfree failed (not mounted?)\r\n");
    }
}

static void test_pyro(void)
{
    P("Pyro continuity / arm status:\r\n");
    P("  armed     : %s\r\n", yesno(pyro_is_armed()));
    P("  ch1 cont  : %s\r\n", yesno(pyro_continuity(PYRO_CH1)));
    P("  ch2 cont  : %s\r\n", yesno(pyro_continuity(PYRO_CH2)));
    P("  pyro vbat : %.2f V\r\n", s_ctx.read_pyro_vbat());
    P("  (continuity is digital go/no-go on this board - see ERRATA)\r\n");
}

static void test_power(void)
{
    bool pg = (HAL_GPIO_ReadPin(OZ_PG_BUCK_PORT, OZ_PG_BUCK_PIN) == GPIO_PIN_SET);
    P("Power rails:\r\n");
    P("  main vbat  : %.2f V\r\n", s_ctx.read_vbat());
    P("  pyro vbat  : %.2f V\r\n", s_ctx.read_pyro_vbat());
    P("  buck PG    : %s\r\n", pg ? "ok (regulating)" : "LOW (out of reg!)");
}

static void test_leds(void)
{
    P("Cycling RGB (R,G,B), then heartbeat + error...\r\n");
    indication_set(IND_FAULT);     indication_task(HAL_GetTick()); HAL_Delay(400);
    indication_set(IND_IDLE);      indication_task(HAL_GetTick()); HAL_Delay(400);
    indication_set(IND_ARMED);     indication_task(HAL_GetTick()); HAL_Delay(400);
    indication_error(true);  HAL_Delay(300); indication_error(false);
    indication_heartbeat_toggle(); HAL_Delay(200); indication_heartbeat_toggle();
    P("[ OK ] LED cycle done\r\n");
}

static void test_buzzer(void)
{
    P("Buzzer: 3 beeps...\r\n");
    for (int i = 0; i < 3; i++) {
        buzzer_tone(4000); HAL_Delay(150);
        buzzer_off();      HAL_Delay(150);
    }
    P("[ OK ] buzzer done\r\n");
}

static void do_ground_test(int ch)
{
    if (!pyro_is_armed()) {
        P("[BLOCKED] system not armed - select MAIN menu > 5 (ARM) and close the\r\n"
          "          external key switch first. Aborting.\r\n");
        return;
    }
    P("\r\n*** GROUND-TEST FIRE Channel %d in %d s ***\r\n",
      ch + 1, OZONE_GROUND_TEST_DELAY_MS / 1000);
    P("    Ensure the area is clear. Disconnect now to abort (power off).\r\n");
    s_ctx.ground_test(ch);     /* ozone_app enforces the 10 s delay + fire */
}

/* ── post-flight ─────────────────────────────────────────────── */
static void post_summary(void)
{
    flight_ctx_t *f = s_ctx.flight;
    P("Last/current flight:\r\n");
    P("  state        : %s\r\n", flight_state_name(f->state));
    P("  max altitude : %.1f m AGL\r\n", f->max_alt_agl);
    P("  drogue fired : %s\r\n", yesno(f->drogue_fired));
    P("  main fired   : %s\r\n", yesno(f->main_fired));
}

static void post_list_logs(void)
{
    DIR dir; FILINFO fno;
    if (f_opendir(&dir, SDPath) != FR_OK) { P("[FAIL] cannot open SD root\r\n"); return; }
    P("Log files:\r\n");
    int n = 0;
    while (f_readdir(&dir, &fno) == FR_OK && fno.fname[0]) {
        if (!(fno.fattrib & AM_DIR)) {
            P("  %-14s  %lu bytes\r\n", fno.fname, (unsigned long)fno.fsize);
            n++;
        }
    }
    f_closedir(&dir);
    if (!n) P("  (none)\r\n");
}

/* ── dispatchers ─────────────────────────────────────────────── */
static char first(const char *s) { while (*s == ' ') s++; return *s; }

static void dispatch_main(const char *line)
{
    switch (first(line)) {
        case '1': run_preflight(); break;
        case '2': s_menu = M_TEST; test_menu(); return;
        case '3': s_menu = M_POST; post_menu(); return;
        case '4': s_stream = !s_stream; P("Live stream %s\r\n", s_stream ? "ON" : "off"); break;
        case '5': P("Arming... (external key switch must also be closed)\r\n"); s_ctx.arm(); break;
        case '6': s_ctx.disarm(); P("Disarmed.\r\n"); break;
        case 's': test_sensors(); break;
        case 'z': P("Zeroing pad altitude (~2 s)...\r\n"); s_ctx.zero_ground();
                  P("Ground reference set.\r\n"); break;
        case 'h': case '?': break;
        case '\0': break;
        default:  P("? unknown - press h for menu\r\n"); break;
    }
    main_menu();
}

static void dispatch_test(const char *line)
{
    switch (first(line)) {
        case '1': test_sensors(); break;
        case '2': test_baro();    break;
        case '3': test_accel();   break;
        case '4': test_sd();      break;
        case '5': test_pyro();    break;
        case '6': test_power();   break;
        case '7': test_leds();    break;
        case '8': test_buzzer();  break;
        case '9': do_ground_test(0); break;
        case '0': do_ground_test(1); break;
        case 'b': s_menu = M_MAIN; main_menu(); return;
        case '\0': break;
        default:  P("? unknown - b to go back\r\n"); break;
    }
    test_menu();
}

static void dispatch_post(const char *line)
{
    switch (first(line)) {
        case '1': post_summary(); break;
        case '2': {
            static bool beacon = false; beacon = !beacon;
            buzzer_recovery_pattern(beacon);
            P("Recovery beacon %s\r\n", beacon ? "ON" : "off");
        } break;
        case '3': post_list_logs(); break;
        case '4': s_ctx.disarm(); P("Disarmed + safe.\r\n"); break;
        case 'b': s_menu = M_MAIN; main_menu(); return;
        case '\0': break;
        default:  P("? unknown - b to go back\r\n"); break;
    }
    post_menu();
}

/* ── public API ──────────────────────────────────────────────── */
void console_init(const console_ctx_t *ctx)
{
    s_ctx = *ctx;
    s_menu = M_MAIN;
    s_was_conn = false;
    s_stream = false;
}

void console_task(uint32_t now_ms)
{
    bool conn = usb_connected();

    if (conn && !s_was_conn) {        /* host just connected */
        banner();
        main_menu();
    }
    s_was_conn = conn;
    if (!conn) { s_stream = false; return; }

    if (usb_cli_get_line(s_line, sizeof(s_line))) {
        switch (s_menu) {
            case M_MAIN: dispatch_main(s_line); break;
            case M_TEST: dispatch_test(s_line); break;
            case M_POST: dispatch_post(s_line); break;
        }
    }

    if (s_stream && (now_ms - s_last_stream) >= 500u) {
        s_last_stream = now_ms;
        status_line();
    }
}

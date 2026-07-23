#include "console.h"
#include "usb_cli.h"
#include "ozone_hal.h"
#include "ozone_config.h"
#include "pyro.h"
#include "indication.h"
#include "adc_sense.h"
#include "logging.h"
#include "fatfs.h"
#include "fcd.h"
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
/* LED colours used while paced-scanning each preflight step. */
static void pf_blue(void)  { indication_solid(0, 0, 1000); }   /* reading...  */
static void pf_green(void) { indication_solid(0, 1000, 0); }   /* OK          */
static void pf_red(void)   { indication_solid(1000, 0, 0); }   /* FAIL        */
static void pf_amber(void) { indication_solid(1000, 350, 0); } /* WARN        */
static void pf_cyan(void)  { indication_solid(0, 1000, 1000); }/* INFO        */

/* Begin a step: announce it, turn the LED blue, and pause so it reads as
 * "taking a measurement" rather than instant. */
static void pf_scan(const char *what)
{
    P("   ... reading %s\r\n", what);
    pf_blue();
    HAL_Delay(650);
}
/* Hold the result colour briefly so it's visible before the next step. */
static void pf_hold(void (*colour)(void)) { colour(); HAL_Delay(350); }

static void run_preflight(void)
{
    int fails = 0, warns = 0;
    banner();
    P(" PREFLIGHT CHECKS\r\n");
    P(LINE);

    /* RGB lamp test - confirm each channel lights the right colour. The label
     * printed here should match the colour you actually see on the LED. */
    P("[LAMP] RGB check - watch the LED: RED, then BLUE, then GREEN (1s each)\r\n");
    indication_solid(1000, 0, 0); P("       -> RED\r\n");   HAL_Delay(1000);
    indication_solid(0, 0, 1000); P("       -> BLUE\r\n");  HAL_Delay(1000);
    indication_solid(0, 1000, 0); P("       -> GREEN\r\n"); HAL_Delay(1000);
    indication_solid(0, 0, 0);    HAL_Delay(300);
    P(LINE);

    /* 1. Power */
    pf_scan("power rail (LED: blue)");
    float vbat = s_ctx.read_vbat();
    float pyro_v = s_ctx.read_pyro_vbat();
    bool pg = (HAL_GPIO_ReadPin(OZ_PG_BUCK_PORT, OZ_PG_BUCK_PIN) == GPIO_PIN_SET);
    if (!pg) { P("[FAIL] [1/5] Power     - buck-boost PG low (out of reg)\r\n");
               fails++; pf_hold(pf_red); }
    else if (vbat > 0 && vbat < OZONE_VBAT_LOW_1S)
        { P("[WARN] [1/5] Power     - vbat low %.2fV\r\n", vbat);
          warns++; pf_hold(pf_amber); }
    else { P("[ OK ] [1/5] Power     - vbat %.2fV  PG ok\r\n", vbat);
           pf_hold(pf_green); }

    /* 2. Barometers */
    pf_scan("barometers (LED: blue)");
    refresh_baro(8);
    bool b1 = s_ctx.sensors->baro1.healthy, b2 = s_ctx.sensors->baro2.healthy;
    if (!b1 || !b2) { P("[%s] [2/5] Baro      - baro1=%s baro2=%s\r\n",
                        (!b1 && !b2) ? "FAIL" : "WARN", yesno(b1), yesno(b2));
                      if (!b1 && !b2) { fails++; pf_hold(pf_red); }
                      else            { warns++; pf_hold(pf_amber); } }
    else { P("[ OK ] [2/5] Baro      - both ok, %.0f Pa, %.1f C, alt %.1f m\r\n",
           s_ctx.sample->pressure_pa, s_ctx.sample->temperature_c,
           s_ctx.sample->altitude_m); pf_hold(pf_green); }

    /* 3. Accelerometers */
    pf_scan("accelerometers (LED: blue)");
    uint8_t hw_hi = h3lis_whoami(), hw_lo = lis3dh_whoami();
    bool a_ok = (hw_hi == H3LIS_WHOAMI) && (hw_lo == LIS3DH_WHOAMI);
    if (!a_ok) { P("[FAIL] [3/5] Accel     - h3lis=0x%02X(exp32) lis3dh=0x%02X(exp33)\r\n",
                   hw_hi, hw_lo); fails++; pf_hold(pf_red); }
    else {
        h3lis_read(&s_ctx.sensors->hi_g); lis3dh_read(&s_ctx.sensors->lo_g);
        P("[ OK ] [3/5] Accel     - hi-g %.2fg  lo-g %.2fg (rest ~1g)\r\n",
          sqrtf(s_ctx.sensors->hi_g.g_x*s_ctx.sensors->hi_g.g_x +
                s_ctx.sensors->hi_g.g_y*s_ctx.sensors->hi_g.g_y +
                s_ctx.sensors->hi_g.g_z*s_ctx.sensors->hi_g.g_z),
          sqrtf(s_ctx.sensors->lo_g.g_x*s_ctx.sensors->lo_g.g_x +
                s_ctx.sensors->lo_g.g_y*s_ctx.sensors->lo_g.g_y +
                s_ctx.sensors->lo_g.g_z*s_ctx.sensors->lo_g.g_z));
        pf_hold(pf_green);
    }

    /* 4. SD card - test by actually reading the filesystem, not the PC3 pin */
    pf_scan("SD card (LED: blue)");
    {
        FATFS *fs; DWORD fre;
        if (f_getfree(SDPath, &fre, &fs) == FR_OK) {
            uint32_t free_mb = (uint32_t)(((uint64_t)fre * fs->csize) / 2048u);
            P("[ OK ] [4/5] SD card   - mounted, %lu MB free\r\n", (unsigned long)free_mb);
            pf_hold(pf_green);
        } else {
            P("[FAIL] [4/5] SD card   - not mounted (absent/unreadable; "
              "re-seat + power-cycle)\r\n"); fails++; pf_hold(pf_red);
        }
    }

    /* 5. Pyro */
    pf_scan("pyro continuity (LED: blue)");
    bool c1 = pyro_continuity(PYRO_CH1), c2 = pyro_continuity(PYRO_CH2);
    P("[%s] [5/5] Pyro      - armed=%s cont ch1=%s ch2=%s pyro_v=%.2fV\r\n",
      "INFO", yesno(pyro_is_armed()), yesno(c1), yesno(c2), pyro_v);
    pf_hold(pf_cyan);

    P(LINE);
    /* Settle the LED to the overall verdict colour. */
    if (fails)      pf_red();
    else if (warns) pf_amber();
    else            pf_green();
    /* Track the error LED to the latest preflight verdict (clears a stale latch
     * from a boot-time transient once the operator confirms all checks pass). */
    indication_error(fails > 0);
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

static const char *fr_name(FRESULT fr)
{
    switch (fr) {
        case FR_OK:               return "OK";
        case FR_DISK_ERR:         return "DISK_ERR (data-phase R/W fail -> data lines/pull-ups/signal)";
        case FR_INT_ERR:          return "INT_ERR";
        case FR_NOT_READY:        return "NOT_READY (card init/CMD0-ACMD41 fail -> CMD/CLK/power/seating)";
        case FR_NO_FILE:          return "NO_FILE";
        case FR_NO_PATH:          return "NO_PATH";
        case FR_INVALID_NAME:     return "INVALID_NAME";
        case FR_DENIED:           return "DENIED";
        case FR_EXIST:            return "EXIST";
        case FR_INVALID_OBJECT:   return "INVALID_OBJECT";
        case FR_WRITE_PROTECTED:  return "WRITE_PROTECTED";
        case FR_INVALID_DRIVE:    return "INVALID_DRIVE";
        case FR_NOT_ENABLED:      return "NOT_ENABLED (no work area)";
        case FR_NO_FILESYSTEM:    return "NO_FILESYSTEM (card read OK but no valid FAT -> BPB read garbled or wrong fmt)";
        case FR_MKFS_ABORTED:     return "MKFS_ABORTED";
        case FR_TIMEOUT:          return "TIMEOUT";
        case FR_LOCKED:           return "LOCKED";
        case FR_NOT_ENOUGH_CORE:  return "NOT_ENOUGH_CORE";
        case FR_TOO_MANY_OPEN_FILES: return "TOO_MANY_OPEN_FILES";
        default:                  return "?";
    }
}

static void test_sd(void)
{
    extern SD_HandleTypeDef hsd1;   /* defined in main.c */

    P("PC3 card-detect reads: %s (advisory only)\r\n",
      logging_card_present() ? "inserted" : "not inserted");

    /* Diagnostic: force a fresh mount and report the EXACT failure point so we
     * can tell a card-init failure (CMD/CLK/power/seating) from a data-line
     * failure (missing SDMMC pull-ups, ERR-004) from a format problem. */
    f_mount(0, SDPath, 0);                        /* drop any stale volume */
    FRESULT fr = f_mount(&SDFatFS, SDPath, 1);    /* opt 1 = mount now, touches card */
    P("f_mount -> %d  %s\r\n", (int)fr, fr_name(fr));
    P("HAL_SD: State=0x%02lX  ErrorCode=0x%08lX  CardType=%lu  CardVer=%lu  BlkNbr=%lu\r\n",
      (unsigned long)hsd1.State, (unsigned long)hsd1.ErrorCode,
      (unsigned long)hsd1.SdCard.CardType, (unsigned long)hsd1.SdCard.CardVersion,
      (unsigned long)hsd1.SdCard.BlockNbr);

    FATFS *fs; DWORD fre;
    if (fr == FR_OK && f_getfree(SDPath, &fre, &fs) == FR_OK) {
        uint32_t total_mb = (uint32_t)(((uint64_t)(fs->n_fatent - 2) * fs->csize) / 2048u);
        uint32_t free_mb  = (uint32_t)(((uint64_t)fre * fs->csize) / 2048u);
        P("[ OK ] card mounted - %lu MB free of %lu MB\r\n",
          (unsigned long)free_mb, (unsigned long)total_mb);
    } else {
        P("[FAIL] card not mounted (absent/unreadable - re-seat + power-cycle)\r\n");
    }
}

static void test_pyro(void)
{
    P("Pyro continuity / arm status:\r\n");
    P("  armed     : %s\r\n", yesno(pyro_is_armed()));
    P("  ch1 cont  : %s  (node %u mV)\r\n",
      yesno(pyro_continuity(PYRO_CH1)), pyro_cont_node_mv(PYRO_CH1));
    P("  ch2 cont  : %s  (node %u mV)\r\n",
      yesno(pyro_continuity(PYRO_CH2)), pyro_cont_node_mv(PYRO_CH2));
    P("  pyro vbat : %.2f V\r\n", s_ctx.read_pyro_vbat());
    P("  (continuity = analog divider on PA0/PA1, read via ADC - ERR-007;\r\n"
      "   node ~ PYRO_BATT when bridged AND the rail is energised/armed)\r\n");
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
    /* Diagnostic: we don't yet know if the fitted buzzer is ACTIVE (built-in
     * oscillator - wants steady DC) or PASSIVE (wants an AC tone). Drive both
     * ways and tell me which one you actually hear.
     * Test A = steady DC on PB9 (active buzzer should sound a fixed pitch).
     * Test B = swept square-wave tones via TIM6 (passive buzzer should sing). */
    P("Buzzer diagnostic - listen and note which makes sound:\r\n");

    P("  A) steady DC on (active buzzer test) - 800 ms ...\r\n");
    buzzer_off();   /* make sure TIM6 isn't toggling the pin */
    HAL_GPIO_WritePin(OZ_BUZZER_PORT, OZ_BUZZER_PIN, GPIO_PIN_SET);
    HAL_Delay(800);
    HAL_GPIO_WritePin(OZ_BUZZER_PORT, OZ_BUZZER_PIN, GPIO_PIN_RESET);
    HAL_Delay(400);

    P("  B) LOUDEST-FREQ FINDER 1.0->6.0 kHz - note which step is LOUDEST,\r\n");
    P("     then set OZONE_BUZZER_RESONANCE_HZ to that value. (No discharge R on\r\n");
    P("     this board (ERR-006), so the real loudest may not be the 4kHz rated):\r\n");
    for (uint32_t f = 1000; f <= 6000; f += 250) {
        P("       %lu Hz%s\r\n", (unsigned long)f,
          (f == OZONE_BUZZER_RESONANCE_HZ) ? "  <- current setting" : "");
        buzzer_tone(f); HAL_Delay(450); buzzer_off(); HAL_Delay(150);
    }

    /* Test C bypasses TIM6 entirely - a blocking, hand-timed ~4 kHz square wave
     * straight on the GPIO. This is the decisive isolator:
     *   C sounds but B doesn't -> TIM6 ISR isn't firing (firmware/NVIC issue)
     *   neither A/B/C sounds    -> hardware (Q5/BZ1 solder joint, wrong rail)
     *   it works                -> we're done. */
    P("  C) bit-bang ~4 kHz directly on PB9, no TIM6 - 700 ms ...\r\n");
    buzzer_off();
    for (uint32_t i = 0; i < 2800; i++) {                 /* ~2800 half-cycles */
        HAL_GPIO_TogglePin(OZ_BUZZER_PORT, OZ_BUZZER_PIN);
        for (volatile uint32_t d = 0; d < 1400; d++) { __NOP(); }  /* ~125 us */
    }
    HAL_GPIO_WritePin(OZ_BUZZER_PORT, OZ_BUZZER_PIN, GPIO_PIN_RESET);

    P("[ OK ] buzzer diagnostic done - reply which made sound: A, B, C, or none\r\n");
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
        /* FCD protocol over USB CDC (ground-station testing without a UART
         * adapter): route whoami/get/set/do lines to the FCD engine; the
         * single-key menu never uses these words, so there's no clash. */
        if (!strncmp(s_line, "whoami", 6) || !strncmp(s_line, "get", 3) ||
            !strncmp(s_line, "set ", 4)   || !strncmp(s_line, "do ", 3)) {
            fcd_handle_line(s_line, usb_write);
            return;
        }
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

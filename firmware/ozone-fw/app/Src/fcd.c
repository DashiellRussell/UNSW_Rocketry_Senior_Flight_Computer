#include "fcd.h"
#include "pyro_trigger.h"
#include "link_uart.h"
#include "usb_cli.h"              /* also stream FCD over USB CDC (Web Serial) */
#include "ozone_config.h"
#include "main.h"                 /* HAL_GetTick */
#include <string.h>
#include <stdlib.h>
#include <stdio.h>

/* ── the self-describing descriptor (one line; see docs/fcd-protocol.md) ───── */
static const char *DESC =
 "FCD1 {\"p\":\"fcd/1\",\"name\":\"PROJECT OZONE\",\"sub\":\"UNSW Rocketry Senior FC\","
 "\"fw\":\"0.2.0\",\"accent\":\"cyan\","
 "\"checks\":[{\"id\":\"power\",\"label\":\"Power\"},{\"id\":\"baro\",\"label\":\"Barometers\"},"
 "{\"id\":\"accel\",\"label\":\"Accelerometers\"},{\"id\":\"sd\",\"label\":\"SD card\"},"
 "{\"id\":\"pyro\",\"label\":\"Pyro\"}],"
 "\"rails\":[{\"id\":\"vbat\",\"label\":\"Main batt\",\"min\":6.4,\"max\":8.4,\"nom\":7.4},"
 "{\"id\":\"pyro_v\",\"label\":\"Pyro batt\",\"min\":6.0,\"max\":8.4,\"nom\":7.4}],"
 "\"graphs\":[{\"id\":\"agl_m\",\"label\":\"Altitude AGL\",\"unit\":\"m\"},"
 "{\"id\":\"vel_ms\",\"label\":\"Vertical vel\",\"unit\":\"m/s\"},"
 "{\"id\":\"lo_g\",\"label\":\"Accel (low-g)\",\"unit\":\"g\"},"
 "{\"id\":\"hi_g\",\"label\":\"Accel (high-g)\",\"unit\":\"g\"},"
 "{\"id\":\"pressure_pa\",\"label\":\"Pressure\",\"unit\":\"Pa\"},"
 "{\"id\":\"temp_c\",\"label\":\"Temperature\",\"unit\":\"C\"}],"
 /* IMU orientation: which board axis is skyward at rest + the per-axis low-g
  * accel keys, so the ground station can render a 3D orientation view. Right-
  * handed axes; "up" = axis reading +1g when the rocket stands nose-up on the
  * pad. CONFIRM up/sign against the physical LIS3DH mounting on this board. */
 "\"imu\":{\"accel\":[\"lo_gx\",\"lo_gy\",\"lo_gz\"],\"up\":\"+z\",\"units\":\"g\",\"g_rest\":1.0},"
 "\"tlm\":[\"t_ms\",\"state\",\"agl_m\",\"alt_m\",\"vel_ms\",\"pressure_pa\",\"temp_c\","
 "\"hi_g\",\"lo_g\",\"lo_gx\",\"lo_gy\",\"lo_gz\",\"vbat\",\"pyro_v\",\"armed\",\"cont1\",\"cont2\"],"
 "\"states\":[\"IDLE\",\"ARMED\",\"BOOST\",\"COAST\",\"DROGUE\",\"MAIN\",\"LANDED\",\"FAULT\"],"
 "\"params\":[{\"id\":\"fire_mode\",\"label\":\"Pyro fire mode\",\"type\":\"enum\","
 "\"value\":\"session\",\"values\":[\"safe\",\"session\",\"hot\",\"direct\"]},"
 "{\"id\":\"tlm_hz\",\"label\":\"Telemetry rate\",\"type\":\"int\",\"value\":5,\"min\":1,"
 "\"max\":50,\"unit\":\"Hz\"}],"
 "\"actions\":[{\"id\":\"arm\",\"label\":\"Arm\",\"confirm\":\"ARM\"},"
 "{\"id\":\"disarm\",\"label\":\"Disarm\"},{\"id\":\"preflight\",\"label\":\"Preflight checks\"},"
 "{\"id\":\"log_start\",\"label\":\"Start SD log\"},{\"id\":\"log_stop\",\"label\":\"Stop SD log\"},"
 "{\"id\":\"zero_baro\",\"label\":\"Zero baro\"},"
 "{\"id\":\"flight_mode\",\"label\":\"Enter flight mode (set pyro key)\",\"confirm\":\"FLIGHT\","
 "\"args\":[{\"id\":\"key\",\"type\":\"int\"}]},"
 "{\"id\":\"prime\",\"label\":\"Prime pyro (safe mode)\",\"args\":[{\"id\":\"ch\",\"type\":\"int\",\"min\":1,\"max\":2}]},"
 "{\"id\":\"deploy_ready\",\"label\":\"Deploy-ready (hot mode)\",\"args\":[{\"id\":\"ch\",\"type\":\"int\",\"min\":1,\"max\":2}]},"
 "{\"id\":\"fire\",\"label\":\"FIRE pyro\",\"danger\":true,\"confirm\":\"FIRE\","
 "\"args\":[{\"id\":\"ch\",\"type\":\"int\",\"min\":1,\"max\":2},{\"id\":\"token\",\"type\":\"int\"}]}],"
 "\"caps\":{\"pyro\":2,\"arm\":true,\"logs\":true,\"telemetry\":true}}\r\n";

static const fcd_ctx_t *C;
static bool     s_stream  = true;
static uint32_t s_tlm_hz  = 5;
static uint32_t s_last_tlm;
static uint32_t s_last_seq;          /* replay guard (0 = none seen)            */

/* ── pyro_trigger environment ──────────────────────────────────────────────── */
static bool env_fire(pyro_channel_t ch) { return C && C->fire ? C->fire(ch) : false; }

/* ── arg parsing ───────────────────────────────────────────────────────────── */
/* find "key=" in args and parse its value (hex). Returns false if absent. */
static bool arg_hex(const char *args, const char *key, uint32_t *out)
{
    const char *p = strstr(args, key);
    if (!p) return false;
    p += strlen(key);
    *out = (uint32_t)strtoul(p, NULL, 16);
    return true;
}
static long arg_dec(const char *args, const char *key, long def)
{
    const char *p = strstr(args, key);
    return p ? strtol(p + strlen(key), NULL, 10) : def;
}

/* Verify+strip a trailing "*HH" XOR checksum (accept if absent). Also parse a
 * "seq=N" replay guard if present. Returns false to reject the command. */
static bool integrity_ok(char *s)
{
    char *star = strrchr(s, '*');
    if (star) {
        uint8_t want = (uint8_t)strtoul(star + 1, NULL, 16);
        uint8_t x = 0;
        for (char *p = s; p < star; p++) x ^= (uint8_t)*p;
        *star = '\0';
        if (x != want) return false;
    }
    const char *sq = strstr(s, "seq=");
    if (sq) {
        uint32_t seq = (uint32_t)strtoul(sq + 4, NULL, 10);
        if (s_last_seq && seq <= s_last_seq) return false;   /* replay/dup */
        s_last_seq = seq;
    }
    return true;
}

/* ── compact preflight (mirrors console; results as LOG + final ACK/ERR) ────── */
static void run_preflight(void (*wr)(const char *))
{
    char b[80];
    int fails = 0;
    float vbat = C->read_vbat ? C->read_vbat() : -1.0f;
    bool baro  = C->sample && C->sample->baro_valid;
    bool accel = C->sample && C->sample->accel_valid;
    bool c1 = pyro_continuity(PYRO_CH1), c2 = pyro_continuity(PYRO_CH2);

    snprintf(b, sizeof b, "LOG I power vbat=%.2f\r\n", vbat); wr(b);
    snprintf(b, sizeof b, "LOG %s baro %s\r\n", baro ? "I" : "E", baro ? "ok" : "FAIL"); wr(b);
    if (!baro) fails++;
    snprintf(b, sizeof b, "LOG %s accel %s\r\n", accel ? "I" : "E", accel ? "ok" : "FAIL"); wr(b);
    if (!accel) fails++;
    snprintf(b, sizeof b, "LOG I pyro cont1=%d cont2=%d armed=%d\r\n",
             c1, c2, pyro_is_armed()); wr(b);

    snprintf(b, sizeof b, fails ? "ERR preflight FAIL %d\r\n" : "ACK preflight PASS\r\n", fails);
    wr(b);
}

/* ── do <id> [k=v] dispatch ────────────────────────────────────────────────── */
static void do_action(char *id, const char *args, void (*wr)(const char *))
{
    char b[80];
    uint32_t now = HAL_GetTick();

    if      (!strcmp(id, "arm"))       { if (C->arm) C->arm();  wr("ACK arm requested\r\n"); }
    else if (!strcmp(id, "disarm"))    { if (C->disarm) C->disarm(); pyro_trigger_safe();
                                         wr("ACK disarm\r\n"); }
    else if (!strcmp(id, "safe"))      { pyro_trigger_safe(); wr("ACK safe\r\n"); }
    else if (!strcmp(id, "zero_baro")) { if (C->zero_ground) C->zero_ground();
                                         wr("ACK zero_baro\r\n"); }
    else if (!strcmp(id, "log_start")) { if (C->log_start) C->log_start(); wr("ACK log_start\r\n"); }
    else if (!strcmp(id, "log_stop"))  { if (C->log_stop) C->log_stop();  wr("ACK log_stop\r\n"); }
    else if (!strcmp(id, "preflight")) { run_preflight(wr); }
    else if (!strcmp(id, "flight_mode")) {
        uint32_t key = 0; bool has = arg_hex(args, "key=", &key);
        if (C->arm) C->arm();                        /* enter flight = arm + set key */
        uint32_t out = 0;
        trig_result_t r = pyro_trigger_arm_session(has ? key : 0, now, &out);
        if (r == TRIG_SESSION_SET)
            { snprintf(b, sizeof b, "ACK flight_mode armed key=%04lX\r\n", (unsigned long)out); wr(b); }
        else { snprintf(b, sizeof b, "ERR flight_mode %s\r\n", pyro_trigger_result_str(r)); wr(b); }
    }
    else if (!strcmp(id, "prime")) {
        int ch = (int)arg_dec(args, "ch=", 0) - 1;
        uint32_t tok = 0;
        trig_result_t r = pyro_trigger_prime((pyro_channel_t)ch, now, &tok);
        if (r == TRIG_PRIMED)
            { snprintf(b, sizeof b, "ACK prime ch%d token=%04lX\r\n", ch + 1, (unsigned long)tok); wr(b); }
        else { snprintf(b, sizeof b, "ERR prime %s\r\n", pyro_trigger_result_str(r)); wr(b); }
    }
    else if (!strcmp(id, "deploy_ready")) {
        int ch = (int)arg_dec(args, "ch=", 0) - 1;
        trig_result_t r = pyro_trigger_deploy_ready((pyro_channel_t)ch, now);
        if (r == TRIG_DEPLOY_READY)
            { snprintf(b, sizeof b, "ACK deploy_ready ch%d\r\n", ch + 1); wr(b); }
        else { snprintf(b, sizeof b, "ERR deploy_ready %s\r\n", pyro_trigger_result_str(r)); wr(b); }
    }
    else if (!strcmp(id, "fire")) {
        int ch = (int)arg_dec(args, "ch=", 0) - 1;
        uint32_t tok = 0; bool has = arg_hex(args, "token=", &tok);
        trig_result_t r = pyro_trigger_fire((pyro_channel_t)ch, has, tok, now);
        if (r == TRIG_FIRED)
            { snprintf(b, sizeof b, "ACK fire ch%d fired\r\n", ch + 1); wr(b); }
        else { snprintf(b, sizeof b, "ERR fire %s\r\n", pyro_trigger_result_str(r)); wr(b); }
    }
    else wr("ERR unknown action\r\n");
}

/* ── set <id> <value> ──────────────────────────────────────────────────────── */
static void set_param(const char *id, const char *val, void (*wr)(const char *))
{
    char b[64];
    if (!strcmp(id, "fire_mode")) {
        fire_mode_t m;
        if      (!strncmp(val, "safe", 4))    m = FIRE_MODE_SAFE;
        else if (!strncmp(val, "session", 7)) m = FIRE_MODE_SESSION;
        else if (!strncmp(val, "hot", 3))     m = FIRE_MODE_HOT;
        else if (!strncmp(val, "direct", 6))  m = FIRE_MODE_DIRECT;
        else { wr("ERR set fire_mode\r\n"); return; }
        pyro_trigger_set_mode(m);
        snprintf(b, sizeof b, "PARAM fire_mode=%s\r\n", pyro_trigger_mode_name(m)); wr(b);
    } else if (!strcmp(id, "tlm_hz")) {
        long hz = strtol(val, NULL, 10);
        if (hz < 1)  hz = 1;
        if (hz > 50) hz = 50;
        s_tlm_hz = (uint32_t)hz;
        snprintf(b, sizeof b, "PARAM tlm_hz=%lu\r\n", (unsigned long)s_tlm_hz); wr(b);
    } else if (!strcmp(id, "stream")) {
        s_stream = strtol(val, NULL, 10) != 0;
        snprintf(b, sizeof b, "PARAM stream=%d\r\n", s_stream ? 1 : 0); wr(b);
    } else {
        wr("ERR set unknown\r\n");
    }
}

/* ── line dispatch ─────────────────────────────────────────────────────────── */
static void dispatch(char *line, void (*wr)(const char *))
{
    if (!integrity_ok(line)) { wr("ERR integrity\r\n"); return; }

    if (!strncmp(line, "whoami", 6)) {
        wr(DESC);
    } else if (!strncmp(line, "get", 3)) {
        char b[64];
        snprintf(b, sizeof b, "PARAM fire_mode=%s\r\n", pyro_trigger_mode_name(pyro_trigger_mode())); wr(b);
        snprintf(b, sizeof b, "PARAM tlm_hz=%lu\r\n", (unsigned long)s_tlm_hz); wr(b);
        snprintf(b, sizeof b, "PARAM stream=%d\r\n", s_stream ? 1 : 0); wr(b);
    } else if (!strncmp(line, "set ", 4)) {
        char id[24] = {0}, val[24] = {0};
        if (sscanf(line + 4, "%23s %23s", id, val) == 2) set_param(id, val, wr);
        else wr("ERR set\r\n");
    } else if (!strncmp(line, "do ", 3)) {
        char id[24] = {0};
        const char *p = line + 3;
        int n = 0;
        while (p[n] && p[n] != ' ' && n < 23) { id[n] = p[n]; n++; }
        id[n] = '\0';
        do_action(id, p + n, wr);      /* remainder = args ("ch=1 token=..") */
    } else {
        wr("ERR unknown\r\n");
    }
}

/* ── telemetry stream ──────────────────────────────────────────────────────── */
static void emit_tlm(void)
{
    const sensor_sample_t *s = C->sample;
    const flight_ctx_t    *f = C->flight;
    bool c1 = pyro_continuity(PYRO_CH1), c2 = pyro_continuity(PYRO_CH2);
    uint32_t d1 = pyro_trigger_live_token(PYRO_CH1), d2 = pyro_trigger_live_token(PYRO_CH2);

    char b[288];
    int n = snprintf(b, sizeof b,
        "TLM t_ms=%lu state=%s agl_m=%.1f alt_m=%.1f vel_ms=%.1f pressure_pa=%.0f "
        "temp_c=%.1f hi_g=%.2f lo_g=%.2f lo_gx=%.3f lo_gy=%.3f lo_gz=%.3f "
        "vbat=%.2f pyro_v=%.2f armed=%d cont1=%d cont2=%d",
        (unsigned long)s->timestamp_ms, flight_state_name(f->state),
        s->altitude_agl_m, s->altitude_m, f->vel_mps, s->pressure_pa, s->temperature_c,
        s->hi_g_mag, s->lo_g_mag, s->lo_g_x, s->lo_g_y, s->lo_g_z,
        C->read_vbat ? C->read_vbat() : -1.0f, C->read_pyro_vbat ? C->read_pyro_vbat() : -1.0f,
        pyro_is_armed() ? 1 : 0, c1 ? 1 : 0, c2 ? 1 : 0);
    /* rolling deploy tokens (HOT mode) so the ground can bind a one-key fire */
    if (d1 && n > 0 && n < (int)sizeof b - 24) n += snprintf(b + n, sizeof b - n, " dtok1=%04lX", (unsigned long)d1);
    if (d2 && n > 0 && n < (int)sizeof b - 24) n += snprintf(b + n, sizeof b - n, " dtok2=%04lX", (unsigned long)d2);
    if (n > 0 && n < (int)sizeof b - 3) { b[n++] = '\r'; b[n++] = '\n'; b[n] = '\0'; }
    link_uart_write(b);
    if (usb_connected()) usb_write(b);   /* also to the USB-C console / Web Serial */
}

/* ── public API ────────────────────────────────────────────────────────────── */
void fcd_init(const fcd_ctx_t *ctx)
{
    C = ctx;
    static pyro_trigger_env_t env;
    env.is_armed   = pyro_is_armed;
    env.continuity = pyro_continuity;
    env.fire       = env_fire;
    env.seed       = HAL_GetTick() ^ 0x9E3779B9u;
    pyro_trigger_init(&env, FIRE_MODE_SESSION);   /* boot default = session */
    s_stream = true; s_tlm_hz = 5; s_last_tlm = 0; s_last_seq = 0;
}

void fcd_task(uint32_t now_ms)
{
    char line[128];
    while (link_uart_get_line(line, sizeof line)) dispatch(line, link_uart_write);

    pyro_trigger_task(now_ms);

    if (s_stream && s_tlm_hz && (now_ms - s_last_tlm) >= (1000u / s_tlm_hz)) {
        s_last_tlm = now_ms;
        emit_tlm();
    }
}

void fcd_handle_line(const char *line, void (*reply)(const char *))
{
    char buf[128];
    strncpy(buf, line, sizeof buf - 1); buf[sizeof buf - 1] = '\0';
    dispatch(buf, reply);
}

void fcd_log(char level, const char *msg)
{
    char b[112];
    snprintf(b, sizeof b, "LOG %c %s\r\n", level, msg);
    link_uart_write(b);
    if (usb_connected()) usb_write(b);   /* also to the USB-C console / Web Serial */
}

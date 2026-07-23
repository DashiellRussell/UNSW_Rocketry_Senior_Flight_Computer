#include "logging.h"
#include "ozone_hal.h"
#include "ozone_config.h"
#include "fatfs.h"          /* CubeMX FATFS: SDFatFS, SDPath, retSD */
#include "bsp_driver_sd.h"  /* BSP_SD_IsDetected / SD_PRESENT */
#include <stdio.h>
#include <string.h>

/*
 * ERR-004 FIX (2026-07-23): the PC3 card-detect switch is unreliable on rev 1.0
 * and reads "not inserted" even with a good card seated. The CubeMX BSP gates
 * card init on it - BSP_SD_Init() bails with MSD_ERROR_SD_NOT_PRESENT *before*
 * ever calling HAL_SD_Init() when BSP_SD_IsDetected() != SD_PRESENT. Since
 * HAL_SD_Init is reached ONLY through that path (MX_SDMMC1_SD_Init does not call
 * it), a false "not present" blocks mounting a perfectly good card (symptom:
 * f_mount -> FR_DISK_ERR, hsd1.State=RESET, CardType=0). BSP_SD_IsDetected() is
 * __weak, so override it to always report present and let the real SD init/mount
 * be the actual presence test. Regen-safe: lives in the app module.
 */
uint8_t BSP_SD_IsDetected(void)
{
    return SD_PRESENT;
}

/*
 * UPGRADE PATH (doc 15.7): replace the f_write-per-row scheme below with a
 * double-buffered DMA writer - one buffer fills from the sensor task while the
 * other is flushed by HAL_SD DMA. Pre-allocating the file (done here via
 * f_expand) already removes FAT updates from the flight-time critical path.
 */

static FIL      s_file;
static bool     s_open = false;
static uint32_t s_rows_since_sync = 0;

static const char *CSV_HEADER =
    "t_ms,alt_m,alt_agl_m,pressure_pa,temp_c,"
    "hi_gx,hi_gy,hi_gz,lo_gx,lo_gy,lo_gz,"
    "state,pyro1_cont,pyro2_cont,pyro1_fired,pyro2_fired,event\r\n";

bool logging_card_present(void)
{
    /* SD_CD (PC3) reads the socket's card-detect switch. Polarity/wiring is
     * socket-specific and proved unreliable on rev 1.0, so this is advisory
     * only - logging_init() no longer gates on it; it tries the mount instead.
     * Kept active-low (low = inserted) for the console's informational display. */
    return HAL_GPIO_ReadPin(SD_CD_GPIO_Port, SD_CD_Pin) == GPIO_PIN_RESET;
}

log_status_t logging_init(void)
{
    /* Don't trust card-detect (PC3) - just try to mount. f_mount with the
     * "mount immediately" flag actually touches the card, so a real absent /
     * unreadable card returns an error here. */
    if (f_mount(&SDFatFS, SDPath, 1) != FR_OK) return LOG_NO_CARD;

    /* Find a free filename OZONE000.CSV .. OZONE999.CSV. */
    char name[16];
    for (uint32_t i = 0; i < 1000; i++) {
        snprintf(name, sizeof(name), OZONE_LOG_FILENAME_FMT, (unsigned)i);
        FILINFO fno;
        if (f_stat(name, &fno) != FR_OK) break;   /* free slot */
    }

    if (f_open(&s_file, name, FA_CREATE_ALWAYS | FA_WRITE) != FR_OK)
        return LOG_OPEN_FAIL;

    /* Pre-allocate to avoid FAT growth during flight (best-effort). */
    f_expand(&s_file, OZONE_LOG_PREALLOC_BYTES, 0);

    UINT bw;
    f_write(&s_file, CSV_HEADER, strlen(CSV_HEADER), &bw);
    f_sync(&s_file);
    s_open = true;
    s_rows_since_sync = 0;
    return LOG_OK;
}

log_status_t logging_write(const sensor_sample_t *s, flight_state_t st,
                           bool pyro1_cont, bool pyro2_cont,
                           bool pyro1_fired, bool pyro2_fired)
{
    if (!s_open) return LOG_OPEN_FAIL;

    char line[200];
    int n = snprintf(line, sizeof(line),
        "%lu,%.2f,%.2f,%.0f,%.2f,"
        "%.2f,%.2f,%.2f,%.3f,%.3f,%.3f,"
        "%s,%d,%d,%d,%d,\r\n",
        (unsigned long)s->timestamp_ms,
        s->altitude_m, s->altitude_agl_m, s->pressure_pa, s->temperature_c,
        s->hi_g_x, s->hi_g_y, s->hi_g_z, s->lo_g_x, s->lo_g_y, s->lo_g_z,
        flight_state_name(st),
        pyro1_cont ? 1 : 0, pyro2_cont ? 1 : 0,
        pyro1_fired ? 1 : 0, pyro2_fired ? 1 : 0);
    if (n < 0) return LOG_WRITE_FAIL;

    UINT bw;
    FRESULT fr = f_write(&s_file, line, (UINT)n, &bw);
    if (fr != FR_OK || bw != (UINT)n) {
        /* Doc 15.7: retry once, else flag error and keep flying. */
        fr = f_write(&s_file, line, (UINT)n, &bw);
        if (fr != FR_OK) return LOG_WRITE_FAIL;
    }

    if (++s_rows_since_sync >= (uint32_t)OZONE_LOG_RATE_HZ) {  /* ~1 Hz sync */
        f_sync(&s_file);
        s_rows_since_sync = 0;
    }
    return LOG_OK;
}

void logging_event(uint32_t now_ms, const char *event)
{
    if (!s_open) return;
    char line[96];
    int n = snprintf(line, sizeof(line),
        "%lu,,,,,,,,,,,,,,,,%s\r\n", (unsigned long)now_ms, event);
    if (n < 0) return;
    UINT bw;
    f_write(&s_file, line, (UINT)n, &bw);
    f_sync(&s_file);
}

void logging_close(void)
{
    if (!s_open) return;
    f_sync(&s_file);
    f_close(&s_file);
    s_open = false;
}

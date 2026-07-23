/**
 * logging.h - CSV flight logging to MicroSD via FatFs over SDMMC (4-bit).
 *
 * First-cut strategy: format a CSV line into a RAM ring buffer, flush to the
 * card in chunks, f_sync periodically. The doc (9.2 / 15.7) recommends a
 * double-buffered DMA upgrade for high rates - see notes in logging.c. This
 * implementation is robust for the >=1 Hz baseline and bench bring-up.
 *
 * Requires FatFs middleware enabled in CubeMX (SDMMC1, FATFS -> SD Card).
 */
#ifndef LOGGING_H
#define LOGGING_H

#include "sensors.h"
#include "flight.h"
#include <stdbool.h>

typedef enum {
    LOG_OK = 0,
    LOG_NO_CARD,
    LOG_MOUNT_FAIL,
    LOG_OPEN_FAIL,
    LOG_WRITE_FAIL,
} log_status_t;

/* Mount card, open a new sequential file, pre-allocate, write CSV header. */
log_status_t logging_init(void);

/* Append one sample row. Pyro status fields are caller-supplied. */
log_status_t logging_write(const sensor_sample_t *s, flight_state_t st,
                           bool pyro1_cont, bool pyro2_cont,
                           bool pyro1_fired, bool pyro2_fired);

/* Log a discrete flight event (state transition / fault). */
void logging_event(uint32_t now_ms, const char *event);

/* Flush + close. Call on landing detect. */
void logging_close(void);

bool logging_card_present(void);

/* True once a log file is open (i.e. the card mounted and logging is live). */
bool logging_active(void);

#endif /* LOGGING_H */

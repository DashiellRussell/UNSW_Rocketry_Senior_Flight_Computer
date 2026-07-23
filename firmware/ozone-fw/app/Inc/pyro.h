/**
 * pyro.h - Two-channel pyrotechnic deployment (drogue + main).
 *
 * Safety model (doc 7): opto-isolated low-side N-FET per channel, whole rail
 * gated by an arm P-FET, which itself only has power when the EXTERNAL key
 * switch is closed. Gates init LOW. Continuity is a GPIO present/absent read
 * (PC6/PC7 are not ADC-capable on the L452 - see firmware notes).
 */
#ifndef PYRO_H
#define PYRO_H

#include "ozone_hal.h"
#include <stdbool.h>

typedef enum { PYRO_CH1 = 0, PYRO_CH2 = 1 } pyro_channel_t;

/* Set arm pin low, both gates low. Call early at boot. */
void pyro_init(void);

/* Drive the arm opto (energises PYRO_BATT via the P-FET). */
void pyro_arm(void);
void pyro_disarm(void);
bool pyro_is_armed(void);

/* Fire a channel for OZONE_PYRO_FIRE_MS. Blocks for the pulse, then drops the
 * gate. Returns false if not armed (refuses to fire). NOT gated by flight
 * logic here - the state machine enforces lockouts before calling this. */
bool pyro_fire(pyro_channel_t ch);

/* Continuity present on a channel (e-match/short bridges the live pyro rail). */
bool pyro_continuity(pyro_channel_t ch);

/* Raw sensed divider-node voltage in millivolts (diagnostic: ~PYRO_BATT when
 * bridged and the rail is energised, ~0 when open or the rail is de-energised). */
uint16_t pyro_cont_node_mv(pyro_channel_t ch);

/* Drive the per-channel yellow continuity LED. */
void pyro_set_cont_led(pyro_channel_t ch, bool on);

#endif /* PYRO_H */

/**
 * ozone_app.h - Top-level OZONE application.
 *
 * Wire into CubeMX main.c:
 *   #include "ozone_app.h"        // in USER CODE Includes
 *   ozone_app_init();             // in USER CODE 2, after all MX_*_Init()
 *   while (1) { ozone_app_run();  // in USER CODE WHILE (the super-loop) }
 */
#ifndef OZONE_APP_H
#define OZONE_APP_H

void ozone_app_init(void);   /* bring up all subsystems, run preflight */
void ozone_app_run(void);    /* one super-loop iteration (non-blocking) */

/* Called from the BT command parser to request arm / ground-test fire. */
void ozone_app_request_arm(void);
void ozone_app_request_ground_test(int channel);  /* 0=ch1, 1=ch2 */

#endif /* OZONE_APP_H */

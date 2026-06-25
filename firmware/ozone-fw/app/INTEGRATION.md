# OZONE firmware `app/` — integration into the CubeMX project

This `app/` folder is **toolchain-agnostic C** that sits *outside* CubeMX's
managed files, so regenerating the `.ioc` never overwrites it.

## 1. Drop it in
After CubeMX generates the project (see `SETUP.md`), copy this `app/` folder to
the project root, next to `Core/`, `Drivers/`, `USB_Device/`.

## 2. Tell the toolchain about it
**STM32CubeIDE:** right-click project → Properties → C/C++ Build → Settings →
MCU GCC Compiler → Include paths → add `../app/Inc`. Then right-click the `app`
folder → Add/Remove include path (or just make sure `app/Src` is in the source
folders — CubeIDE compiles any `.c` under the project by default).

**CMake (if you switch later):** add `app/Inc` to includes and `app/Src/*.c` to
sources.

## 3. Enable required middleware in CubeMX
- **FATFS** → mode **SD Card** (this pulls in `fatfs.h`, `SDFatFS`, `SDPath`,
  and the `MX_FATFS_Init()` call). Required by `logging.c`.
- **USB_DEVICE** → Communication Device Class (VCP) if you want USB serial.

## 4. Wire into `Core/Src/main.c` (USER CODE guards only)
```c
/* USER CODE BEGIN Includes */
#include "ozone_app.h"
/* USER CODE END Includes */

/* USER CODE BEGIN 2  -- after every MX_*_Init() and MX_FATFS_Init() */
ozone_app_init();
/* USER CODE END 2 */

/* USER CODE BEGIN WHILE */
while (1)
{
    ozone_app_run();
/* USER CODE END WHILE */
/* USER CODE BEGIN 3 */
}
/* USER CODE END 3 */
```

## 5. printf/float notes
- `telemetry.c` and `logging.c` use `vsnprintf`/`snprintf` with `%f`. Enable
  float in newlib-nano: Project → Properties → C/C++ Build → Settings →
  MCU Settings → tick **"Use float with printf from newlib-nano"**.

## 6. Pin labels are the contract
The `OZ_*` macros in `ozone_hal.h` reference CubeMX pin **User Labels**
(`CS_H3LIS`, `PYRO1_GATE`, …). If a label differs from `SETUP.md`, fix it once
in `ozone_hal.h` — nowhere else.

## Design notes / known limitations (verify against schematic before flight)
1. **PC6 / PC7 continuity are GPIO, not ADC.** The STM32L452 has no ADC channel
   on PC6/PC7, so `PYRO1_CONT`/`PYRO2_CONT` are read as digital present/absent
   (`pyro.c`). True analog continuity *voltage* would need rerouting to a spare
   ADC pin (e.g. PA1/PA4). The doc's "continuity ADC readings" wording assumes
   analog — coarse go/no-go is what this silicon supports on those pins.
2. **Divider ratios** in `ozone_config.h` are from the schematic (VBAT 100k/33k,
   pyro 10k/3.3k). **Calibrate against a DMM** on the bench (`15.6`).
3. **Logging** is f_write-per-row with periodic f_sync — solid for the ≥1 Hz
   baseline. For high-rate flight logging, upgrade to the double-buffered DMA
   scheme noted in `logging.c` (doc 15.7).
4. **BT command parser** is not included — `ozone_app_request_arm()` /
   `_request_ground_test()` are the hooks. Add a USART2 RX interrupt/line
   parser that calls them. Until then, arming can be driven by flight logic.
5. **2S low-battery threshold** — `map_indication()` only checks the 1S
   threshold; add pack-cell detection or a config switch for 2S.
6. **Buzzer is software PWM on PB9 via TIM6.** The L452 has no TIM17 and PB9 has
   no timer channel (datasheet AF table), so `indication.c` toggles PB9 from the
   TIM6 update ISR. Requirements in CubeMX: TIM6 **Activated** + **TIM6 global
   interrupt** enabled in NVIC. `indication.c` defines the weak
   `HAL_TIM_PeriodElapsedCallback` — if you add other base-timer interrupts,
   merge their handling into that one callback. The OZONE doc's PB9=TIM17_CH1 is
   wrong.

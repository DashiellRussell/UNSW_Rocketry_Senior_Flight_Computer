# OZONE firmware — STM32CubeMX project setup

Target MCU: **STM32L452RET6** (LQFP64). Generate with **STM32CubeMX** (standalone),
then import into **STM32CubeIDE**. Pinout is taken verbatim from the Project OZONE
technical doc, §16.

---

## A. Create the project (CubeMX home)
1. **File → New Project** (or "ACCESS TO MCU SELECTOR").
2. Search part number `STM32L452RET6` → select the LQFP64 row → **Start Project**.

## B. Pinout & Configuration tab

### System Core
- **RCC**: High Speed Clock (HSE) = **Crystal/Ceramic Resonator** → claims PH0/PH1.
  Low Speed Clock (LSE) = Disable.
  Also tick **Clock Recovery System (CRS SYNC)** = via USB once USB is enabled.
- **SYS**: Debug = **Serial Wire** (PA13/PA14). Timebase = SysTick.

### Connectivity
- **SPI1**: Mode = **Full-Duplex Master**, Hardware NSS = **Disabled** → PA5/PA6/PA7.
  - Parameters: Data Size 8-bit, MSB First, **CPOL = High, CPHA = 2 Edge** (mode 3),
    Baud Rate Prescaler so SCLK **≤ 10 MHz** (e.g. /16 = 5 MHz to start).
- **USART2**: Mode = **Asynchronous** → PA2 (TX) / PA3 (RX). 115200 8N1.
- **SDMMC1**: Mode = **SD 4 bits Wide bus** → PC8/PC9/PC10/PC11 (D0–D3), PC12 (CK), PD2 (CMD).
- **USB**: Mode = **Device (FS)** → PA11 (DM) / PA12 (DP).

### Analog
- **ADC1**: enable **IN13** (PC4) and **IN14** (PC5). Resolution 12-bit,
  Sampling time long (247.5 cyc). Scan/continuous off (driver triggers reads).

### Timers
- **TIM1**: Channel1/2/3 = **PWM Generation CHx** → PA8/PA9/PA10.
  Prescaler **79**, Counter Period (ARR) **999** (1 kHz, 0–1000 duty).
- **TIM6**: **Activated** (basic timer). Prescaler 0, default ARR (driver sets
  it). This is the buzzer software-PWM timebase. In **NVIC Settings** for TIM6,
  tick **"TIM6 global interrupt"**.
  > The L452 has **no TIM17**, and **PB9 has no timer channel at all** (its AFs
  > are IR_OUT/I2C1_SDA/SPI2_NSS/CAN1_TX/SDMMC1_D5/SAI1_FS_A only). So the buzzer
  > is driven as a GPIO toggled from the TIM6 ISR (see `indication.c`). The OZONE
  > doc's "PB9 = TIM17_CH1" is an error.

### Middleware and Software Packs
- **FATFS**: Mode = **SD Card** (sits on SDMMC1). Needed for logging.
- **USB_DEVICE**: Class = **Communication Device Class (Virtual Port Com)**.

### GPIO — set each pin's mode + **User Label** (right-click pin → Enter User Label)
**Outputs, init High** (so no sensor is selected at boot):

| Pin  | Mode            | User Label    |
|------|-----------------|---------------|
| PB0  | GPIO_Output High| `CS_H3LIS`    |
| PB1  | GPIO_Output High| `CS_LIS3DH`   |
| PB2  | GPIO_Output High| `CS_MS5611_1` |
| PB12 | GPIO_Output High| `CS_MS5611_2` |

**Outputs, init Low** (pyro safe + LEDs):

| Pin  | Mode           | User Label        |
|------|----------------|-------------------|
| PB10 | GPIO_Output Low| `PYRO1_GATE`      |
| PB11 | GPIO_Output Low| `PYRO2_GATE`      |
| PB15 | GPIO_Output Low| `PYRO_ARM`        |
| PB13 | GPIO_Output Low| `PYRO1_CONT_LED`  |
| PB14 | GPIO_Output Low| `PYRO2_CONT_LED`  |
| PB6  | GPIO_Output Low| `LED_HEARTBEAT`   |
| PB7  | GPIO_Output Low| `LED_ERROR`       |
| PB9  | GPIO_Output Low| `BUZZER`          |

**Inputs:**

| Pin  | Mode        | User Label      | Note |
|------|-------------|-----------------|------|
| PC0  | GPIO_Input  | `INT1_H3LIS`    | accel interrupt |
| PC1  | GPIO_Input  | `INT1_LIS3DH`   | |
| PC2  | GPIO_Input  | `INT2_LIS3DH`   | |
| PC3  | GPIO_Input  | `SD_CD`         | card detect, active-low |
| PB8  | GPIO_Input  | `PG_BUCKBOOST`  | TPS63060 power-good |
| PC6  | GPIO_Input  | `PYRO1_CONT`    | **not ADC on L452** — digital go/no-go |
| PC7  | GPIO_Input  | `PYRO2_CONT`    | **not ADC on L452** — digital go/no-go |

## C. Clock Configuration tab
- HSE input = **8 MHz**. Target **HCLK = 80 MHz** (type 80, let CubeMX resolve:
  PLL M=1, N=20, R=2). System Clock Mux = PLLCLK. APB1/APB2 prescaler = /1.
- **Clock48 source = HSI48** (feeds both **USB** and **SDMMC1**). Enable HSI48 + CRS.
- Resolve any red conflict by setting the Clock48 mux to HSI48.

## D. Project Manager tab
- **Project**: Toolchain/IDE = **STM32CubeIDE**. Project name `ozone-fw`,
  location = this `firmware/` folder.
- **Code Generator**: tick *Copy only necessary library files* and
  *Generate peripheral init as a pair of .c/.h files per peripheral*.

## E. Generate
- **GENERATE CODE** (top-right). Then in CubeIDE: File → Import → Existing
  Projects into Workspace → select the generated folder.
- Build (hammer). Should be 0 errors before adding `app/`.

## F. Add the app layer
Follow `app/INTEGRATION.md` (include path, `main.c` USER CODE hooks, float-printf).

## G. Flash
ST-Link → SWD header **J4** (pin1 +3V3, 2 SWDIO/PA13, 3 SWCLK/PA14, 4 GND, 5 NRST).
Run → Debug As → STM32 C/C++ Application. Heartbeat LED (PB6) blinks when alive.

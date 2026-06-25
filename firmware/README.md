# OZONE flight computer — firmware

Firmware for the Project OZONE senior flight computer (STM32L452RET6).

## Layout
```
firmware/
├── SETUP.md          CubeMX project setup (do this first)
└── ozone-fw/         CubeMX-generated project (toolchain: STM32CubeIDE)
    ├── ozone-fw.ioc
    ├── Core/ Drivers/ FATFS/ USB_DEVICE/   (CubeMX-managed)
    └── app/          portable application code (survives .ioc regen)
        ├── INTEGRATION.md  how to wire app/ into main.c
        ├── Inc/      headers
        └── Src/      sources
```

## Quick start
1. Generate the CubeMX project per **SETUP.md**.
2. Integrate the **app/** layer per **app/INTEGRATION.md**.
3. Build, flash via SWD (J4), watch the heartbeat LED.

## Modules (`app/`)
| Module        | Responsibility |
|---------------|----------------|
| `spi_bus`     | Shared SPI1 + CS helpers |
| `ms5611`      | Barometer (x2), non-blocking conversion SM + compensation |
| `h3lis331dl`  | High-g accel — launch/landing |
| `lis3dh`      | Low-g accel — apogee voter |
| `sensors`     | Suite bring-up, fusion, ground-zero, altitude |
| `adc_sense`   | Battery + pyro-battery voltage (ADC1) |
| `pyro`        | Arm / fire / continuity, opto + N-FET |
| `indication`  | RGB (TIM1 PWM), heartbeat/error LEDs, buzzer (TIM17) |
| `logging`     | CSV → MicroSD via FatFs/SDMMC |
| `telemetry`   | Status over USART2 (BT module) |
| `flight`      | State machine + 2-of-3 apogee voting (testable, no HW) |
| `ozone_app`   | Top-level init + super-loop |

## Bring-up order (recommended)
1. Power rails (no MCU) — doc §14.1.
2. Flash + heartbeat LED.
3. `sensors_init()` WHO_AM_I: H3LIS=0x32, LIS3DH=0x33, MS5611 PROM CRC ok.
4. SD logging (`logging_init`).
5. Pyro continuity on the bench with a test resistor (doc §14.7) — **no e-match**.
6. Calibrate divider ratios + apogee thresholds.

See the top-level Project OZONE technical doc for the full design rationale.

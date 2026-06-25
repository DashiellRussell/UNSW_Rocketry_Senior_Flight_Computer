# Project OZONE — Hardware Errata & Future-Revision Changes

Issues found in **board rev 1.0** that are worked around in firmware on the
current (already-fabricated) board, and should be **fixed in hardware on the
next revision (rev 1.1 / v2.0)**.

Status legend: 🟢 firmware workaround in place on rev 1.0 · 🔧 fix in next rev.

---

## ERR-001 — Buzzer pin PB9 has no timer (no hardware PWM)
**Severity:** low (cosmetic/recovery aid, not flight-critical)

- **Problem:** §16 / §10.3 of the technical doc assign the buzzer to
  `PB9 / TIM17_CH1`. The **STM32L452 has no TIM17**, and **PB9 has no timer
  channel of any kind** (its alternate functions are only IR_OUT, I2C1_SDA,
  SPI2_NSS, CAN1_TX, SDMMC1_D5, SAI1_FS_A — verified in the STM32L452
  datasheet AF table). So PB9 cannot produce hardware PWM.
- 🟢 **Rev 1.0 workaround:** drive PB9 as GPIO, generate the tone in software
  from the **TIM6** update interrupt (`firmware/app/Src/indication.c`,
  `buzzer_tone()` / `HAL_TIM_PeriodElapsedCallback`). Works fine for a piezo;
  costs a few thousand cheap ISRs/sec.
- 🔧 **Rev 1.1 fix:** route the buzzer FET gate to a pin **with a timer channel**
  so it's true hardware PWM and frees the CPU. Good free candidates:
  - **PA15 → TIM2_CH1** (AF1)
  - **PB4 → TIM3_CH1** (AF2)
  - **PB5 → TIM3_CH2** (AF2)

  Then revert `indication.c` to a one-line `__HAL_TIM_SET_COMPARE` PWM driver.

---

## ERR-002 — Pyro continuity pins PC6/PC7 are not ADC-capable
**Severity:** medium (limits continuity to go/no-go, not analog readback)

- **Problem:** §16 lists `PC6 = PYRO1_CONT` and `PC7 = PYRO2_CONT` as "ADC/GPIO",
  and §7.3 / §13/§14.7 describe reading a **continuity ADC voltage**. But on the
  STM32L452, ADC1 has **no channel on PC6/PC7** (ADC1 reaches PC0–PC5, PA0–PA7,
  PB0/PB1 only). So an analog continuity *voltage* cannot be measured on these
  pins.
- 🟢 **Rev 1.0 workaround:** read PC6/PC7 as **GPIO digital** present/absent
  (`firmware/app/Src/pyro.c`, `pyro_continuity()`), using the divider node
  crossing the logic threshold. Adequate for a go/no-go continuity check before
  arming; not a measured resistance/voltage.
- 🔧 **Rev 1.1 fix:** route the two continuity divider nodes to **ADC-capable
  free pins** for true analog continuity (so the BT telemetry can report an
  actual voltage per §13.1/§14.7):
  - **PA4 → ADC1_IN9**
  - **PA0 → ADC1_IN5**  (or PA1 → ADC1_IN6)

  Then read them with the existing `adc_read_raw()` path in `adc_sense.c`.

---

## ERR-003 — Documentation correction (no silicon impact)
- The technical doc references **TIM17** (§10.3, §16) which does not exist on the
  STM32L452. Update those rows to reflect the buzzer being GPIO/TIM6 on rev 1.0
  (per ERR-001). The board itself is unaffected; this is a doc-only fix.

---

## Carried-forward / already-resolved (for reference)
- **5.1 V Zener** on the reverse-polarity P-FET gate (replacing the original
  8.2 V) — already corrected in rev 1.0 (doc §5.2). No further action.

---

## Suggested rev 1.1 pin reassignment summary
| Function        | rev 1.0 pin | rev 1.1 pin | Why |
|-----------------|-------------|-------------|-----|
| Buzzer          | PB9 (GPIO)  | PA15 / PB4  | gain hardware-PWM timer channel |
| Pyro1 continuity| PC6 (GPIO)  | PA4 (IN9)   | gain ADC for analog continuity  |
| Pyro2 continuity| PC7 (GPIO)  | PA0 (IN5)   | gain ADC for analog continuity  |

Freed by the moves: PB9, PC6, PC7 become spare GPIO. Confirm the chosen pins are
not otherwise allocated before routing, and re-run the CubeMX pinout + update
`firmware/app/Inc/ozone_hal.h` labels to match.

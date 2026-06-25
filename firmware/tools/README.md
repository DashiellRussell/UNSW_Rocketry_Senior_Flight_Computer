# OZONE ground tools

Laptop-side companion to the on-board USB-C console.

## ozone_console.py
A `rich` TUI that drives the firmware's Preflight / Test / Post-flight menus over
the USB-C virtual COM port.

### Run with pnpm (from `firmware/`, matches the MPR workflow)
```bash
pnpm setup        # one time: pip installs rich + pyserial
pnpm preflight    # run preflight checks (table)
pnpm monitor      # live telemetry dashboard
pnpm postflight   # flight summary + SD log list
pnpm console      # full interactive menu
pnpm terminal     # raw passthrough
pnpm ports        # list serial ports
```

### Or run Python directly
```bash
pip install -r requirements.txt          # rich + pyserial
python ozone_console.py                  # auto-detects the OZONE port
python ozone_console.py --mode preflight # jump straight to a view
python ozone_console.py --list           # list serial ports
python ozone_console.py --port /dev/cu.usbmodem1234
```

Menu:
- **1) Preflight** — runs the board's preflight checks, renders a colored
  pass/fail table + overall result.
- **2) Live monitor** — toggles status streaming and shows a live dashboard
  (altitude/AGL, velocity, pressure/temp, accel, battery bar, arm + continuity).
  Ctrl-C stops and turns streaming back off.
- **3) Post-flight** — flight summary (apogee, deploy events) + SD log listing,
  with an optional make-safe (disarm).
- **4) Raw terminal** — straight passthrough to the board console (type the menu
  numbers yourself).

### How it works
The board firmware (`app/Src/console.c`) is the source of truth — it presents
text menus and emits fixed-format status/preflight lines. This tool just sends
the menu keystrokes and parses those lines. You can always talk to the board
with any plain serial terminal (screen/minicom/PuTTY) instead; the TUI is just a
nicer front-end.

> Note: USB CDC ignores baud rate, but set 115200 8N1 in plain terminals anyway.
> macOS port is usually `/dev/cu.usbmodemXXXX`; Linux `/dev/ttyACM0`.

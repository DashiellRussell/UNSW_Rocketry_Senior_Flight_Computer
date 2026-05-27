# UNSW Rocketry Senior Flight Computer

KiCad project for the senior flight computer used by UNSW Rocketry.

## Revisions

This repo holds each hardware revision in its own self-contained folder. Every
folder is a complete KiCad project (schematic, PCB, and its own copy of the
footprint library) so any revision can be opened and fabricated independently.

| Revision | Folder | Status |
| --- | --- | --- |
| **v0.0** | [`v0.0/`](v0.0/) | Frozen — known-good design. Do not edit. |
| **v1.0** | [`v1.0/`](v1.0/) | In progress — next revision (component + design changes). |

The exact v0.0 snapshot is also recoverable from the `v0.0` git tag
(`git checkout v0.0`).

> **Working on a new revision?** Copy the latest frozen folder to the next
> version number (e.g. `cp -R v1.0 v1.1`), then edit the copy. Tag the old one
> before you move on.

## Documents

Reference docs live in [`docs/`](docs/) and render inline on GitHub:

- [Schematic (PDF)](docs/UNSW_Rocketry_Senior_Flight_Computer.pdf) — exported full schematic (v0.0)
- [Project OZONE](docs/Project%20OZONE.pdf)

## Project layout (within each revision folder)

| File | Purpose |
| --- | --- |
| `UNSW_Rocketry_Senior_Flight_Computer.kicad_pro` | KiCad project file |
| `UNSW_Rocketry_Senior_Flight_Computer.kicad_sch` | Top-level schematic |
| `UNSW_Rocketry_Senior_Flight_Computer.kicad_pcb` | PCB layout |
| `Power.kicad_sch` | Power sheet |
| `Pyros.kicad_sch` | Pyrotechnic channels sheet |
| `Comms.kicad_sch` | Communications sheet |
| `Peripherals.kicad_sch` | Peripherals sheet |
| `Indication.kicad_sch` | Status / indication sheet |
| `UNSW_ROCKETRY_LIBRARY.pretty/` | Project-specific footprint library |
| `UNSW_Rocketry_Senior_Flight_Computer.csv` | BOM export |

## Opening the project

1. Install [KiCad 10.0](https://www.kicad.org/download/) or newer.
2. Clone this repo.
3. Open the `.kicad_pro` inside the revision folder you want, e.g.
   `v1.0/UNSW_Rocketry_Senior_Flight_Computer.kicad_pro`.

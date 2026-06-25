#!/usr/bin/env python3
"""
ozone_console.py - Laptop-side TUI for the Project OZONE flight computer.

Talks to the board's USB-C virtual COM port (the firmware `console` module) and
wraps its Preflight / Test / Post-flight menus in a rich terminal UI - modelled
on the MPR altitude logger's post-flight TUI.

Views:
    Preflight TUI   - runs the board's preflight checks, renders a pass/fail table
    Live Monitor    - streams status into a live dashboard (alt / vel / battery)
    Post-flight TUI - flight summary + SD log listing + make-safe

Usage:
    python ozone_console.py                 # auto-detect the OZONE port
    python ozone_console.py --port /dev/cu.usbmodem1234
    python ozone_console.py --list          # list candidate serial ports

Deps:  pip install rich pyserial
"""
from __future__ import annotations
import argparse
import queue
import re
import sys
import threading
import time

try:
    import serial
    from serial.tools import list_ports
except ImportError:
    print("Missing dependency: pyserial   ->  pip install pyserial")
    sys.exit(1)

try:
    from rich.console import Console
    from rich.panel import Panel
    from rich.table import Table
    from rich.live import Live
    from rich.align import Align
    from rich.text import Text
    from rich import box
except ImportError:
    print("Missing dependency: rich   ->  pip install rich")
    sys.exit(1)

console = Console()

# ── serial link ──────────────────────────────────────────────────────────
ST_VID = 0x0483  # STMicroelectronics USB VID


def find_port() -> str | None:
    cands = []
    for p in list_ports.comports():
        name = (p.device or "")
        if (p.vid == ST_VID) or ("usbmodem" in name) or ("ACM" in name) \
           or ("STM" in (p.description or "").upper()):
            cands.append(p.device)
    return cands[0] if cands else None


class Link:
    """Background-reader serial wrapper with line queue + command send."""

    def __init__(self, port: str, baud: int = 115200):
        self.ser = serial.Serial(port, baud, timeout=0.1)
        self.lines: queue.Queue[str] = queue.Queue()
        self._buf = ""
        self._stop = threading.Event()
        self._t = threading.Thread(target=self._reader, daemon=True)
        self._t.start()

    def _reader(self):
        while not self._stop.is_set():
            try:
                data = self.ser.read(256)
            except Exception:
                break
            if not data:
                continue
            self._buf += data.decode("utf-8", "replace")
            while "\n" in self._buf:
                line, self._buf = self._buf.split("\n", 1)
                self.lines.put(line.rstrip("\r"))

    def send(self, s: str):
        self.ser.write((s + "\n").encode())
        self.ser.flush()

    def drain(self):
        while not self.lines.empty():
            try:
                self.lines.get_nowait()
            except queue.Empty:
                break

    def collect(self, until: str, timeout: float = 4.0) -> list[str]:
        """Collect lines until one matches `until` (regex) or timeout."""
        out, t0 = [], time.time()
        pat = re.compile(until)
        while time.time() - t0 < timeout:
            try:
                ln = self.lines.get(timeout=0.2)
            except queue.Empty:
                continue
            out.append(ln)
            if pat.search(ln):
                break
        return out

    def to_main(self):
        """Normalise the board's menu state back to MAIN."""
        self.send("b"); time.sleep(0.05)
        self.send("b"); time.sleep(0.1)
        self.drain()

    def close(self):
        self._stop.set()
        try:
            self.ser.close()
        except Exception:
            pass


# ── parsers (match the firmware console output formats) ──────────────────
PRE_RE = re.compile(r"^\[(.{2,4})\]\s+\[(\d+/\d+)\]\s+(\S+)\s+-\s+(.*)$")
RES_RE = re.compile(r"RESULT:\s+(.*)$")
STATUS_RE = re.compile(
    r"\[(\w+)\]\s+alt=([-\d.]+)m\s+agl=([-\d.]+)m\s+vel=([-\d.]+)m/s\s+"
    r"P=([-\d.]+)Pa\s+T=([-\d.]+)C.*hi_g=([-\d.]+)\s+lo_g=([-\d.]+).*"
    r"vbat=([-\d.]+)V\s+pyro=([-\d.]+)V\s+armed=(\w+)\s+cont=(\d)/(\d)")


def parse_status(line: str):
    m = STATUS_RE.search(line)
    if not m:
        return None
    g = m.groups()
    return dict(state=g[0], alt=float(g[1]), agl=float(g[2]), vel=float(g[3]),
                p=float(g[4]), t=float(g[5]), hi_g=float(g[6]), lo_g=float(g[7]),
                vbat=float(g[8]), pyro=float(g[9]), armed=(g[10] == "yes"),
                cont1=g[11] == "1", cont2=g[12] == "1")


STATUS_STYLE = {"OK": "bold green", "FAIL": "bold red",
                "WARN": "bold yellow", "INFO": "cyan"}


# ── Preflight TUI ────────────────────────────────────────────────────────
def run_preflight(link: Link):
    link.to_main()
    link.send("1")
    lines = link.collect(r"RESULT:", timeout=6.0)

    tbl = Table(box=box.SIMPLE_HEAVY, expand=True)
    tbl.add_column("Step", style="dim", width=6)
    tbl.add_column("Check", width=14)
    tbl.add_column("Status", width=6)
    tbl.add_column("Detail")
    result = None
    for ln in lines:
        m = PRE_RE.match(ln)
        if m:
            status, step, name, detail = (x.strip() for x in m.groups())
            tbl.add_row(step, name, Text(status, style=STATUS_STYLE.get(status, "white")), detail)
        elif RES_RE.search(ln):
            result = RES_RE.search(ln).group(1).strip()

    color = "green" if result and "PASS" in result and "WARN" not in result \
        else "yellow" if result and "WARN" in result else "red"
    console.clear()
    console.print(Panel(tbl, title="[bold]OZONE PREFLIGHT[/bold]", border_style="cyan"))
    if result:
        console.print(Panel(Align.center(Text(result, style=f"bold {color}")),
                            border_style=color))
    else:
        console.print("[red]No RESULT line received - is the board connected?[/red]")
    console.input("\n[dim]Press Enter to return to menu...[/dim]")


# ── Live Monitor ─────────────────────────────────────────────────────────
def bar(value, lo, hi, width=24, style="green"):
    frac = 0.0 if hi == lo else max(0.0, min(1.0, (value - lo) / (hi - lo)))
    fill = int(frac * width)
    return Text("[" + "#" * fill + "-" * (width - fill) + "]", style=style)


def render_dash(s: dict | None) -> Panel:
    if not s:
        return Panel(Align.center("[dim]waiting for telemetry...[/dim]"),
                     title="OZONE LIVE", border_style="cyan")
    g = Table.grid(expand=True)
    g.add_column(justify="left"); g.add_column(justify="right")
    g.add_row("State", Text(s["state"], style="bold magenta"))
    g.add_row("Altitude (AGL)", f"[bold white]{s['agl']:.1f} m[/bold white]")
    g.add_row("Altitude (abs)", f"{s['alt']:.1f} m")
    g.add_row("Vertical vel", f"{s['vel']:+.1f} m/s")
    g.add_row("Pressure / Temp", f"{s['p']:.0f} Pa  /  {s['t']:.1f} C")
    g.add_row("Accel hi/lo-g", f"{s['hi_g']:.1f} g  /  {s['lo_g']:.2f} g")
    g.add_row("", "")
    vb_style = "green" if s["vbat"] > 3.6 else "yellow" if s["vbat"] > 3.3 else "red"
    g.add_row("Main batt", Text(f"{s['vbat']:.2f} V ", style=vb_style) + bar(s["vbat"], 3.0, 8.4, style=vb_style))
    g.add_row("Pyro batt", f"{s['pyro']:.2f} V")
    g.add_row("Armed", Text("ARMED", style="bold red") if s["armed"] else Text("safe", style="green"))
    c1 = Text("OK", style="green") if s["cont1"] else Text("open", style="red")
    c2 = Text("OK", style="green") if s["cont2"] else Text("open", style="red")
    g.add_row("Continuity ch1/ch2", c1 + Text(" / ") + c2)
    return Panel(g, title="[bold]OZONE LIVE MONITOR[/bold]  (Ctrl-C to stop)",
                 border_style="cyan")


def live_monitor(link: Link):
    link.to_main()
    link.send("4")                 # toggle stream
    resp = link.collect(r"Live stream", timeout=2.0)
    if resp and "off" in resp[-1]:
        link.send("4")             # was on, turn back... -> ensure ON
        link.collect(r"Live stream", timeout=2.0)
    last = None
    try:
        with Live(render_dash(None), console=console, refresh_per_second=8,
                  screen=True) as live:
            while True:
                try:
                    ln = link.lines.get(timeout=0.3)
                    s = parse_status(ln)
                    if s:
                        last = s
                except queue.Empty:
                    pass
                live.update(render_dash(last))
    except KeyboardInterrupt:
        pass
    finally:
        link.to_main()
        link.send("4")             # stream off
        link.drain()


# ── Post-flight TUI ──────────────────────────────────────────────────────
def postflight(link: Link):
    link.to_main()
    link.send("3")                 # enter POST menu
    time.sleep(0.1); link.drain()
    link.send("1")                 # summary
    summ = link.collect(r"main fired", timeout=3.0)
    link.send("3")                 # list logs
    logs = link.collect(r"post>|none|bytes", timeout=3.0)
    link.send("b")                 # back to main

    stbl = Table.grid(padding=(0, 2))
    for ln in summ:
        if ":" in ln and "post>" not in ln:
            k, _, v = ln.partition(":")
            stbl.add_row(k.strip(), Text(v.strip(), style="bold white"))

    ltbl = Table(box=box.SIMPLE, expand=True)
    ltbl.add_column("Log file"); ltbl.add_column("Size", justify="right")
    found = False
    for ln in logs:
        m = re.search(r"(\S+\.CSV)\s+(\d+)\s+bytes", ln, re.I)
        if m:
            ltbl.add_row(m.group(1), f"{int(m.group(2)):,} B"); found = True
    if not found:
        ltbl.add_row("[dim](none)[/dim]", "")

    console.clear()
    console.print(Panel(stbl, title="[bold]FLIGHT SUMMARY[/bold]", border_style="green"))
    console.print(Panel(ltbl, title="[bold]SD LOG FILES[/bold]", border_style="cyan"))
    if console.input("\n[dim]Make safe (disarm) now? [y/N]: [/dim]").lower().startswith("y"):
        link.to_main(); link.send("6")
        console.print("[green]Disarm command sent.[/green]"); time.sleep(0.3)
    console.input("[dim]Press Enter to return to menu...[/dim]")


# ── raw passthrough ──────────────────────────────────────────────────────
def raw_terminal(link: Link):
    console.print("[dim]Raw terminal - type commands, Ctrl-C to exit.[/dim]")
    stop = threading.Event()

    def pr():
        while not stop.is_set():
            try:
                console.print(link.lines.get(timeout=0.2), highlight=False)
            except queue.Empty:
                pass
    th = threading.Thread(target=pr, daemon=True); th.start()
    try:
        while True:
            link.send(input())
    except (KeyboardInterrupt, EOFError):
        stop.set()


# ── main menu ────────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port"); ap.add_argument("--list", action="store_true")
    ap.add_argument("--mode", choices=["preflight", "monitor", "postflight", "raw"],
                    help="jump straight to a view (used by the pnpm scripts)")
    args = ap.parse_args()

    if args.list:
        for p in list_ports.comports():
            console.print(f"{p.device}  vid={p.vid}  {p.description}")
        return

    port = args.port or find_port()
    if not port:
        console.print("[red]No OZONE serial port found.[/red] Plug in the board, "
                      "or pass --port (see --list).")
        return

    try:
        link = Link(port)
    except Exception as e:
        console.print(f"[red]Could not open {port}: {e}[/red]")
        return
    console.print(f"[green]Connected:[/green] {port}")

    # Direct-to-view mode (pnpm preflight / monitor / postflight / terminal).
    if args.mode:
        try:
            {"preflight": run_preflight, "monitor": live_monitor,
             "postflight": postflight, "raw": raw_terminal}[args.mode](link)
        finally:
            link.close()
        return

    try:
        while True:
            console.print(Panel(
                "  [bold]1[/bold]) Preflight checks\n"
                "  [bold]2[/bold]) Live monitor\n"
                "  [bold]3[/bold]) Post-flight / recovery\n"
                "  [bold]4[/bold]) Raw terminal\n"
                "  [bold]q[/bold]) Quit",
                title="[bold cyan]PROJECT OZONE - Ground Console[/bold cyan]",
                border_style="cyan"))
            choice = console.input("ozone-tui> ").strip().lower()
            if choice == "1":
                run_preflight(link)
            elif choice == "2":
                live_monitor(link)
            elif choice == "3":
                postflight(link)
            elif choice == "4":
                raw_terminal(link)
            elif choice in ("q", "quit", "exit"):
                break
    finally:
        link.close()
        console.print("[dim]Disconnected.[/dim]")


if __name__ == "__main__":
    main()

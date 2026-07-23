/**
 * DisconnectedScreen — the resting state whenever nothing is connected: no
 * auto-started simulator, just this red/black hazard-striped screen (the
 * exact `.danger-box .hazard-stripes` treatment already used for the
 * board-fault banner elsewhere in the app — kept identical here, just
 * scaled up to fill the page instead of sitting as a banner over a
 * dashboard). The simulator only ever starts if the operator explicitly
 * picks it from the top-nav connection control.
 */
export function DisconnectedScreen({ detail }: { detail?: string | null }) {
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-[1400px] items-center justify-center px-5">
      <div className="danger-box hazard-stripes rise-in max-w-[560px] rounded-[10px] px-8 py-6 text-center">
        <div className="mx-auto mb-3 h-2.5 w-2.5 rounded-full bg-red pulse" />
        <h1 className="label-caps text-[16px] font-bold tracking-widest">Board disconnected</h1>
        <p className="mx-auto mt-3 max-w-[440px] text-[12px] leading-relaxed opacity-85">
          {detail || "No OZONE board connected."} This console auto-detects a previously-authorized
          board over USB (VID 0x0483 / PID 0x5740) the moment it's plugged in — no click needed.
          Otherwise, open the connection control (top right) to connect a board, a WebSocket hub, or
          the built-in simulator.
        </p>
      </div>
    </main>
  );
}

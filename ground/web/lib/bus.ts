/**
 * bus.ts — tiny per-id pub/sub so high-rate telemetry (graph samples) can
 * drive canvas repaints directly, without funnelling every TLM sample
 * through React state/re-renders. Mirrors the "canvas owns its own paint
 * loop" approach in the vanilla dashboard's chart.js.
 */

export type GraphListener = (t: number, v: number) => void;

export class GraphBus {
  private listeners = new Map<string, Set<GraphListener>>();

  subscribe(id: string, fn: GraphListener): () => void {
    let set = this.listeners.get(id);
    if (!set) {
      set = new Set();
      this.listeners.set(id, set);
    }
    set.add(fn);
    return () => set!.delete(fn);
  }

  publish(id: string, t: number, v: number) {
    this.listeners.get(id)?.forEach((fn) => fn(t, v));
  }
}

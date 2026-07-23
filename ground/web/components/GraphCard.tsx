"use client";

import { useEffect, useRef, useState } from "react";
import type { GraphSpec } from "@/lib/types";
import type { GraphBus } from "@/lib/bus";
import { ScrollChart } from "@/lib/chart";

export function GraphCard({ graph, accent, bus }: { graph: GraphSpec; accent: string; bus: GraphBus }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<ScrollChart | null>(null);
  const [live, setLive] = useState<number | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    const chart = new ScrollChart(canvasRef.current, { unit: graph.unit, accent });
    chartRef.current = chart;
    return () => chart.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    chartRef.current?.setAccent(accent);
  }, [accent]);

  useEffect(() => {
    return bus.subscribe(graph.id, (t, v) => {
      chartRef.current?.push(t, v);
      setLive(v);
    });
  }, [bus, graph.id]);

  return (
    <div className="frost flex flex-col p-2">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="label-caps text-[10px] text-ink-dim">{graph.label}</span>
        <span className="tabular text-[13px] font-semibold text-ink">
          {live == null ? "—" : live.toFixed(2)}
          {graph.unit ? <span className="ml-1 text-[10px] font-normal text-ink-faint">{graph.unit}</span> : null}
        </span>
      </div>
      <div className="h-[84px] w-full">
        <canvas ref={canvasRef} className="h-full w-full" />
      </div>
    </div>
  );
}

"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";

interface ToastCtx {
  show: (msg: string) => void;
}

const Ctx = createContext<ToastCtx | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [key, setKey] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((m: string) => {
    setMsg(m);
    setKey((k) => k + 1);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(null), 3200);
  }, []);

  return (
    <Ctx.Provider value={{ show }}>
      {children}
      {msg && (
        <div
          key={key}
          className="glass toast-in fixed bottom-6 left-1/2 z-[60] max-w-[min(90vw,560px)] -translate-x-1/2 rounded-[10px] px-4 py-2.5 font-mono text-[12px] text-ink"
        >
          {msg}
        </div>
      )}
    </Ctx.Provider>
  );
}

export function useToast(): ToastCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

"use client";

/**
 * FcdConnectionProvider — lifts the single useFcdConnection() instance above
 * both the top nav (which lives in the root layout, so it's shared by every
 * route) and the page content (which needs the same live connection state).
 * Without this, TopNav and the dashboard page would each open their own
 * transport and silently race each other.
 */
import { createContext, useContext } from "react";
import { useFcdConnection, type UseFcdConnection } from "./useFcdConnection";

const Ctx = createContext<UseFcdConnection | null>(null);

export function FcdConnectionProvider({ children }: { children: React.ReactNode }) {
  const value = useFcdConnection();
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useFcdConnectionContext(): UseFcdConnection {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useFcdConnectionContext must be used within FcdConnectionProvider");
  return ctx;
}

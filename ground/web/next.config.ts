import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // This app is a pure client-side ground station (Web Serial / WebSocket /
  // in-browser simulator) — every screen that touches live telemetry is
  // 'use client'. Static export works fine for Vercel or any static host.
  output: "export",
  images: { unoptimized: true },
};

export default nextConfig;

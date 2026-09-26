import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lean, self-contained build output — the standard shape for a Docker/VPS
  // deployment (copy .next/standalone + .next/static + public and run node server.js).
  output: "standalone",
};

export default nextConfig;

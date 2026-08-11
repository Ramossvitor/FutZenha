import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // O browser respeita Cache-Control no service worker: com o default de
        // public/ ele seguraria o sw.js velho por até 24h, e um push handler
        // corrigido só chegaria no dia seguinte. No-cache força revalidar a
        // cada registro.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
    ];
  },
};

export default nextConfig;

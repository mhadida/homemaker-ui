import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    // Local `npm run dev` only — Vercel serves /build directly via the
    // Python service (see vercel.json experimentalServices.build).
    // In dev we route /build → /api/generate-building so the stdio python
    // child keeps doing the work without needing `vercel dev -L`.
    if (process.env.VERCEL) return [];
    return [{ source: "/build", destination: "/api/generate-building" }];
  },
  async headers() {
    return [
      {
        source: "/default.glb",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },
};

export default nextConfig;

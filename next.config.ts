import type { NextConfig } from "next";
import bundleAnalyzer from "@next/bundle-analyzer";
import { staticAssetHeaders } from "./lib/http/cache-headers";

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "date-fns",
      "recharts",
      "lightweight-charts",
    ],
  },
  // B21: favicon vinha com max-age=0, must-revalidate → 74 refetches/sessão.
  // A URL do favicon é versionada por hash, então cache imutável é seguro.
  async headers() {
    return staticAssetHeaders();
  },
};

export default withBundleAnalyzer(nextConfig);

// Initialise OpenNext's Cloudflare bindings during `next dev` so server
// actions / middleware can read them as if they were running on a Worker.
// Lazy + dynamic so production builds and CI without wrangler are fine.
if (process.env.NODE_ENV !== "production") {
  import("@opennextjs/cloudflare")
    .then((mod) => mod.initOpenNextCloudflareForDev?.())
    .catch(() => {
      // adapter not available — fine outside CF dev.
    });
}

import type { NextConfig } from "next";
import bundleAnalyzer from "@next/bundle-analyzer";

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

// B21: o cache do favicon NÃO vai aqui. O `app/favicon.ico` é servido como
// static asset do Cloudflare (`assets` binding → `.open-next/assets`), fora do
// Worker — então `next.config.headers()` não o alcança (tentativa inócua,
// revertida). O header imutável vai em `public/_headers` (mecanismo de headers
// do CF Workers Assets, copiado pro bundle pelo OpenNext).
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

import type { MetadataRoute } from "next";

// PWA manifest — servido em /manifest.webmanifest e auto-linkado pelo Next.
// Cores do design system Abismo Habitado: surface-1 (#111118) como fundo/splash.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Abissal — gestão de banca",
    short_name: "Abissal",
    description:
      "Gestão de banca de apostas com auditoria + análise pré-jogo de fixtures.",
    start_url: "/painel",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#111118",
    theme_color: "#111118",
    lang: "pt-BR",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}

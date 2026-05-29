import type { Metadata, Viewport } from "next";
import { Fraunces, DM_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { PwaRegister } from "@/components/pwa-register";

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  style: ["normal", "italic"],
  display: "swap",
});

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Abissal — gestão de banca",
  description:
    "Plataforma pessoal de gestão de bankroll de apostas com auditoria total e dashboard de qualidade financeira.",
  robots: { index: false, follow: false },
  applicationName: "Abissal",
  appleWebApp: {
    capable: true,
    title: "Abissal",
    statusBarStyle: "black-translucent",
  },
  // Ícones detectados por convenção do Next 16: app/icon.svg, app/apple-icon.png, app/favicon.ico.
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#111118",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="pt-BR"
      className={`${fraunces.variable} ${dmSans.variable} ${jetbrainsMono.variable}`}
    >
      <body className="min-h-screen">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:bg-[var(--color-vermelho)] focus:px-3 focus:py-2 focus:text-[var(--color-ink-display)] focus:rounded"
        >
          pular para conteúdo
        </a>
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}

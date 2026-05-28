import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

// Carrega .env.local para o processo do test runner (E2E_USER_*, Supabase).
// No CI o arquivo não existe e as vars vêm do ambiente do job — leitura falha silenciosa.
function loadDotEnvLocal() {
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split("\n")) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!match) continue;
      const [, key, rawValue] = match;
      let value = rawValue.trimEnd();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    // .env.local ausente (CI) — segue com o ambiente do job.
  }
}
loadDotEnvLocal();

// Galaxy S23 FE (SM-S711B) — viewport CSS do aparelho do Pilot.
// 1080×2340 físicos @ DPR 2.625 → ~412×915 lógicos.
const galaxyS23FE = {
  userAgent:
    "Mozilla/5.0 (Linux; Android 14; SM-S711B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
  viewport: { width: 412, height: 915 },
  deviceScaleFactor: 2.625,
  isMobile: true,
  hasTouch: true,
  defaultBrowserType: "chromium" as const,
};

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  fullyParallel: true,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-s23fe",
      use: { ...galaxyS23FE },
    },
  ],
  webServer: [
    {
      // Mock OpenRouter para o stub de OCR. O OCR é Server Action (server→server),
      // que page.route não intercepta — então mockamos no nível HTTP via
      // OPENROUTER_BASE_URL apontando aqui.
      command: "node tests/e2e/support/mock-openrouter.mjs",
      url: "http://127.0.0.1:8787/health",
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      // CI: build já rodou; sobe o servidor de produção. Local: dev server.
      // OPENROUTER_BASE_URL inline no comando garante propagação ao runtime
      // (verificado via /api/debug-env). O teste de live OCR é excluído da suíte.
      command: process.env.CI
        ? "OPENROUTER_BASE_URL=http://127.0.0.1:8787/api/v1 pnpm start"
        : "OPENROUTER_BASE_URL=http://127.0.0.1:8787/api/v1 pnpm dev",
      url: "http://localhost:3000",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});

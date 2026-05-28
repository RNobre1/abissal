import { type Page } from "@playwright/test";

/**
 * Loga com o usuário E2E dedicado pelo fluxo real de login (email+senha).
 * Requer E2E_USER_EMAIL / E2E_USER_PASSWORD no ambiente:
 *   - local: .env.local (carregado em playwright.config.ts via @next/env)
 *   - CI: GH secrets injetados no job
 *
 * O usuário é RLS-isolado (banca própria, vazia) — não toca os dados do Pilot.
 * Dados de fixtures/simulação/calibração são compartilhados (authenticated SELECT),
 * então as rotas de análise aparecem populadas mesmo com banca vazia.
 */
export async function loginAsTestUser(page: Page) {
  const email = process.env.E2E_USER_EMAIL;
  const password = process.env.E2E_USER_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "E2E_USER_EMAIL/E2E_USER_PASSWORD ausentes — configure .env.local (local) ou GH secrets (CI).",
    );
  }

  await page.goto("/login");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => new URL(url).pathname === "/", {
    timeout: 15_000,
  });
}

/** True quando as credenciais E2E estão disponíveis (para test.skip condicional). */
export function hasE2ECredentials(): boolean {
  return Boolean(process.env.E2E_USER_EMAIL && process.env.E2E_USER_PASSWORD);
}

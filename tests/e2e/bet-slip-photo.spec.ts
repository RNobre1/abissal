/**
 * E2E — BetSlipPhotoImport (Wave N4)
 *
 * 2.A — E2E "stub": mocks OpenRouter via page.route(), sem gastar tokens Gemini.
 *       Roda na suite padrão.
 *
 * Auth strategy: Supabase Admin API `generate_link` (magic-link) → follow redirect
 * → cookies injetados pelo SSR. Requer SUPABASE_SERVICE_ROLE_KEY,
 * NEXT_PUBLIC_SUPABASE_URL e E2E_USER_EMAIL.
 *
 * Skip guard: se qualquer var obrigatória estiver ausente, todos os testes
 * são marcados como skip — nunca fail na CI por falta de configuração.
 *
 * O mock OpenRouter retorna 2 legs:
 *   - Leg 1: Flamengo × Palmeiras — sem fixture no DB (auto-link só possível com DB real)
 *   - Leg 2: Arsenal × Chelsea — idem
 *
 * Na UI de confirmação o componente renderiza as legs parseadas, mesmo sem
 * fixture vinculada — o fluxo termina com "Adicionar N legs ao bilhete".
 *
 * Cleanup: remove legs criadas via DELETE /api/bet-slip/legs (se existir)
 * ou simplesmente navega de volta — legs em draft não afetam outros testes.
 */

import { test, expect, type Page } from "@playwright/test";
import * as path from "path";

// ── Env guards ────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const E2E_EMAIL = process.env.E2E_USER_EMAIL ?? "rafael@meteoradigital.io";
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

const authReady =
  SUPABASE_URL.length > 0 &&
  SERVICE_ROLE_KEY.length > 0 &&
  E2E_EMAIL.length > 0;

// ── Auth helper ───────────────────────────────────────────────────────────────

/**
 * Authenticates the E2E user via Supabase Admin magic-link.
 *
 * Strategy:
 *   1. Call Admin API `generate_link` with `redirectTo = BASE_URL/bilhete`
 *   2. Navigate to the returned action_link (hosted at Supabase)
 *   3. Supabase verifies the token and redirects to redirectTo
 *   4. The Next.js SSR middleware receives the cookies and sets the session
 *
 * This avoids needing an /auth/confirm route in the app.
 */
async function authenticateViaAdminMagicLink(page: Page): Promise<boolean> {
  if (!authReady) return false;

  // 1. Generate a magic link via Admin REST API
  const res = await fetch(
    `${SUPABASE_URL}/auth/v1/admin/generate_link`,
    {
      method: "POST",
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "magiclink",
        email: E2E_EMAIL,
        options: {
          // Redirect to the local app after verification
          redirectTo: `${BASE_URL}/bilhete`,
        },
      }),
    },
  );

  if (!res.ok) {
    console.error("[e2e-auth] generate_link failed:", res.status, await res.text());
    return false;
  }

  const data = (await res.json()) as {
    properties?: { action_link?: string };
    action_link?: string;
  };

  const actionLink = data.properties?.action_link ?? data.action_link ?? "";

  if (!actionLink) {
    console.error("[e2e-auth] no action_link in response:", JSON.stringify(data));
    return false;
  }

  // 2. Navigate to Supabase action_link — it verifies the token and redirects
  //    back to redirectTo (our local /bilhete). The browser follows the redirect
  //    and the Next.js middleware sees the Supabase auth fragment/cookies.
  await page.goto(actionLink);

  // Wait until we land on a local URL (not supabase.co)
  await page
    .waitForURL(
      (url) => url.hostname === "localhost" || url.hostname === "127.0.0.1",
      { timeout: 15_000 },
    )
    .catch(() => undefined);

  return true;
}

// ── Mock OpenRouter response ──────────────────────────────────────────────────

/**
 * OpenRouter mock — returns 2 legs:
 *   Leg 1: Flamengo × Palmeiras (auto-link confidence: none, no DB fixture)
 *   Leg 2: Arsenal × Chelsea (same)
 */
const MOCK_OPENROUTER_RESPONSE = {
  choices: [
    {
      message: {
        content: JSON.stringify({
          legs: [
            {
              home: "Flamengo",
              away: "Palmeiras",
              market: "1X2",
              side: "Casa",
              odd_taken: 2.1,
              league: "Brasileirão Série A",
              kickoff_iso: null,
            },
            {
              home: "Arsenal",
              away: "Chelsea",
              market: "BTTS",
              side: "Sim",
              odd_taken: 1.75,
              league: "Premier League",
              kickoff_iso: null,
            },
          ],
          stake_total: 50,
          odd_combined: 3.675,
          house_detected: "superbet",
        }),
      },
    },
  ],
};

// ── Fixtures path ─────────────────────────────────────────────────────────────

const MOCK_BET_SLIP_PNG = path.join(__dirname, "fixtures", "mock-bet-slip.png");

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe("bet-slip-photo · stub (mocked OpenRouter)", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(async ({ page }) => {
    // Intercept ALL OpenRouter requests and return mock JSON
    await page.route("**/openrouter.ai/api/v1/chat/completions", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_OPENROUTER_RESPONSE),
      });
    });
  });

  test("fluxo completo: upload → confirmação → commit (stub)", async ({ page }) => {
    test.skip(
      !authReady,
      "Needs SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL + E2E_USER_EMAIL for magic-link auth",
    );

    // 1. Auth
    const authed = await authenticateViaAdminMagicLink(page);
    test.skip(!authed, "auth via magic-link failed — check Supabase Admin API credentials");

    // 2. Navigate to /bilhete (where the drawer with "Importar foto" lives)
    await page.goto("/bilhete");
    await expect(page).not.toHaveURL(/login/, { timeout: 10_000 });

    // The "Importar foto" button should be visible on the bilhete page
    const importBtn = page.getByRole("button", { name: /importar foto/i });
    await expect(importBtn).toBeVisible({ timeout: 10_000 });

    // 3. Upload the mock PNG via the hidden file input
    // The file input is hidden; we trigger it via the button click + setInputFiles
    const fileInput = page.locator('input[type="file"][accept="image/*"]');
    await expect(fileInput).toBeAttached();

    // Playwright can set files directly on hidden inputs
    await fileInput.setInputFiles(MOCK_BET_SLIP_PNG);

    // 4. "Analisando cupom..." spinner should appear briefly
    // then the confirmation dialog should appear
    const dialog = page.getByRole("dialog", { name: /confirmar legs/i });
    await expect(dialog).toBeVisible({ timeout: 15_000 });

    // 5. Both legs should be visible in the list
    await expect(page.getByText("Flamengo")).toBeVisible();
    await expect(page.getByText("Arsenal")).toBeVisible();

    // 6. Because neither team has a DB fixture, both legs should show "Selecione fixture"
    //    OR they may auto-link if fixtures happen to exist in dev DB.
    //    We only assert the dialog is correctly formed — no strict badge assertion
    //    since it depends on DB state.
    const addBtn = page.getByRole("button", { name: /adicionar/i });
    await expect(addBtn).toBeVisible();
    await expect(addBtn).toBeEnabled();

    // 7. Click "Adicionar N legs ao bilhete"
    await addBtn.click();

    // 8. Dialog should close and we return to the normal bilhete view
    await expect(dialog).not.toBeVisible({ timeout: 10_000 });

    // 9. The "Importar foto" button should be accessible again (state=idle)
    await expect(importBtn).toBeVisible();
    await expect(importBtn).toBeEnabled();
  });

  test("exibe erro gracioso quando parse falha (stub 500)", async ({ page }) => {
    test.skip(
      !authReady,
      "Needs SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL + E2E_USER_EMAIL for magic-link auth",
    );

    // Override: return error response
    await page.route("**/openrouter.ai/api/v1/chat/completions", (route) => {
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "model overloaded" }),
      });
    });

    const authed = await authenticateViaAdminMagicLink(page);
    test.skip(!authed, "auth via magic-link failed");

    await page.goto("/bilhete");
    await expect(page).not.toHaveURL(/login/, { timeout: 10_000 });

    const fileInput = page.locator('input[type="file"][accept="image/*"]');
    await expect(fileInput).toBeAttached();
    await fileInput.setInputFiles(MOCK_BET_SLIP_PNG);

    // Should show error message
    const errorAlert = page.getByRole("alert");
    await expect(errorAlert).toBeVisible({ timeout: 15_000 });
    // Text should mention not being able to read the cupom
    await expect(errorAlert).toContainText(/cupom|foto|erro/i);

    // Dismiss
    const closeBtn = errorAlert.getByRole("button", { name: /fechar/i });
    await closeBtn.click();
    await expect(errorAlert).not.toBeVisible();
  });
});

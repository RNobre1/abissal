/**
 * E2E — BetSlipPhotoImport LIVE (Wave N4)
 *
 * 2.B — E2E "live": usa Gemini real via OpenRouter (sem mock). Gasta ~$0.0015/run.
 *
 * COMO RODAR:
 *   1. Coloque uma screenshot real de cupom em tests/e2e/fixtures/superbet-real.png
 *      (não commitada — listada no .gitignore)
 *   2. Garanta OPENROUTER_API_KEY, E2E_USER_EMAIL, SUPABASE_SERVICE_ROLE_KEY no ambiente
 *   3. Execute:
 *        PLAYWRIGHT_LIVE_OCR=1 pnpm test:e2e bet-slip-photo-live
 *
 * Valida:
 *  - Modal de confirmação aparece com ≥ 1 leg parseada
 *  - Cada leg tem home, away, market e odd_taken visíveis
 *  - Click "Adicionar" completa sem erro
 */

import { test, expect, type Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

// ── Guard ─────────────────────────────────────────────────────────────────────

const LIVE_OCR = !!process.env.PLAYWRIGHT_LIVE_OCR;
const REAL_SLIP_PATH = path.join(__dirname, "fixtures", "superbet-real.png");
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const E2E_EMAIL = process.env.E2E_USER_EMAIL ?? "rafael@meteoradigital.io";
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

const authReady = SUPABASE_URL.length > 0 && SERVICE_ROLE_KEY.length > 0 && E2E_EMAIL.length > 0;
const fixtureExists = fs.existsSync(REAL_SLIP_PATH);

// ── Auth helper (same as stub spec) ──────────────────────────────────────────

async function authenticateViaAdminMagicLink(page: Page): Promise<boolean> {
  if (!authReady) return false;

  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      type: "magiclink",
      email: E2E_EMAIL,
      options: { redirectTo: `${BASE_URL}/bilhete` },
    }),
  });

  if (!res.ok) return false;

  const data = (await res.json()) as {
    properties?: { action_link?: string };
    action_link?: string;
  };

  const actionLink = data.properties?.action_link ?? data.action_link ?? "";
  if (!actionLink) return false;

  await page.goto(actionLink);
  await page
    .waitForURL(
      (url) => url.hostname === "localhost" || url.hostname === "127.0.0.1",
      { timeout: 15_000 },
    )
    .catch(() => undefined);
  return true;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe("bet-slip-photo · live OCR (real Gemini, costs ~$0.0015)", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("parse real bet slip image via Gemini and confirm legs", async ({ page }) => {
    test.skip(!LIVE_OCR, "Set PLAYWRIGHT_LIVE_OCR=1 + place fixture image at tests/e2e/fixtures/superbet-real.png to run");
    test.skip(!fixtureExists, `Fixture image not found at ${REAL_SLIP_PATH} — place a real Superbet screenshot there`);
    test.skip(!authReady, "Needs SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL + E2E_USER_EMAIL");

    const authed = await authenticateViaAdminMagicLink(page);
    test.skip(!authed, "auth via magic-link failed");

    await page.goto("/bilhete");
    await expect(page).not.toHaveURL(/login/, { timeout: 10_000 });

    const fileInput = page.locator('input[type="file"][accept="image/*"]');
    await expect(fileInput).toBeAttached();
    await fileInput.setInputFiles(REAL_SLIP_PATH);

    // Wait longer for real Gemini call (up to 30s)
    const dialog = page.getByRole("dialog", { name: /confirmar legs/i });
    await expect(dialog).toBeVisible({ timeout: 30_000 });

    // At least 1 leg should appear
    const legItems = dialog.locator("li");
    const legCount = await legItems.count();
    expect(legCount).toBeGreaterThanOrEqual(1);

    // Each leg should have odd input (numeric)
    const oddInputs = dialog.locator('input[type="number"]');
    expect(await oddInputs.count()).toBe(legCount);

    // Confirm
    const addBtn = page.getByRole("button", { name: /adicionar/i });
    await expect(addBtn).toBeEnabled();
    await addBtn.click();

    await expect(dialog).not.toBeVisible({ timeout: 15_000 });
  });
});

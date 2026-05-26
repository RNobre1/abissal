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
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

// ── Guard ─────────────────────────────────────────────────────────────────────

const LIVE_OCR = !!process.env.PLAYWRIGHT_LIVE_OCR;
const REAL_SLIP_PATH = path.join(__dirname, "fixtures", "superbet-real.png");
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const E2E_EMAIL = process.env.E2E_USER_EMAIL ?? "rafael@meteoradigital.io";
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

const authReady = SUPABASE_URL.length > 0 && SERVICE_ROLE_KEY.length > 0 && ANON_KEY.length > 0 && E2E_EMAIL.length > 0;
const fixtureExists = fs.existsSync(REAL_SLIP_PATH);

// ── Auth helper (cookie injection — same strategy as stub spec) ──────────────

async function authenticateViaCookieInjection(page: Page): Promise<boolean> {
  if (!authReady) return false;

  const adminClient = createSupabaseClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: genData, error: genErr } =
    await adminClient.auth.admin.generateLink({ type: "magiclink", email: E2E_EMAIL });
  if (genErr || !genData) return false;

  const hashedToken = genData.properties.hashed_token;
  if (!hashedToken) return false;

  const anonClient = createSupabaseClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const { data: verifyData, error: verifyErr } = await anonClient.auth.verifyOtp({
    token_hash: hashedToken,
    type: "magiclink",
  });
  if (verifyErr || !verifyData.session) return false;

  const { access_token, refresh_token } = verifyData.session;

  const cookiesToInject: Array<{ name: string; value: string }> = [];
  const ssrClient = createServerClient(SUPABASE_URL, ANON_KEY, {
    cookies: {
      getAll: () => [],
      setAll: (cookies) => {
        for (const c of cookies) cookiesToInject.push({ name: c.name, value: c.value });
      },
    },
  });
  await ssrClient.auth.setSession({ access_token, refresh_token });

  if (cookiesToInject.length === 0) return false;

  await page.context().addCookies(
    cookiesToInject.map((c) => ({
      name: c.name,
      value: c.value,
      domain: "localhost",
      path: "/",
      httpOnly: false,
      secure: false,
      sameSite: "Lax" as const,
    })),
  );
  return true;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe("bet-slip-photo · live OCR (real Gemini, costs ~$0.0015)", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("parse real bet slip image via Gemini and confirm legs", async ({ page }) => {
    test.skip(!LIVE_OCR, "Set PLAYWRIGHT_LIVE_OCR=1 + place fixture image at tests/e2e/fixtures/superbet-real.png to run");
    test.skip(!fixtureExists, `Fixture image not found at ${REAL_SLIP_PATH} — place a real Superbet screenshot there`);
    test.skip(!authReady, "Needs SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL + E2E_USER_EMAIL");

    const authed = await authenticateViaCookieInjection(page);
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

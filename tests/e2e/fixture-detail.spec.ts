import { test, expect, type Page } from "@playwright/test";
import { loginAsTestUser, hasE2ECredentials } from "./helpers/auth";

/**
 * E2E para a página de detalhe do jogo (stats-first).
 *
 * O copilot agêntico por jogo foi REMOVIDO e substituído pelo recomendador
 * IA-2 (SimulationPanel + AiRecoPanel + DecisionZone). Estes testes cobrem o
 * contrato que sobreviveu:
 *   1. abrir um jogo cai no dashboard de stats (não em chat);
 *   2. a rota legada /fixtures/[id]/stats redireciona para /fixtures/[id].
 *
 * Discovery: a retenção do DB rola 3-4 dias, então buscamos a 1ª fixture
 * com `detail_json` não-nulo em today/tomorrow. Sem dados → skip.
 */
test.beforeEach(async ({ page }) => {
  test.skip(!hasE2ECredentials(), "E2E_USER_* ausentes — configure creds para rodar");
  await loginAsTestUser(page);
});

async function pickFixtureWithDetail(
  page: Page,
): Promise<{ id: number } | null> {
  for (const date of ["today", "tomorrow"]) {
    const resp = await page.request.get(`/api/fixtures?date=${date}`);
    if (!resp.ok()) continue;
    const ct = resp.headers()["content-type"] ?? "";
    if (!ct.includes("application/json")) continue;
    const rows = (await resp.json()) as Array<{
      id: number;
      detail_json: unknown | null;
    }>;
    const hit = rows.find((r) => r.detail_json !== null);
    if (hit) return { id: hit.id };
  }
  return null;
}

test.describe("fixture detail · stats-first", () => {
  test("abrir um jogo cai no dashboard de stats, não em chat", async ({
    page,
  }) => {
    const fixture = await pickFixtureWithDetail(page);
    test.skip(
      !fixture,
      "nenhuma fixture com detail_json no DB — seed para exercitar",
    );

    await page.goto(`/fixtures/${fixture!.id}`);
    await expect(page).toHaveURL(new RegExp(`/fixtures/${fixture!.id}/?$`));
    await expect(page).not.toHaveURL(/\/chat(\/|$)/);
    // O dashboard monta com o hero (h1 com os nomes dos times).
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  });

  test("/fixtures/[id]/stats redireciona para /fixtures/[id]", async ({
    page,
  }) => {
    const fixture = await pickFixtureWithDetail(page);
    test.skip(
      !fixture,
      "nenhuma fixture com detail_json no DB — seed para exercitar",
    );

    await page.goto(`/fixtures/${fixture!.id}/stats`);
    await expect(page).toHaveURL(new RegExp(`/fixtures/${fixture!.id}/?$`));
    await expect(page).not.toHaveURL(/\/stats(\/|$)/);
  });
});

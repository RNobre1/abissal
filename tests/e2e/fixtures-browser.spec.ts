import { test, expect } from "@playwright/test";
import { loginAsTestUser, hasE2ECredentials } from "./helpers/auth";

/**
 * E2E — tela de jogos com filtros/ordenação/busca (FixturesBrowser).
 *
 * Assertções estruturais (não dependem de quais jogos têm no dia): a barra de
 * filtros renderiza, o toggle de view alterna grouped⇄flat (data-fixtures-view),
 * e o flat não tem headers de liga. A parte de busca→empty-state só roda se o
 * dia tiver jogos (senão a lista já está vazia por falta de dados).
 */
test.beforeEach(async ({ page }) => {
  test.skip(!hasE2ECredentials(), "E2E_USER_* ausentes — configure creds para rodar");
  await loginAsTestUser(page);
});

test.describe("fixtures browser · filtros + view", () => {
  test("barra renderiza e o toggle de view alterna grouped⇄flat", async ({ page }) => {
    await page.goto("/fixtures?date=today");

    // controles sempre presentes (independe de ter jogo)
    await expect(page.getByLabel("Buscar time")).toBeVisible();
    await expect(page.getByRole("button", { name: "agrupar" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^tempo$/ })).toBeVisible();
    await expect(page.getByLabel("Ordenar")).toBeVisible();

    const browser = page.locator("[data-fixtures-view]");
    await expect(browser).toHaveAttribute("data-fixtures-view", "grouped");

    await page.getByRole("button", { name: /^tempo$/ }).click();
    await expect(browser).toHaveAttribute("data-fixtures-view", "flat");
    await expect(page.locator("[data-league-group]")).toHaveCount(0);

    await page.getByRole("button", { name: "agrupar" }).click();
    await expect(browser).toHaveAttribute("data-fixtures-view", "grouped");

    // busca sem match → empty-state — só faz sentido com jogos no dia
    const cardCount = await page.locator('a[href^="/fixtures/"]').count();
    test.skip(cardCount === 0, "sem jogos no dia — pula a parte de busca/empty");

    await page.getByLabel("Buscar time").fill("zzzznadaaqui");
    await expect(page.locator('a[href^="/fixtures/"]')).toHaveCount(0);
    await expect(page.getByText(/nenhum jogo com esses filtros/i)).toBeVisible();

    await page.getByRole("button", { name: /limpar/i }).click();
    await expect(page.locator('a[href^="/fixtures/"]')).toHaveCount(cardCount);
  });
});

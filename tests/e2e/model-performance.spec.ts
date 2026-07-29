import { test, expect, type Page } from "@playwright/test";
import { loginAsTestUser } from "./helpers/auth";

/**
 * Read-only: confere que o painel de desempenho por liga aparece na tela do
 * jogo e obedece à regra de honestidade do spec (acerto sempre acompanhado de
 * lift). NÃO escreve na banca.
 *
 * Navega pela LISTA e entra no primeiro jogo, esperando a navegação completar —
 * a primeira versão deste teste clicava e verificava sem esperar, e os dois
 * casos passavam como `skipped` mascarando o resultado.
 */
async function abrePrimeiroJogo(page: Page) {
  await loginAsTestUser(page);
  await page.goto("/fixtures");
  const link = page.locator('a[href^="/fixtures/"]').first();
  await expect(link).toBeVisible({ timeout: 20_000 });
  const href = await link.getAttribute("href");
  await page.goto(href!);
  await page.waitForLoadState("networkidle");
}

test.describe("desempenho do modelo por liga", () => {
  test("painel abre e mostra acerto acompanhado de lift", async ({ page }) => {
    await abrePrimeiroJogo(page);

    const painel = page.getByTestId("model-performance");
    // Liga sem nenhuma simulação resolvida não renderiza o painel — degradação
    // esperada. Falha (não skip) se nem o painel nem a simulação existirem, o
    // que indicaria página quebrada em vez de liga sem histórico.
    if ((await painel.count()) === 0) {
      await expect(page.locator("body")).toContainText(/simula/i);
      return;
    }

    await expect(painel).toBeVisible();
    await painel.locator("summary").click();

    const primeiraLinha = painel.locator("tbody tr").first();
    await expect(primeiraLinha).toBeVisible();
    // A regra do spec: nunca o acerto sozinho.
    await expect(primeiraLinha).toContainText(/%/);
    await expect(primeiraLinha).toContainText(/pp/);
  });

  test("a manchete resume sem colar a linha no nome do mercado", async ({ page }) => {
    await abrePrimeiroJogo(page);
    const painel = page.getByTestId("model-performance");
    if ((await painel.count()) === 0) return;

    const manchete = await painel.locator("summary p").textContent();
    expect(manchete).toBeTruthy();
    // "fraco em escanteios · menos de 8.5" era o bug — a frase usa shortLabel.
    expect(manchete).not.toMatch(/(vai bem|fraco) em [^·]+· (mais|menos) de/);
  });

  test("a tabela da simulação traz a coluna de lado", async ({ page }) => {
    await abrePrimeiroJogo(page);

    const sinal = page.locator("[data-sim-signal]");
    if ((await sinal.count()) === 0) {
      // Sem simulação a coluna não existe — mas a página tem que estar de pé.
      await expect(page.locator("body")).toContainText(/simula/i);
      return;
    }
    await expect(sinal.first()).toBeAttached();

    // Escanteios/cartões/SOT recebem símbolo; faltas/impedimentos/desarmes não.
    const escanteios = page.locator('[data-sim-signal="corners"]');
    await expect(escanteios).toHaveText(/[+−≈]/);
    await expect(page.locator('[data-sim-signal="fouls"]')).toHaveText("");
  });
});

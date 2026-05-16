import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * E2E for the cross-game fixtures-day Copilot (Sub-projeto B).
 *
 * Frozen intent (3 behaviors):
 *   1. cost guard — navigating to /fixtures does NOT fire any /api/copilot
 *      request on mount (the FAB is closed; requests only happen on send());
 *   2. the FAB opens the copilot drawer (role=dialog) with the input visible;
 *   3. axe-core finds 0 violations scoped to the open drawer.
 *
 * FAB locator: `aria-label="Abrir copilot"` — derived from
 * components/fixtures/copilot-fab.tsx line 173:
 *   <button ... aria-label="Abrir copilot" ...>
 *
 * Input placeholder: "pergunte sobre os jogos do dia…" — derived from
 * components/fixtures/copilot-fab.tsx line 297.
 *
 * No DB state dependency: the test only exercises the static shell
 * (FAB renders on /fixtures regardless of fixture data).
 */
test.describe("Copilot geral cross-jogo", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("home → FAB abre, sem chamada LLM no mount, axe limpo", async ({
    page,
  }) => {
    const llmCalls: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/copilot"))
        llmCalls.push(r.method() + " " + r.url());
    });

    await page.goto("/fixtures");
    await page.waitForLoadState("networkidle");

    // 1. Guard de custo: nenhuma chamada ao LLM no mount.
    expect(llmCalls, "não deve chamar /api/copilot no mount").toHaveLength(0);

    // 2. FAB abre o drawer.
    // aria-label="Abrir copilot" — copilot-fab.tsx:173
    await page.getByLabel("Abrir copilot").click();

    const input = page.getByPlaceholder(/pergunte sobre os jogos do dia/i);
    await expect(input).toBeVisible();

    // 3. Axe: zero violações no drawer aberto.
    const results = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    expect(
      results.violations,
      `axe encontrou ${results.violations.length} violação(ões): ${JSON.stringify(
        results.violations.map((v) => ({ id: v.id, nodes: v.nodes.length })),
        null,
        2,
      )}`,
    ).toEqual([]);
  });
});

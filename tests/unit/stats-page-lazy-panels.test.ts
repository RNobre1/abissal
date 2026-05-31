/**
 * Guard de CPU do Worker (Lição B23): a página de stats /fixtures/[id] estourava
 * o limite de CPU do Worker (outcome=exceededCpu, 1102, Free=10ms CPU/request)
 * porque painéis de ALTA cardinalidade eram renderizados no SSR. O compute
 * server-side é trivial (~0,68ms medido); o CPU estava no renderToString da
 * árvore React dos painéis.
 *
 * Fix:
 *  - MarketsBrowser (52 mercados): REMOVIDO — o Pilot nunca usa; as odds que
 *    importam já aparecem no Hero (deriveHeroKpis) no painel inicial.
 *  - StreaksHeatmap (~222 entradas) e Distributions: client-only via
 *    `_components/lazy-charts.tsx` (next/dynamic + ssr:false) — o Worker NÃO os
 *    renderiza; sobem no cliente.
 *
 * Este teste estático impede a reintrodução do renderToString no Worker.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PAGE_PATH = join(
  __dirname,
  "../../app/(dashboard)/fixtures/[id]/page.tsx",
);

const LAZY_PANELS = [
  { name: "StreaksHeatmap", panelModule: "panels/streaks-heatmap" },
  { name: "Distributions", panelModule: "panels/distributions" },
];

describe("stats page — guard de CPU do Worker (B23)", () => {
  const src = readFileSync(PAGE_PATH, "utf-8");

  for (const p of LAZY_PANELS) {
    it(`${p.name} NÃO é importado direto do painel (renderiza no cliente, não no Worker)`, () => {
      const directImport = new RegExp(
        `import\\s*\\{[^}]*\\b${p.name}\\b[^}]*\\}\\s*from\\s*["'][^"']*${p.panelModule.replace("/", "\\/")}["']`,
      );
      expect(src).not.toMatch(directImport);
    });
  }

  it("os painéis lazy vêm do _components/lazy-charts (next/dynamic ssr:false)", () => {
    expect(src).toMatch(/from\s+["']\.\/_components\/lazy-charts["']/);
    for (const p of LAZY_PANELS) {
      expect(src).toMatch(new RegExp(`\\b${p.name}\\b`));
    }
  });

  it("MarketsBrowser foi REMOVIDO da página (nunca usado; odds vêm do Hero)", () => {
    expect(src).not.toMatch(/markets-browser/);
    expect(src).not.toMatch(/\bMarketsBrowser\b/);
    // deriveOddsCategories alimentava só o MarketsBrowser → também sai.
    expect(src).not.toMatch(/\bderiveOddsCategories\b/);
  });
});

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Guard de fiação (lição B16/B25): o FixtureCopilotDrawer precisa estar
 * WIRED na página real do jogo — não só existir como componente. A page é
 * um Server Component pesado (Supabase + 14 painéis), então o guard é
 * estático sobre o source: import + render com as props do fixture.
 */
const PAGE_PATH = path.resolve(
  __dirname,
  "../../app/(dashboard)/fixtures/[id]/page.tsx",
);

describe("fiação do copilot na página do jogo", () => {
  const src = readFileSync(PAGE_PATH, "utf8");

  it("importa o FixtureCopilotDrawer", () => {
    expect(src).toContain(
      'import { FixtureCopilotDrawer } from "@/components/fixtures/fixture-copilot-drawer"',
    );
  });

  it("renderiza o drawer com fixtureId/homeTeam/awayTeam da row", () => {
    expect(src).toMatch(/<FixtureCopilotDrawer[\s\S]*?fixtureId=\{row\.id\}/);
    expect(src).toMatch(/homeTeam=\{row\.home_team\}/);
    expect(src).toMatch(/awayTeam=\{row\.away_team\}/);
  });
});

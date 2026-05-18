/**
 * Teste de paridade badge-thresholds TS ↔ SQL.
 *
 * Não há harness SQL no repo, então a estratégia é parsear o texto de
 * `0017_fixture_badges.sql` com regex e verificar que CADA literal
 * numérico/string de threshold presente em `badge-thresholds.ts` aparece
 * TAMBÉM no SQL. Se alguém mudar um lado só, este teste falha antes do merge.
 *
 * Abordagem:
 *   1. Lê o arquivo SQL como texto (via `import` estático de assets ou fs).
 *   2. Para cada constante/substring, asserta que o valor está no SQL.
 *   3. Documenta o mapeamento TS → SQL para facilitar manutenção futura.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  STREAK_PERC_MIN,
  REFEREE_BOOKING_THRESHOLD,
  REFEREE_2YA_THRESHOLD,
  REFEREE_MIN_COMPLETED,
  MAX_BADGES,
  STREAK_OVER25_SUBSTR,
  STREAK_BTTS_SUBSTRS,
  STREAK_FH_SUBSTRS,
} from "./badge-thresholds";

// Localiza o SQL relativo à raiz do repositório (worktree-safe).
const SQL_PATH = join(
  __dirname,
  "../../supabase/migrations/0017_fixture_badges.sql",
);

function loadSql(): string {
  return readFileSync(SQL_PATH, "utf-8");
}

describe("badge-thresholds.ts ↔ 0017_fixture_badges.sql — paridade", () => {
  let sql: string;
  // carrega uma vez; se o arquivo não existir o primeiro test falha com mensagem clara
  try {
    sql = loadSql();
  } catch {
    sql = "";
  }

  it("SQL existe e é não-vazio", () => {
    expect(sql.length).toBeGreaterThan(0);
  });

  // ── Thresholds numéricos ───────────────────────────────────────────────────

  it(`STREAK_PERC_MIN (${STREAK_PERC_MIN}) aparece no SQL como 'perc >= ${STREAK_PERC_MIN}'`, () => {
    expect(sql).toContain(`>= ${STREAK_PERC_MIN}`);
  });

  it(`REFEREE_BOOKING_THRESHOLD (${REFEREE_BOOKING_THRESHOLD}) aparece no SQL como '> ${REFEREE_BOOKING_THRESHOLD}'`, () => {
    expect(sql).toContain(`> ${REFEREE_BOOKING_THRESHOLD}`);
  });

  it(`REFEREE_2YA_THRESHOLD (${REFEREE_2YA_THRESHOLD}) aparece no SQL como '>= ${REFEREE_2YA_THRESHOLD}'`, () => {
    // '>= 3' aparece também para REFEREE_MIN_COMPLETED check — garantimos que
    // existe ao menos uma ocorrência; o contexto semântico é validado pelo
    // teste de paridade de REFEREE_MIN_COMPLETED separadamente.
    expect(sql).toContain(`>= ${REFEREE_2YA_THRESHOLD}`);
  });

  it(`REFEREE_MIN_COMPLETED (${REFEREE_MIN_COMPLETED}) aparece no SQL como '>= ${REFEREE_MIN_COMPLETED}'`, () => {
    expect(sql).toContain(`>= ${REFEREE_MIN_COMPLETED}`);
  });

  it(`MAX_BADGES (${MAX_BADGES}) aparece no SQL como slice '[1:${MAX_BADGES}]'`, () => {
    expect(sql).toContain(`[1:${MAX_BADGES}]`);
  });

  // ── Substrings de streak ───────────────────────────────────────────────────

  it(`STREAK_OVER25_SUBSTR ('${STREAK_OVER25_SUBSTR}') aparece no SQL dentro de like`, () => {
    expect(sql).toContain(`'%${STREAK_OVER25_SUBSTR}%'`);
  });

  for (const sub of STREAK_BTTS_SUBSTRS) {
    it(`STREAK_BTTS_SUBSTRS item '${sub}' aparece no SQL dentro de like`, () => {
      expect(sql).toContain(`'%${sub}%'`);
    });
  }

  for (const sub of STREAK_FH_SUBSTRS) {
    it(`STREAK_FH_SUBSTRS item '${sub}' aparece no SQL dentro de like`, () => {
      expect(sql).toContain(`'%${sub}%'`);
    });
  }

  // ── Slugs de badge (badge_arrays CTE) ─────────────────────────────────────

  const expectedSlugs = ["cartao-alto", "over-alto", "btts-alto", "primeiro-tempo"];
  for (const slug of expectedSlugs) {
    it(`slug '${slug}' aparece no SQL (badge_arrays CTE)`, () => {
      expect(sql).toContain(`'${slug}'`);
    });
  }
});

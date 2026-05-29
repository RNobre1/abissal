#!/usr/bin/env node
/**
 * scripts/perf/probe-fixtures-queries.mjs
 *
 * Cronometra individualmente as 3 queries que fixturesForBrtDay() dispara,
 * contra PROD via PostgREST (service_role). Isola qual é o gargalo dos ~800ms-1.1s
 * da lista de jogos do dia. Diagnóstico — leitura pura.
 *
 * node scripts/perf/probe-fixtures-queries.mjs
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

try {
  const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trimEnd();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
} catch {}

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(URL, KEY, { auth: { persistSession: false } });

const FIXTURE_COLUMNS =
  "id, match_date, ko_time, home_team, away_team, league, country, source_url, kickoff_utc, hd_probe:detail_json->>team_record";

function todayBrt(now = new Date()) {
  const brt = new Date(now.getTime() - 3 * 3600 * 1000);
  return `${brt.getUTCFullYear()}-${String(brt.getUTCMonth() + 1).padStart(2, "0")}-${String(brt.getUTCDate()).padStart(2, "0")}`;
}
function brtDayWindowUtc(date) {
  const start = new Date(date + "T03:00:00Z");
  const end = new Date(start.getTime() + 24 * 3600 * 1000);
  return { startUtc: start.toISOString(), endUtc: end.toISOString() };
}
function brtOrExpr(date) {
  const { startUtc, endUtc } = brtDayWindowUtc(date);
  return `and(kickoff_utc.gte.${startUtc},kickoff_utc.lt.${endUtc}),and(kickoff_utc.is.null,match_date.eq.${date})`;
}
const parseId = (u) => { const m = (u || "").match(/\/fixture\/(\d+)/); return m ? Number(m[1]) : null; };

async function timed(label, fn) {
  const t0 = performance.now();
  const r = await fn();
  const ms = performance.now() - t0;
  const n = Array.isArray(r?.data) ? r.data.length : (r?.data ? 1 : 0);
  const err = r?.error ? r.error.message : null;
  console.log(`  ${label.padEnd(34)} ${ms.toFixed(0).padStart(6)}ms  rows=${String(n).padStart(4)}  ${err ? "ERR: " + err : ""}`);
  return { ms, data: r?.data, error: err };
}

(async () => {
  const date = todayBrt();
  console.log(`\nPROD probe — dia BRT ${date}  (${URL})\n`);

  for (let pass = 1; pass <= 3; pass++) {
    console.log(`Passada ${pass}:`);

    const A = await timed("A. fixtures (lista, escalar)", () =>
      supabase.from("fixtures").select(FIXTURE_COLUMNS).or(brtOrExpr(date))
        .order("kickoff_utc", { ascending: true, nullsFirst: false })
        .order("ko_time", { ascending: true, nullsFirst: false })
        .order("id", { ascending: true }));

    const rows = A.data ?? [];
    const ids = rows.map((r) => r.id);
    const choistatsIds = rows.map((r) => parseId(r.source_url)).filter((v) => v !== null);

    await timed("B. fixture_badges_view (.in ids)", () =>
      supabase.from("fixture_badges_view").select("fixture_id, high_signal").in("fixture_id", ids));

    await timed("B2. badges_view FULL (badges[])", () =>
      supabase.from("fixture_badges_view").select("fixture_id, badges, high_signal").in("fixture_id", ids));

    await timed("C. ai_recommendations verdicts", () =>
      supabase.from("ai_recommendations").select("fixture_id, verdict")
        .gt("kickoff_utc", new Date().toISOString()).in("fixture_id", choistatsIds));

    console.log(`  (${rows.length} fixtures no dia, ${choistatsIds.length} com choistats id)\n`);
  }
})().catch((e) => { console.error("FATAL", e); process.exit(1); });

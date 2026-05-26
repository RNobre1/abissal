#!/usr/bin/env tsx
/**
 * snapshot-api-football.ts — Captura schemas via introspecção live.
 *
 * Por que: a documentação SPA da API-Football está atrás de Cloudflare
 * challenge e não tem OpenAPI público. Solução pragmática: dumpar samples
 * curados de cada endpoint relevante e detectar breaking changes via SHA256.
 *
 * Custo por run: ~12 requests (cada endpoint 1x). Cron semanal = 12 reqs/sem
 * do orçamento 700/sem (100/dia × 7). Folga total.
 *
 * Output: `docs/external-apis/api-football/samples/YYYY-MM-DD/*.json` +
 * `HASHES.txt` com SHA256 por arquivo. Se hash mudou vs anterior, diff
 * comparativo via git imprime no console.
 *
 * Usage:
 *   API_FOOTBALL_KEY=... pnpm exec tsx scripts/external-apis/snapshot-api-football.ts
 *   API_FOOTBALL_KEY=... pnpm exec tsx scripts/external-apis/snapshot-api-football.ts --compare 2026-05-19
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const BASE_URL = process.env.API_FOOTBALL_BASE_URL ?? "https://v3.football.api-sports.io";
const KEY = process.env.API_FOOTBALL_KEY;

if (!KEY) {
  console.error("Missing API_FOOTBALL_KEY env");
  process.exit(1);
}

// Endpoints curados — cobrem schema de cada recurso usado pelo abissal.
// Parâmetros são "estáveis" (Brasileirão / Libertadores / fixture conhecido).
type SnapshotJob = {
  filename: string;
  path: string;
  description: string;
  optional?: boolean; // ignora erros se opcional
};

const TODAY_BRT = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);

const JOBS: SnapshotJob[] = [
  {
    filename: "status.json",
    path: "/status",
    description: "Plan / quota / subscription — schema raiz da conta",
  },
  {
    filename: "timezone.json",
    path: "/timezone",
    description: "Lista de timezones aceitos",
  },
  {
    filename: "leagues-libertadores.json",
    path: "/leagues?id=13",
    description: "Schema de league + season — Copa Libertadores (id=13)",
  },
  {
    filename: "leagues-brasileirao-a.json",
    path: "/leagues?id=71",
    description: "Brasileirão Série A (id=71)",
  },
  {
    filename: "fixtures-today.json",
    path: `/fixtures?date=${TODAY_BRT}`,
    description: "Lista de fixtures por data — schema de fixture stub",
  },
  {
    filename: "fixtures-statistics-finished.json",
    path: "/fixtures/statistics?fixture=215662",
    description: "Statistics pós-jogo (corner kicks, yellow cards, sot, etc) — fixture finalizada conhecida",
  },
  {
    filename: "fixtures-events.json",
    path: "/fixtures/events?fixture=215662",
    description: "Eventos do jogo (gols, cards, subs)",
    optional: true,
  },
  {
    filename: "fixtures-lineups.json",
    path: "/fixtures/lineups?fixture=215662",
    description: "Escalações + formação",
    optional: true,
  },
  {
    filename: "fixtures-headtohead.json",
    path: "/fixtures/headtohead?h2h=33-34",
    description: "H2H entre 2 times (33 vs 34 = Man Utd vs Newcastle)",
    optional: true,
  },
  {
    filename: "odds.json",
    path: "/odds?fixture=1397284",
    description: "Pré-jogo odds multi-bookmaker — usado pela Wave O2 futura",
    optional: true,
  },
  {
    filename: "teams-libertadores.json",
    path: "/teams?league=13&season=2025",
    description: "Times de uma liga + season",
    optional: true,
  },
  {
    filename: "standings.json",
    path: "/standings?league=71&season=2025",
    description: "Tabela de classificação — Brasileirão A",
    optional: true,
  },
];

async function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

async function fetchEndpoint(path: string): Promise<unknown> {
  // Free tier limit: ~10 req/minute. Throttle 6.5s entre requests pra ficar
  // confortável dentro da janela (10 req / 60s).
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    headers: { "x-apisports-key": KEY! },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${url}`);
  }
  const body = await res.json();
  // Sanitização: remove account info da raiz (email, names)
  if ((body as Record<string, unknown>).response) {
    const response = (body as { response: unknown }).response as Record<string, unknown>;
    if (response.account) {
      response.account = { firstname: "<redacted>", lastname: "<redacted>", email: "<redacted>" };
    }
  }
  return body;
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

async function main(): Promise<void> {
  const argDate = process.argv[2]?.startsWith("--compare=")
    ? process.argv[2].slice("--compare=".length)
    : null;

  const baseDir = join(process.cwd(), "docs", "external-apis", "api-football", "samples");
  const today = new Date().toISOString().slice(0, 10);
  const outDir = join(baseDir, today);
  mkdirSync(outDir, { recursive: true });

  const hashLines: string[] = [];
  let success = 0;
  let failed = 0;

  for (const [i, job] of JOBS.entries()) {
    process.stdout.write(`▶ ${job.filename}... `);
    if (i > 0) await sleep(6500); // throttle 6.5s — free tier limit 10 req/min
    try {
      const body = await fetchEndpoint(job.path);
      const json = JSON.stringify(body, null, 2);
      writeFileSync(join(outDir, job.filename), json);
      const hash = sha256(json);
      hashLines.push(`${hash}  ${job.filename}`);
      console.log("OK");
      success++;
    } catch (err) {
      const e = err as Error;
      if (job.optional) {
        console.log(`SKIP (${e.message})`);
      } else {
        console.log(`FAIL (${e.message})`);
        failed++;
      }
    }
  }

  writeFileSync(join(outDir, "HASHES.txt"), hashLines.join("\n") + "\n");

  // Compare with previous snapshot
  const prevDate = argDate ?? findPreviousSnapshotDate(baseDir, today);
  if (prevDate) {
    console.log(`\nComparing with ${prevDate}:`);
    const prevHashes = readHashes(join(baseDir, prevDate, "HASHES.txt"));
    const curHashes = readHashes(join(outDir, "HASHES.txt"));
    const changed: string[] = [];
    const added: string[] = [];
    const removed: string[] = [];
    for (const [file, h] of Object.entries(curHashes)) {
      if (!(file in prevHashes)) added.push(file);
      else if (prevHashes[file] !== h) changed.push(file);
    }
    for (const file of Object.keys(prevHashes)) {
      if (!(file in curHashes)) removed.push(file);
    }
    if (!changed.length && !added.length && !removed.length) {
      console.log("  no schema changes detected");
    } else {
      if (added.length) console.log(`  added:   ${added.join(", ")}`);
      if (changed.length) console.log(`  changed: ${changed.join(", ")}`);
      if (removed.length) console.log(`  removed: ${removed.join(", ")}`);
      console.log(`\n  diff dos JSON: git diff -- docs/external-apis/api-football/samples/${prevDate}/ docs/external-apis/api-football/samples/${today}/`);
    }
  } else {
    console.log("\nFirst snapshot — no previous to compare.");
  }

  console.log(`\n${success}/${JOBS.length} endpoints capturados (${failed} falhas obrigatórias)`);
  if (failed > 0) process.exit(1);
}

function findPreviousSnapshotDate(baseDir: string, today: string): string | null {
  if (!existsSync(baseDir)) return null;
  const dirs = readdirSync(baseDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== today && /^\d{4}-\d{2}-\d{2}$/.test(d.name))
    .map((d) => d.name)
    .sort()
    .reverse();
  return dirs[0] ?? null;
}

function readHashes(file: string): Record<string, string> {
  if (!existsSync(file)) return {};
  const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
  const out: Record<string, string> = {};
  for (const line of lines) {
    const [hash, filename] = line.split(/\s{2,}/);
    if (hash && filename) out[filename] = hash;
  }
  return out;
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * scripts/perf/measure-prod.mjs
 *
 * Mede Web Vitals + timing por rota contra PRODUÇÃO (abissal.rnobre.dev),
 * logado com o usuário E2E (leitura pura, RLS-isolado). Diagnóstico — NÃO é
 * código de produção, NÃO escreve nada na banca.
 *
 * Roda: node scripts/perf/measure-prod.mjs   (do diretório do repo)
 * Env:  E2E_USER_EMAIL / E2E_USER_PASSWORD (lidos do .env.local).
 *       PERF_BASE_URL (default https://abissal.rnobre.dev), PERF_ITER (default 3).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, devices } from "@playwright/test";

// --- carrega .env.local (mesma lógica do playwright.config.ts) ---
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

const BASE = process.env.PERF_BASE_URL ?? "https://abissal.rnobre.dev";
const ITER = Number(process.env.PERF_ITER ?? 3);
const EMAIL = process.env.E2E_USER_EMAIL, PASS = process.env.E2E_USER_PASSWORD;
if (!EMAIL || !PASS) { console.error("E2E_USER_EMAIL/PASSWORD ausentes no .env.local"); process.exit(1); }

const S23FE = {
  userAgent: "Mozilla/5.0 (Linux; Android 14; SM-S711B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
  viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true,
};

// Observa Web Vitals desde antes do load.
const INIT = `
window.__v = { lcp: 0, cls: 0, fcp: 0, tbt: 0 };
try {
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__v.lcp = e.startTime || e.renderTime || window.__v.lcp; })
    .observe({ type: "largest-contentful-paint", buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__v.cls += e.value; })
    .observe({ type: "layout-shift", buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === "first-contentful-paint") window.__v.fcp = e.startTime; })
    .observe({ type: "paint", buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__v.tbt += Math.max(0, e.duration - 50); })
    .observe({ type: "longtask", buffered: true });
} catch (e) {}
`;

const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const r0 = (n) => Math.round(n);

async function login(ctx) {
  const page = await ctx.newPage();
  await page.goto(BASE + "/login", { waitUntil: "load", timeout: 30000 });
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASS);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => new URL(u).pathname === "/", { timeout: 20000 });
  await page.close();
}

async function measure(ctx, path) {
  const page = await ctx.newPage();
  await page.addInitScript(INIT);
  let res = null;
  try { res = await page.goto(BASE + path, { waitUntil: "load", timeout: 30000 }); }
  catch (e) { await page.close(); return { error: e.message.split("\n")[0] }; }
  await page.waitForTimeout(2200); // deixa LCP/CLS assentarem
  const data = await page.evaluate(() => {
    const n = performance.getEntriesByType("navigation")[0] || {};
    const res = performance.getEntriesByType("resource");
    const js = res.filter((r) => /\.js(\?|$)/.test(r.name));
    const jsBytes = js.reduce((s, r) => s + (r.transferSize || 0), 0);
    return {
      ttfb: n.responseStart || 0,
      dcl: n.domContentLoadedEventEnd || 0,
      load: n.loadEventEnd || 0,
      reqs: res.length,
      jsCount: js.length,
      jsKB: Math.round(jsBytes / 1024),
      ...window.__v,
    };
  });
  data.status = res ? res.status() : null;
  await page.close();
  return data;
}

async function apiLatency(ctx, n = 3) {
  const today = new Date().toISOString().slice(0, 10);
  const out = [];
  for (let i = 0; i < n; i++) {
    const t0 = Date.now();
    const r = await ctx.request.get(`${BASE}/api/fixtures?date=${today}`, { timeout: 30000 });
    const ms = Date.now() - t0;
    out.push({ ms, status: r.status(), len: (await r.body()).length });
  }
  return out;
}

(async () => {
  const browser = await chromium.launch();
  let fixtureId = null;
  const results = {};

  for (const [devName, dev] of [["mobile-s23fe", S23FE], ["desktop", devices["Desktop Chrome"]]]) {
    const ctx = await browser.newContext({ ...dev });
    await login(ctx);

    if (!fixtureId) {
      const p = await ctx.newPage();
      await p.goto(BASE + "/fixtures", { waitUntil: "load", timeout: 30000 });
      const href = await p.locator('a[href^="/fixtures/"]').first().getAttribute("href").catch(() => null);
      if (href) fixtureId = href.split("/fixtures/")[1].split(/[/?#]/)[0];
      await p.close();
    }

    const routes = [
      ["home", "/"],
      ["fixtures (lista)", "/fixtures"],
      ["calibracao", "/calibracao"],
      ["banca", "/banca"],
    ];
    if (fixtureId) {
      routes.push([`fixture detalhe (${fixtureId})`, `/fixtures/${fixtureId}`]);
      routes.push([`fixture stats`, `/fixtures/${fixtureId}/stats`]);
    }

    results[devName] = { routes: {}, api: null };
    for (const [key, path] of routes) {
      const runs = [];
      for (let i = 0; i < ITER; i++) runs.push(await measure(ctx, path));
      results[devName].routes[key] = runs;
      const ok = runs.filter((r) => !r.error);
      const lcp = ok.map((r) => r.lcp), ttfb = ok.map((r) => r.ttfb), load = ok.map((r) => r.load);
      console.error(`[${devName}] ${key.padEnd(26)} LCP med=${ok.length ? r0(median(lcp)) : "ERR"}ms  TTFB med=${ok.length ? r0(median(ttfb)) : "-"}ms  load med=${ok.length ? r0(median(load)) : "-"}ms`);
    }
    results[devName].api = await apiLatency(ctx, 3);
    await ctx.close();
  }
  await browser.close();

  // --- relatório markdown ---
  const fmtRoute = (runs) => {
    const ok = runs.filter((r) => !r.error);
    if (!ok.length) return `erro: ${runs[0]?.error ?? "?"}`;
    const col = (k) => ok.map((r) => r[k]);
    const cold = ok[0]; // 1ª iteração = potencialmente fria
    return {
      lcp_med: r0(median(col("lcp"))), lcp_cold: r0(cold.lcp),
      ttfb_med: r0(median(col("ttfb"))), ttfb_cold: r0(cold.ttfb),
      load_med: r0(median(col("load"))),
      cls: +median(col("cls")).toFixed(3), tbt: r0(median(col("tbt"))),
      jsKB: cold.jsKB, reqs: cold.reqs, status: cold.status,
    };
  };

  console.log("\n\n############ RELATÓRIO ############");
  for (const dev of Object.keys(results)) {
    console.log(`\n## ${dev}\n`);
    console.log("| rota | LCP med | LCP frio | TTFB med | load med | CLS | TBT | JS KB | reqs | http |");
    console.log("|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|");
    for (const [key, runs] of Object.entries(results[dev].routes)) {
      const f = fmtRoute(runs);
      if (typeof f === "string") { console.log(`| ${key} | ${f} |`); continue; }
      console.log(`| ${key} | ${f.lcp_med} | ${f.lcp_cold} | ${f.ttfb_med} | ${f.load_med} | ${f.cls} | ${f.tbt} | ${f.jsKB} | ${f.reqs} | ${f.status} |`);
    }
    const api = results[dev].api;
    console.log(`\n\`/api/fixtures?date=hoje\`: ${api.map((a) => `${a.ms}ms(${a.status},${(a.len / 1024).toFixed(0)}KB)`).join(" · ")}`);
  }
  console.log("\n(LCP/TTFB/load em ms · 1ª iteração = potencialmente fria · JS KB = transferido same-origin)");
})().catch((e) => { console.error("FATAL", e); process.exit(1); });

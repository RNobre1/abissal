#!/usr/bin/env tsx
/**
 * scripts/telegram/send-reco-alerts.ts
 *
 * Wave 1 — alerta no Telegram com TODAS as recos `verdict=bet` que a IA-2 criou
 * hoje (qualquer confiança). Roda no `ai-reco.yml` logo após o batch.
 *
 * Política (2026-05-29): NÃO filtra por edge/confiança. A calibração mostrou que
 * a IA acerta mais em confiança média/baixa (ROI +12,6%/+29,3%) que alta (−25%) —
 * filtrar esconderia as boas. O alerta mostra a confiança como contexto.
 *
 * Env: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, NEXT_PUBLIC_SUPABASE_URL,
 *      SUPABASE_SERVICE_ROLE_KEY. Faltando qualquer uma ⇒ skip gracioso (exit 0).
 */
import { createClient } from "@supabase/supabase-js";
import { formatRecoAlert, type RecoBet } from "../../lib/telegram/reco-alert";
import { sendTelegramMessage } from "../../lib/telegram/client";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
  console.error("[reco-alert] TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID missing — skipping");
  process.exit(0);
}
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("[reco-alert] Supabase env missing — skipping");
  process.exit(0);
}

/** Início do dia BRT (UTC-3 fixo) como ISO UTC + rótulo dd/mm. */
function startOfTodayBrt(): { startIso: string; label: string } {
  const now = new Date();
  const brt = new Date(now.getTime() - 3 * 3600 * 1000);
  const y = brt.getUTCFullYear();
  const m = brt.getUTCMonth();
  const d = brt.getUTCDate();
  // 00:00 BRT === 03:00 UTC do mesmo dia (BRT está 3h atrás do UTC).
  const startUtc = new Date(Date.UTC(y, m, d, 3, 0, 0));
  const label = `${String(d).padStart(2, "0")}/${String(m + 1).padStart(2, "0")}`;
  return { startIso: startUtc.toISOString(), label };
}

async function main(): Promise<void> {
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  const { startIso, label } = startOfTodayBrt();

  // Apostas que a IA viu valor hoje (qualquer confiança), melhor edge primeiro.
  const { data: betRows, error: betErr } = await supabase
    .from("ai_recommendations")
    .select("home_team, away_team, league, market, side, edge_pct, confidence, units_final, odd_captured")
    .eq("verdict", "bet")
    .gte("created_at", startIso)
    .order("edge_pct", { ascending: false });

  if (betErr) {
    console.error("[reco-alert] bets query failed:", betErr.message);
    process.exit(0); // não-fatal
  }

  // Contagem de skips do dia (contexto no rodapé).
  const { count: skipCount } = await supabase
    .from("ai_recommendations")
    .select("id", { count: "exact", head: true })
    .eq("verdict", "skip")
    .gte("created_at", startIso);

  const bets: RecoBet[] = (betRows ?? []).map((r) => ({
    homeTeam: r.home_team,
    awayTeam: r.away_team,
    league: r.league,
    market: r.market,
    side: r.side,
    edgePct: r.edge_pct,
    confidence: r.confidence,
    units: r.units_final,
    oddCaptured: r.odd_captured,
  }));

  const message = formatRecoAlert({ date: label, bets, skipCount: skipCount ?? 0 });

  if (!message) {
    console.log(`[reco-alert] nenhuma aposta hoje (${label}) — sem alerta (${skipCount ?? 0} skips).`);
    return;
  }

  // Preview local sem enviar (útil pra inspecionar o formato; também contorna a
  // instabilidade IPv6/route do fetch do Node nesta rede — ver B6).
  if (process.env.TELEGRAM_ALERT_DRY_RUN) {
    console.log(message);
    return;
  }

  const res = await sendTelegramMessage({
    token: TELEGRAM_BOT_TOKEN!,
    chatId: TELEGRAM_CHAT_ID!,
    text: message,
    parseMode: "HTML",
  });

  if (!res.ok) {
    console.error("[reco-alert] envio falhou:", res.error);
    process.exit(0); // não-fatal: não derruba o workflow por causa de alerta
  }
  console.log(`[reco-alert] enviado: ${bets.length} aposta(s) (${label}).`);
}

main().catch((err) => {
  console.error("[reco-alert] erro inesperado (não-fatal):", err instanceof Error ? err.message : err);
  process.exit(0);
});

#!/usr/bin/env tsx
/**
 * scripts/telegram/send-closure.ts
 *
 * Nightly closure notification script for Telegram.
 * Runs at 23:00 BRT (02:00 UTC) via GitHub Actions cron.
 *
 * Usage:
 *   TELEGRAM_BOT_TOKEN=<token> TELEGRAM_CHAT_ID=<chatId> \
 *   SUPABASE_URL=<url> SUPABASE_SERVICE_ROLE_KEY=<key> \
 *   tsx scripts/telegram/send-closure.ts
 *
 * Env vars:
 *   TELEGRAM_BOT_TOKEN       — Telegram Bot API token (via @BotFather)
 *   TELEGRAM_CHAT_ID         — Pilot's private chat ID (or group chat ID)
 *   NEXT_PUBLIC_SUPABASE_URL — Supabase project URL (reuse existing var)
 *   SUPABASE_SERVICE_ROLE_KEY — Service role key for server-side queries
 *
 * Exit codes:
 *   0 — message sent successfully
 *   1 — missing env vars or API error (non-fatal in prod: logged, not retried)
 */

import { createClient } from "@supabase/supabase-js";
import { formatClosureMessage, buildDailySummary } from "../../lib/telegram/closure-message";

// ---------------------------------------------------------------------------
// Env validation
// ---------------------------------------------------------------------------

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
  console.error(
    "[telegram-closure] TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID missing — skipping",
  );
  process.exit(0); // graceful: no token = no message, not a hard failure
}

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("[telegram-closure] Supabase env missing — skipping");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// BRT day window (UTC-3 fixed — Brazil abolished DST in 2019)
// ---------------------------------------------------------------------------

function brtDayWindow(): { start: string; end: string; label: string } {
  const now = new Date();
  // BRT = UTC - 3h
  const brtNow = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const yyyy = brtNow.getUTCFullYear();
  const mm = String(brtNow.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(brtNow.getUTCDate()).padStart(2, "0");
  const label = `${dd}/${mm}`;

  // Day starts at BRT 00:00 = UTC 03:00
  const start = `${yyyy}-${mm}-${dd}T03:00:00Z`;
  // Day ends at BRT 23:59:59 = UTC 02:59:59 next day
  const nextDay = new Date(Date.UTC(yyyy, brtNow.getUTCMonth(), brtNow.getUTCDate() + 1));
  const yyyyN = nextDay.getUTCFullYear();
  const mmN = String(nextDay.getUTCMonth() + 1).padStart(2, "0");
  const ddN = String(nextDay.getUTCDate()).padStart(2, "0");
  const end = `${yyyyN}-${mmN}-${ddN}T02:59:59Z`;

  return { start, end, label };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  const window = brtDayWindow();

  // Fetch bets resolved today (BRT) — we use resolved_at UTC window
  const { data: betsData, error: betsError } = await supabase
    .from("bets")
    .select("status, pl_units:actual_return, total_stake")
    .gte("resolved_at", window.start)
    .lte("resolved_at", window.end)
    .in("status", ["won", "lost", "half_won", "half_lost", "void", "cashed_out"]);

  if (betsError) {
    console.error("[telegram-closure] bets query failed:", betsError.message);
  }

  const rawBets = betsData ?? [];

  // Compute pl_units from actual_return - total_stake
  const bets = rawBets.map((b) => ({
    status: b.status as string,
    pl_units:
      b.pl_units != null && b.total_stake != null
        ? Number(b.pl_units) - Number(b.total_stake)
        : 0,
  }));

  // Fetch AI recommendations resolved today
  const { data: recosData, error: recosError } = await supabase
    .from("ai_recommendations")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .select("resolved_at, outcome, side" as any)
    .gte("resolved_at", window.start)
    .lte("resolved_at", window.end);

  if (recosError) {
    console.error("[telegram-closure] recos query failed:", recosError.message);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawRecos = (recosData ?? []) as any[];
  const recos = rawRecos.map((r) => ({
    resolved: r.resolved_at != null,
    correct: r.outcome === "correct" || r.outcome === "won",
  }));

  const summary = buildDailySummary({ bets, recos });

  const message = formatClosureMessage({
    ...summary,
    clvPct: null, // CLV not yet tracked; can be wired when available
    date: window.label,
  });

  // Send to Telegram
  const telegramUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const res = await fetch(telegramUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: "HTML",
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error("[telegram-closure] Telegram API error:", res.status, body);
    process.exit(1);
  }

  console.log("[telegram-closure] sent:", message);
}

main().catch((err) => {
  console.error("[telegram-closure] fatal:", err);
  process.exit(1);
});

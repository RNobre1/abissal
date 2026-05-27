import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/telemetry -- batched UI event insert.
 *
 * Fire-and-forget: always returns 204 so the client never retries on DB
 * failures (prevents event storms). DB errors are logged server-side only.
 *
 * Rate limits:
 *   - 1000 events/min per session_id (DB-backed sliding window).
 *   - 200 requests/min per IP (in-memory map, resets per minute window).
 *     IP read from cf-connecting-ip -> x-forwarded-for -> "unknown".
 *
 * Payload constraints (tightened 2026-05-27):
 *   - events: max 50 per batch.
 *   - payload per event: JSON size < 2048 bytes.
 *
 * Auth: none required. RLS policy allows anonymous inserts.
 */

const eventSchema = z.object({
  event_type: z.string().min(1),
  session_id: z.string().min(1),
  fixture_id: z.number().int().positive().optional(),
  ai_recommendation_id: z.number().int().positive().optional(),
  panel_id: z.string().optional(),
  elapsed_ms: z.number().int().nonnegative().optional(),
  payload: z
    .record(z.unknown())
    .refine(
      (v) => JSON.stringify(v).length < 2048,
      "payload too large (max 2048 bytes)",
    )
    .optional(),
});

const bodySchema = z.object({
  events: z.array(eventSchema).min(1).max(50),
});

const RATE_LIMIT = 1000;

// In-memory IP rate limiter (200 requests / min / IP)
const IP_RATE_LIMIT = 200;
const IP_WINDOW_MS = 60_000;

interface IpEntry {
  count: number;
  resetAt: number;
}

const ipMap = new Map<string, IpEntry>();

function checkIpRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = ipMap.get(ip);
  if (!entry || now >= entry.resetAt) {
    ipMap.set(ip, { count: 1, resetAt: now + IP_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > IP_RATE_LIMIT;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = any;

export async function POST(request: Request): Promise<Response> {
  // 1. Parse + validate body
  let parsed: z.infer<typeof bodySchema>;
  try {
    const raw = await request.json();
    parsed = bodySchema.parse(raw);
  } catch (err) {
    return NextResponse.json(
      { error: "invalid request body", details: String(err) },
      { status: 400 },
    );
  }

  const { events } = parsed;

  // 2a. IP rate limit (in-memory, 200 req/min/IP)
  const clientIp =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for") ??
    "unknown";

  if (checkIpRateLimit(clientIp)) {
    return NextResponse.json({ error: "rate limit exceeded" }, { status: 429 });
  }

  // 2b. Session rate-limit check (per session_id, sliding 1-min window in DB)
  const sessionIds = [...new Set(events.map((e) => e.session_id))];

  try {
    const supabase = createAdminClient() as AnySupabase;
    const oneMinAgo = new Date(Date.now() - 60_000).toISOString();

    for (const sid of sessionIds) {
      const { count, error } = await supabase
        .from("ui_telemetry")
        .select("id", { count: "exact", head: true })
        .eq("session_id", sid)
        .gte("created_at", oneMinAgo);

      if (!error && typeof count === "number" && count > RATE_LIMIT) {
        return NextResponse.json(
          { error: "rate limit exceeded" },
          { status: 429 },
        );
      }
    }
  } catch {
    // Rate-limit check failed -- allow insert (fail open, not closed)
  }

  // 3. Batch insert
  const rows = events.map((e) => ({
    event_type: e.event_type,
    session_id: e.session_id,
    fixture_id: e.fixture_id ?? null,
    ai_recommendation_id: e.ai_recommendation_id ?? null,
    panel_id: e.panel_id ?? null,
    elapsed_ms: e.elapsed_ms ?? null,
    payload: e.payload ?? null,
  }));

  // Await insert antes de retornar 204.
  // Em Cloudflare Workers o handler mata promises pendentes -- await e necessario.
  try {
    const supabase = createAdminClient() as AnySupabase;
    const { error } = await supabase.from("ui_telemetry").insert(rows);
    if (error) {
      console.error("[telemetry] insert failed:", error.message);
    }
  } catch (err) {
    console.error("[telemetry] unexpected error:", err);
  }

  return new Response(null, { status: 204 });
}

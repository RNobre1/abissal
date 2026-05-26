import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/telemetry — batched UI event insert.
 *
 * Fire-and-forget: always returns 204 so the client never retries on DB
 * failures (prevents event storms). DB errors are logged server-side only.
 *
 * Rate limit: 1000 events/min per session_id. Exceeding returns 429 without
 * inserting. The check uses a count query on `ui_telemetry` — if the table
 * doesn't exist yet (migration not applied) the check is skipped safely.
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
  payload: z.record(z.unknown()).optional(),
});

const bodySchema = z.object({
  events: z.array(eventSchema).min(1),
});

const RATE_LIMIT = 1000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = any;

export async function POST(request: Request): Promise<Response> {
  // ─────────────────────────────────────────────────────────────────────────
  // 1. Parse + validate body
  // ─────────────────────────────────────────────────────────────────────────
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

  // ─────────────────────────────────────────────────────────────────────────
  // 2. Rate-limit check (per session_id, sliding 1-min window)
  // ─────────────────────────────────────────────────────────────────────────
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
    // Rate-limit check failed — allow insert (fail open, not closed)
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 3. Batch insert — fire-and-forget (always 204 to client)
  // ─────────────────────────────────────────────────────────────────────────
  const rows = events.map((e) => ({
    event_type: e.event_type,
    session_id: e.session_id,
    fixture_id: e.fixture_id ?? null,
    ai_recommendation_id: e.ai_recommendation_id ?? null,
    panel_id: e.panel_id ?? null,
    elapsed_ms: e.elapsed_ms ?? null,
    payload: e.payload ?? null,
  }));

  // Do NOT await — fire-and-forget
  try {
    const supabase = createAdminClient() as AnySupabase;
    supabase
      .from("ui_telemetry")
      .insert(rows)
      .then(
        ({ error }: { error: { message: string } | null }) => {
          if (error) {
            console.error("[telemetry] insert failed:", error.message);
          }
        },
        (err: unknown) => {
          console.error("[telemetry] insert error:", err);
        },
      );
  } catch (err) {
    console.error("[telemetry] unexpected error:", err);
  }

  return new Response(null, { status: 204 });
}

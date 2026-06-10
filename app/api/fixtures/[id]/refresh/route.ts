import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  fetchFixtureDetail,
  UpstreamError,
} from "@/lib/fixtures/choistats-api";

/**
 * POST /api/fixtures/[id]/refresh
 *
 * Re-scrapes the choistats widgets for `id`, merges them into a single JSON
 * blob, and UPDATEs `fixtures.detail_json` for that row. Used by the UI
 * "Refresh details" button so the user can force a fresh pull instead of
 * waiting for the next daily scrape.
 *
 * Auth: requires an authenticated Supabase session (401 otherwise). The
 * admin client is only used after the session gate passes.
 *
 * Rate-limit: 429 if the fixture was refreshed within the last 60 seconds
 * (defence-in-depth — prevents hammering choistats with the project token).
 *
 * Responses:
 *   200 { has_detail: true, fixture_id }   on success
 *   400                                    if id is not a positive integer
 *   401                                    if not authenticated
 *   404                                    if no fixtures row matches id
 *   429 { error, retry_after_s }           if refreshed less than 60s ago
 *   500 { error: "ADAMCHOI_API_TOKEN..." } if the token is missing
 *   502 { error: "upstream choistats..." } if any widget request errors out
 */

/** Minimum seconds between consecutive refreshes for the same fixture. */
const REFRESH_COOLDOWN_S = 60;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = any;

export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  // ---------------------------------------------------------------------------
  // 1. Auth gate — only authenticated users may trigger upstream requests and
  //    service-role writes. Mirrors the pattern in /api/ai-reco/compute and
  //    /api/ai-reco/feedback.
  // ---------------------------------------------------------------------------
  try {
    const serverClient = (await createClient()) as AnySupabase;
    const { data: { user } = { user: null } } = await serverClient.auth.getUser();
    if (!user?.id) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id: rawId } = await ctx.params;

  // Validate the id param. Must be a strictly positive integer; we reject
  // "abc", "0", "-1", "1.5", etc.
  if (!/^\d+$/.test(rawId)) {
    return NextResponse.json({ error: "invalid fixture id" }, { status: 400 });
  }
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "invalid fixture id" }, { status: 400 });
  }

  // Token must be configured for the route to function.
  const token = env.ADAMCHOI_API_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "ADAMCHOI_API_TOKEN not configured" },
      { status: 500 },
    );
  }

  // The supabase-js generic types are tightened on Database; the fixtures
  // table is in a recent migration (0007/0010/0011) not yet reflected in
  // lib/supabase/types.ts. We cast the client to `any` narrowly so the route
  // stays buildable until the types are regenerated.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createAdminClient() as any;

  // Confirm the fixture exists before spending 6 upstream requests on it.
  // Also read scraped_at for the rate-limit check below.
  const { data: row, error: selectError } = await supabase
    .from("fixtures")
    .select("id, scraped_at")
    .eq("id", id)
    .maybeSingle();

  if (selectError) {
    return NextResponse.json(
      { error: "database error", detail: selectError.message },
      { status: 500 },
    );
  }
  if (!row) {
    return NextResponse.json({ error: "fixture not found" }, { status: 404 });
  }

  // ---------------------------------------------------------------------------
  // Rate-limit gate — refuse if the fixture was scraped within the last 60s.
  // This prevents a logged-in user from hammering choistats accidentally and
  // burning the shared project token. Check happens BEFORE the fan-out.
  // ---------------------------------------------------------------------------
  if (row.scraped_at) {
    const lastScrapedMs = new Date(row.scraped_at as string).getTime();
    const elapsedS = (Date.now() - lastScrapedMs) / 1000;
    if (elapsedS < REFRESH_COOLDOWN_S) {
      const retryAfterS = Math.ceil(REFRESH_COOLDOWN_S - elapsedS);
      return NextResponse.json(
        {
          error: "refreshed too recently, please wait",
          retry_after_s: retryAfterS,
        },
        { status: 429 },
      );
    }
  }

  // Fan out to choistats.
  let detail;
  try {
    detail = await fetchFixtureDetail(id, { token });
  } catch (err) {
    if (err instanceof UpstreamError) {
      return NextResponse.json(
        { error: "upstream choistats failed" },
        { status: 502 },
      );
    }
    throw err;
  }

  // Persist. Service-role client bypasses RLS.
  const { error: updateError } = await supabase
    .from("fixtures")
    .update({
      detail_json: detail,
      scraped_at: new Date().toISOString(),
      status: "parsed",
    })
    .eq("id", id);

  if (updateError) {
    return NextResponse.json(
      { error: "database update failed", detail: updateError.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ has_detail: true, fixture_id: id }, { status: 200 });
}

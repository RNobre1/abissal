import { parseDateParam } from "@/lib/fixtures/time";
import { fixturesForBrtDay } from "@/lib/fixtures/repository";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/fixtures?date=today|tomorrow|YYYY-MM-DD
 *
 * Returns the fixtures table filtered by BRT calendar day. See
 * `lib/fixtures/repository.ts` for the filter & ordering logic, and
 * `lib/fixtures/time.ts` for the BRT-day window calculation.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const rawDate = url.searchParams.get("date");
  const date = parseDateParam(rawDate);

  if (!date) {
    return jsonResponse(
      {
        error:
          "Invalid or missing ?date — expected 'today', 'tomorrow' or 'YYYY-MM-DD'.",
      },
      400,
    );
  }

  try {
    const supabase = createAdminClient();
    const fixtures = await fixturesForBrtDay(date, supabase);
    return jsonResponse(fixtures, 200, {
      // Wave C perf: allow CDN/edge to cache fixture lists for 5 minutes
      // (scraper runs daily, so stale data within the BRT day is acceptable).
      // s-maxage=300: shared cache TTL; stale-while-revalidate=600: serve
      // stale while revalidating up to 10 minutes.
      "cache-control": "public, s-maxage=300, stale-while-revalidate=600",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "internal error";
    return jsonResponse({ error: message }, 500);
  }
}

function jsonResponse(
  body: unknown,
  status: number,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}

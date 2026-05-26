/**
 * Single source of truth for parsing the choistats numeric fixture id from a
 * `fixtures.source_url` string.
 *
 * Mirrors the Ruby producer verbatim: `%r{/fixture/(\d+)}` matches
 * `/fixture/<digits>` anywhere in the string and ignores any trailing slug.
 * Returns `null` when absent so callers can degrade gracefully.
 *
 * Previously duplicated in (at minimum):
 *   - lib/fixtures/repository.ts
 *   - lib/fixtures/simulation-repository.ts
 *   - app/(dashboard)/fixtures/[id]/page.tsx
 *   - app/api/ai-reco/compute/route.ts (inline regex, not named)
 */
export function parseChoistatsId(sourceUrl: string | null): number | null {
  if (!sourceUrl) return null;
  const m = sourceUrl.match(/\/fixture\/(\d+)/);
  return m ? Number(m[1]) : null;
}

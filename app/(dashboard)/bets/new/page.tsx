import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PlaceBetForm } from "./form";

export default async function NewBetPage() {
  const supabase = await createClient();

  const [housesResult, sportsResult, marketsResult, leaguesResult] =
    await Promise.all([
      supabase
        .from("houses")
        .select("id, name")
        .is("archived_at", null)
        .order("name"),
      supabase.from("sports").select("id, name").order("name"),
      supabase.from("markets").select("id, name").order("name"),
      supabase
        .from("bet_selections")
        .select("league")
        .not("league", "is", null)
        .order("league"),
    ]);

  const houses = housesResult.data ?? [];

  if (houses.length === 0) {
    redirect("/houses/new");
  }

  const sports = sportsResult.data ?? [];
  const markets = marketsResult.data ?? [];

  // Distinct leagues from existing bet_selections
  const leagueSet = new Set<string>();
  for (const row of leaguesResult.data ?? []) {
    if (row.league) leagueSet.add(row.league);
  }
  const leagues = Array.from(leagueSet).sort();

  const nowLocal = new Date();
  nowLocal.setMinutes(nowLocal.getMinutes() - nowLocal.getTimezoneOffset());
  const defaultIso = nowLocal.toISOString().slice(0, 16);

  return (
    <main id="main" tabIndex={-1} className="mx-auto w-full max-w-2xl flex-1 px-6 py-12 lg:px-12 lg:py-16">
      <header className="mb-10">
        <span className="label">apostas / nova</span>
        <h2 className="mt-2">nova aposta</h2>
      </header>

      <PlaceBetForm
        houses={houses.map((h) => ({ id: h.id, name: h.name }))}
        defaultPlacedAt={defaultIso}
        sports={sports}
        markets={markets}
        leagues={leagues}
      />
    </main>
  );
}

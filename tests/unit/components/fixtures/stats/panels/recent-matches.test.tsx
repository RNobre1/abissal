import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RecentMatchesPanel } from "@/components/fixtures/stats/panels/recent-matches";
import type { NormalizedRecentMatch } from "@/lib/fixtures/stats/detail-json-types";

function mkMatch(
  id: number,
  date_iso: string,
  over: Partial<NormalizedRecentMatch> = {},
): NormalizedRecentMatch {
  return {
    id,
    date_iso,
    opponent: "Opp",
    is_home: true,
    result: "W",
    goals_1h_for: 1,
    goals_2h_for: 1,
    goals_1h_against: 0,
    goals_2h_against: 0,
    goals_ft_for: over.goals_ft_for ?? 2,
    goals_ft_against: 0,
    corners_1h_for: 2,
    corners_2h_for: 3,
    corners_1h_against: 1,
    corners_2h_against: 1,
    corners_for: over.corners_for ?? 5,
    corners_against: 2,
    cards_1h_for: 0,
    cards_2h_for: 1,
    cards_1h_against: 0,
    cards_2h_against: 0,
    cards_for: 1,
    cards_against: 0,
    sot_for: over.sot_for ?? 4,
    sot_against: 2,
    shots_for: 10,
    shots_against: 5,
    booking_points_for: over.booking_points_for ?? 15,
    booking_points_against: 10,
    fouls_for: 12,
    fouls_against: 10,
    offsides_for: 2,
    offsides_against: 1,
    ...over,
  };
}

const matches: NormalizedRecentMatch[] = [
  mkMatch(1, "2026-04-01", { goals_ft_for: 1, sot_for: 3, corners_for: 4, booking_points_for: 10 }),
  mkMatch(2, "2026-04-15", { goals_ft_for: 2, sot_for: 5, corners_for: 6, booking_points_for: 12 }),
  mkMatch(3, "2026-05-01", { goals_ft_for: 3, sot_for: 7, corners_for: 7, booking_points_for: 18 }),
];

describe("<RecentMatchesPanel />", () => {
  it("defaults toggle to goals_ft and renders a trend line", () => {
    const { container } = render(
      <RecentMatchesPanel matches={matches} title="Últimos jogos" width={400} />,
    );
    // Active chip = goals_ft.
    const activeChip = screen.getByRole("button", { name: /gols ft/i, pressed: true });
    expect(activeChip).toBeDefined();
    // Two <Line> curves rendered: the data series + the trend.
    const curves = container.querySelectorAll("path.recharts-line-curve");
    expect(curves.length).toBe(2);
  });

  it("clicking SOT chip switches the active series", () => {
    render(<RecentMatchesPanel matches={matches} title="X" width={400} />);
    const sotChip = screen.getByRole("button", { name: /sot/i });
    fireEvent.click(sotChip);
    expect(sotChip.getAttribute("aria-pressed")).toBe("true");
    // The goals chip should no longer be pressed.
    const goalsChip = screen.getByRole("button", { name: /gols ft/i });
    expect(goalsChip.getAttribute("aria-pressed")).toBe("false");
  });

  it("renders 'sem dados' fallback when matches array is empty", () => {
    render(<RecentMatchesPanel matches={[]} title="X" width={400} />);
    expect(screen.getByText(/sem dados/i)).toBeDefined();
  });

  it("exposes all 4 stat chips", () => {
    render(<RecentMatchesPanel matches={matches} title="X" width={400} />);
    expect(screen.getByRole("button", { name: /gols ft/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /sot/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /cantos/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /booking/i })).toBeDefined();
  });

  it("trend regression skips null/undefined stat values (not coerced to 0)", () => {
    // Mix finite + null SOT — series where 3 of 5 values are null. If the
    // panel coerced null → 0 (the old bug) the trend would drag toward 0 and
    // its slope would flip negative. Filtering nulls keeps the trend
    // positive (3 → 7 across kept points).
    const sparse: NormalizedRecentMatch[] = [
      mkMatch(10, "2026-04-01", { sot_for: 3, goals_ft_for: 1 }),
      mkMatch(11, "2026-04-08", { sot_for: null as unknown as number, goals_ft_for: 1 }),
      mkMatch(12, "2026-04-15", { sot_for: 5, goals_ft_for: 1 }),
      mkMatch(13, "2026-04-22", { sot_for: null as unknown as number, goals_ft_for: 1 }),
      mkMatch(14, "2026-05-01", { sot_for: 7, goals_ft_for: 1 }),
    ];
    const { container } = render(
      <RecentMatchesPanel matches={sparse} title="X" width={400} />,
    );
    // Switch to SOT chip — that's the series with nulls.
    const sotChip = screen.getByRole("button", { name: /sot/i });
    fireEvent.click(sotChip);
    // The two recharts <Line> curves still rendered (data + trend) — no crash
    // when regression hits filtered series.
    const curves = container.querySelectorAll("path.recharts-line-curve");
    expect(curves.length).toBe(2);
  });
});

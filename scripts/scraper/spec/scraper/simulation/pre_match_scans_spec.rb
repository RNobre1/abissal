# frozen_string_literal: true

# TDD spec for the two new pre-match scalars:
#   - p_duplo_green / p_duplo_green_home / p_duplo_green_away  (f_plus/f_minus/f_either recursion on matrix)
#   - p_both_2corners_both_halves  (per-half corner samples)
#
# Written BEFORE the production code (Akita/XP TDD contract).

require_relative '../../../lib/scraper/simulation/monte_carlo'

RSpec.describe 'PreMatchScans — duplo-green + corners 2+/tempo' do
  # ──────────────────────────────────────────────────────────────────────────────
  # Helper: brute-force all interleavings of rh Home goals + ra Away goals,
  # counting which fraction ever reaches |diff| target.
  # Used to cross-validate the memoised recursive f_* functions.
  # ──────────────────────────────────────────────────────────────────────────────
  def enumerate_f_plus(rh, ra, start_diff = 0)
    return 1.0 if start_diff >= 2

    seq = (['H'] * rh) + (['A'] * ra)
    return 0.0 if seq.empty?

    perms = seq.permutation.to_a.uniq
    hits  = perms.count do |perm|
      diff = start_diff
      reached = false
      perm.each do |ev|
        diff += (ev == 'H' ? 1 : -1)
        reached = true if diff >= 2
      end
      reached
    end
    hits.to_f / perms.size
  end

  def enumerate_f_minus(rh, ra, start_diff = 0)
    return 1.0 if start_diff <= -2

    seq = (['H'] * rh) + (['A'] * ra)
    return 0.0 if seq.empty?

    perms = seq.permutation.to_a.uniq
    hits  = perms.count do |perm|
      diff = start_diff
      reached = false
      perm.each do |ev|
        diff += (ev == 'H' ? 1 : -1)
        reached = true if diff <= -2
      end
      reached
    end
    hits.to_f / perms.size
  end

  def enumerate_f_either(rh, ra, start_diff = 0)
    return 1.0 if start_diff >= 2 || start_diff <= -2

    seq = (['H'] * rh) + (['A'] * ra)
    return 0.0 if seq.empty?

    perms = seq.permutation.to_a.uniq
    hits  = perms.count do |perm|
      diff = start_diff
      reached = false
      perm.each do |ev|
        diff += (ev == 'H' ? 1 : -1)
        reached = true if diff >= 2 || diff <= -2
      end
      reached
    end
    hits.to_f / perms.size
  end

  let(:mc) { AdamStats::Scraper::Simulation::MonteCarlo }

  # ──────────────────────────────────────────────────────────────────────────────
  # f_plus / f_minus / f_either — unit tests against brute-force enumeration
  # ──────────────────────────────────────────────────────────────────────────────
  describe 'f_plus (P that home lead reaches ≥ +2 at some prefix)' do
    it 'returns 1.0 when start_diff already ≥ 2' do
      expect(mc.send(:f_plus, 0, 0, 2)).to be_within(1e-12).of(1.0)
      expect(mc.send(:f_plus, 3, 2, 3)).to be_within(1e-12).of(1.0)
    end

    it 'returns 0.0 when no goals remain and target not reached' do
      expect(mc.send(:f_plus, 0, 0, 1)).to be_within(1e-12).of(0.0)
      expect(mc.send(:f_plus, 0, 0, 0)).to be_within(1e-12).of(0.0)
      expect(mc.send(:f_plus, 0, 0, -5)).to be_within(1e-12).of(0.0)
    end

    it '(2,0,0) → 1.0 (home scores 2, always reaches +2)' do
      expect(mc.send(:f_plus, 2, 0, 0)).to be_within(1e-9).of(1.0)
    end

    it '(0,2,0) → 0.0 (only away scores, never reaches +2)' do
      expect(mc.send(:f_plus, 0, 2, 0)).to be_within(1e-9).of(0.0)
    end

    # Cross-validate with brute-force enumeration
    [
      [1, 1, 0],
      [2, 2, 0],
      [2, 3, 0],
      [3, 1, 0],
      [3, 2, 0],
      [1, 1, 1],
      [2, 2, 1],
      [1, 2, -1]
    ].each do |(rh, ra, diff)|
      it "f_plus(#{rh},#{ra},#{diff}) matches brute-force enumeration" do
        expected = enumerate_f_plus(rh, ra, diff)
        expect(mc.send(:f_plus, rh, ra, diff)).to be_within(1e-9).of(expected)
      end
    end
  end

  describe 'f_minus (P that away lead reaches ≥ +2 at some prefix)' do
    it 'returns 1.0 when start_diff already ≤ -2' do
      expect(mc.send(:f_minus, 0, 0, -2)).to be_within(1e-12).of(1.0)
      expect(mc.send(:f_minus, 1, 0, -3)).to be_within(1e-12).of(1.0)
    end

    it 'returns 0.0 when no goals remain and target not reached' do
      expect(mc.send(:f_minus, 0, 0, 0)).to be_within(1e-12).of(0.0)
      expect(mc.send(:f_minus, 0, 0, -1)).to be_within(1e-12).of(0.0)
    end

    it '(0,2,0) → 1.0 (away scores 2, always reaches -2)' do
      expect(mc.send(:f_minus, 0, 2, 0)).to be_within(1e-9).of(1.0)
    end

    it '(2,0,0) → 0.0 (only home scores, never reaches -2)' do
      expect(mc.send(:f_minus, 2, 0, 0)).to be_within(1e-9).of(0.0)
    end

    [
      [1, 1, 0],
      [2, 2, 0],
      [2, 3, 0],
      [3, 1, 0],
      [1, 1, -1],
      [2, 2, 1]
    ].each do |(rh, ra, diff)|
      it "f_minus(#{rh},#{ra},#{diff}) matches brute-force enumeration" do
        expected = enumerate_f_minus(rh, ra, diff)
        expect(mc.send(:f_minus, rh, ra, diff)).to be_within(1e-9).of(expected)
      end
    end
  end

  describe 'f_either (P that EITHER lead reaches ≥ ±2 at some prefix)' do
    it 'returns 1.0 when start_diff already ≥ 2 or ≤ -2' do
      expect(mc.send(:f_either, 0, 0, 2)).to be_within(1e-12).of(1.0)
      expect(mc.send(:f_either, 0, 0, -2)).to be_within(1e-12).of(1.0)
      expect(mc.send(:f_either, 2, 1, 3)).to be_within(1e-12).of(1.0)
    end

    it 'returns 0.0 when no goals remain and target not reached' do
      expect(mc.send(:f_either, 0, 0, 0)).to be_within(1e-12).of(0.0)
      expect(mc.send(:f_either, 0, 0, 1)).to be_within(1e-12).of(0.0)
    end

    it '(1,1,0) f_either ≥ f_plus AND f_either ≥ f_minus' do
      fe = mc.send(:f_either, 1, 1, 0)
      fp = mc.send(:f_plus,  1, 1, 0)
      fm = mc.send(:f_minus, 1, 1, 0)
      expect(fe).to be >= fp
      expect(fe).to be >= fm
    end

    [
      [1, 1, 0],
      [2, 2, 0],
      [2, 3, 0],
      [3, 2, 0],
      [1, 1, 1],
      [1, 1, -1],
      [2, 2, 1]
    ].each do |(rh, ra, diff)|
      it "f_either(#{rh},#{ra},#{diff}) matches brute-force enumeration" do
        expected = enumerate_f_either(rh, ra, diff)
        expect(mc.send(:f_either, rh, ra, diff)).to be_within(1e-9).of(expected)
      end
    end
  end

  # ──────────────────────────────────────────────────────────────────────────────
  # p_duplo_green_home / p_duplo_green_away / p_duplo_green — matrix integration
  # ──────────────────────────────────────────────────────────────────────────────
  describe 'duplo_green scalars computed from a deterministic matrix' do
    # Minimal 3×3 matrix (h=0..2, a=0..2) with known values.
    # Cell probabilities (must sum to 1 for a well-formed matrix).
    # h=0,a=0: 0.1  h=0,a=1: 0.1  h=0,a=2: 0.1
    # h=1,a=0: 0.1  h=1,a=1: 0.2  h=1,a=2: 0.1
    # h=2,a=0: 0.1  h=2,a=1: 0.1  h=2,a=2: 0.1
    let(:matrix) do
      [
        [0.1, 0.1, 0.1],
        [0.1, 0.2, 0.1],
        [0.1, 0.1, 0.1]
      ]
    end

    let(:result) { mc.send(:compute_duplo_green, matrix) }

    it 'returns a hash with p_duplo_green, p_duplo_green_home, p_duplo_green_away' do
      expect(result).to be_a(Hash)
      expect(result).to have_key(:p_duplo_green)
      expect(result).to have_key(:p_duplo_green_home)
      expect(result).to have_key(:p_duplo_green_away)
    end

    it 'all three scalars are in [0,1]' do
      expect(result[:p_duplo_green]).to be_between(0.0, 1.0)
      expect(result[:p_duplo_green_home]).to be_between(0.0, 1.0)
      expect(result[:p_duplo_green_away]).to be_between(0.0, 1.0)
    end

    it 'all three scalars are rounded to 4 decimal places' do
      result.each_value do |v|
        expect(v).to eq(v.round(4))
      end
    end

    it 'p_duplo_green_home is zero for cells where home wins (no duplo-green possible for draw/away)' do
      # p_duplo_green_home sums over h <= a (home NOT winning), weighted by f_plus
      # For the 3x3 matrix with symmetric layout most f_plus contributions come
      # from h<a cells. At minimum it must be ≥ 0.
      expect(result[:p_duplo_green_home]).to be >= 0.0
    end

    it 'p_duplo_green_away is zero for cells where away wins (no duplo-green possible for draw/home)' do
      expect(result[:p_duplo_green_away]).to be >= 0.0
    end

    it 'computes p_duplo_green_home manually for one cell (0-2 scoreline)' do
      # (h=0, a=2): home ≤ away, f_plus(0, 2, 0) = 0 (home can never reach +2)
      # → contribution = matrix[0][2] * f_plus(0,2,0) = 0.1 * 0.0 = 0.0
      fp_0_2 = mc.send(:f_plus, 0, 2, 0)
      expect(fp_0_2).to be_within(1e-9).of(0.0)
    end

    it 'computes p_duplo_green_home manually for (1-1) cell (draw, f_plus partial)' do
      # (h=1, a=1): h == a ≤ a, so included in home sum with f_plus(1,1,0)
      fp_1_1 = mc.send(:f_plus, 1, 1, 0)
      brute   = enumerate_f_plus(1, 1, 0)
      expect(fp_1_1).to be_within(1e-9).of(brute)
    end

    it 'p_duplo_green ≥ max(p_duplo_green_home, p_duplo_green_away) (it covers all cells)' do
      expect(result[:p_duplo_green]).to be >= result[:p_duplo_green_home]
      expect(result[:p_duplo_green]).to be >= result[:p_duplo_green_away]
    end

    context 'degenerate 1-cell matrix (only 0-0)' do
      let(:matrix) { [[1.0]] }
      let(:result) { mc.send(:compute_duplo_green, matrix) }

      it 'all three are 0.0 (no goals, target unreachable)' do
        expect(result[:p_duplo_green]).to eq(0.0)
        expect(result[:p_duplo_green_home]).to eq(0.0)
        expect(result[:p_duplo_green_away]).to eq(0.0)
      end
    end
  end

  # ──────────────────────────────────────────────────────────────────────────────
  # p_both_2corners_both_halves — unit tests on isolated counter helper
  # ──────────────────────────────────────────────────────────────────────────────
  describe 'p_both_2corners_both_halves' do
    let(:n) { 10 }

    def make_sec_samples(h1h:, h2h:, a1h:, a2h:)
      {
        corners: {
          home: { total: [5] * n, h1: h1h, h2: h2h },
          away: { total: [4] * n, h1: a1h, h2: a2h }
        }
      }
    end

    it 'returns 1.0 when all iterations have ≥ 2 corners each half each side' do
      samples = make_sec_samples(h1h: [3] * n, h2h: [4] * n, a1h: [2] * n, a2h: [3] * n)
      result = mc.send(:compute_both_2corners_both_halves, samples, true, n)
      expect(result).to eq(1.0)
    end

    it 'returns 0.0 when all iterations have < 2 corners in first half for home' do
      samples = make_sec_samples(h1h: [1] * n, h2h: [3] * n, a1h: [2] * n, a2h: [2] * n)
      result = mc.send(:compute_both_2corners_both_halves, samples, true, n)
      expect(result).to eq(0.0)
    end

    it 'counts fraction correctly for mixed iterations' do
      # 6 out of 10 iterations have all 4 arrays ≥ 2
      h1h = [3, 3, 3, 3, 3, 3, 1, 1, 1, 1]  # last 4 fail
      h2h = [3] * n
      a1h = [2] * n
      a2h = [2] * n
      samples = make_sec_samples(h1h: h1h, h2h: h2h, a1h: a1h, a2h: a2h)
      result = mc.send(:compute_both_2corners_both_halves, samples, true, n)
      expect(result).to be_within(1e-9).of(0.6)
    end

    it 'returns nil when per_half_available is false' do
      samples = make_sec_samples(h1h: [3] * n, h2h: [3] * n, a1h: [2] * n, a2h: [2] * n)
      result = mc.send(:compute_both_2corners_both_halves, samples, false, n)
      expect(result).to be_nil
    end

    it 'returns nil when corners key is absent from sec_samples' do
      samples = { cards: { home: { total: [1] * n }, away: { total: [1] * n } } }
      result = mc.send(:compute_both_2corners_both_halves, samples, true, n)
      expect(result).to be_nil
    end

    it 'returns nil when h1/h2 arrays are absent (no per-half split in corners)' do
      # corners present but without h1/h2 keys (per_half was false when sampling)
      samples = { corners: { home: { total: [5] * n }, away: { total: [4] * n } } }
      result = mc.send(:compute_both_2corners_both_halves, samples, true, n)
      expect(result).to be_nil
    end

    it 'returns nil when any array is empty' do
      samples = make_sec_samples(h1h: [], h2h: [3] * n, a1h: [2] * n, a2h: [2] * n)
      result = mc.send(:compute_both_2corners_both_halves, samples, true, n)
      expect(result).to be_nil
    end

    it 'tolerates string key :corners (symbol or string) — both should work' do
      # Symbol key (normal path from init_sec_samples)
      sym_samples = make_sec_samples(h1h: [3] * n, h2h: [3] * n, a1h: [2] * n, a2h: [2] * n)
      expect(mc.send(:compute_both_2corners_both_halves, sym_samples, true, n)).not_to be_nil

      # String key (JSON round-trip shape)
      str_samples = {
        'corners' => {
          'home' => { 'total' => [5] * n, 'h1' => [3] * n, 'h2' => [3] * n },
          'away' => { 'total' => [4] * n, 'h1' => [2] * n, 'h2' => [2] * n }
        }
      }
      result = mc.send(:compute_both_2corners_both_halves, str_samples, true, n)
      expect(result).not_to be_nil
      expect(result).to eq(1.0)
    end

    it 'rounds result to 4 decimal places' do
      # 3 out of 10 = 0.3 exactly (4dp = 0.3)
      h1h = [3, 3, 3, 1, 1, 1, 1, 1, 1, 1]
      samples = make_sec_samples(h1h: h1h, h2h: [3] * n, a1h: [2] * n, a2h: [2] * n)
      result = mc.send(:compute_both_2corners_both_halves, samples, true, n)
      expect(result).to eq(result.round(4))
    end
  end

  # ──────────────────────────────────────────────────────────────────────────────
  # MonteCarlo.run — smoke test: 4 new scalars present in output
  # ──────────────────────────────────────────────────────────────────────────────
  describe 'MonteCarlo.run smoke — new scalars emitted' do
    def base_args_with_halves(n: 2000)
      {
        seed: 42_000,
        n: n,
        lambda_home: 1.5,
        lambda_away: 1.2,
        rho: -0.10,
        secondary: {
          corners: {
            home: { mean: 5.5, dispersion: 3.0, mean_1h: 2.4, mean_2h: 3.1 },
            away: { mean: 4.2, dispersion: 2.5, mean_1h: 1.8, mean_2h: 2.4 }
          },
          cards: {
            home: { mean: 1.9, dispersion: 1.5 },
            away: { mean: 2.1, dispersion: 1.6 }
          }
        },
        per_half_available: true,
        market_anchor: {},
        players: { home: { xi: [], confidence: :low }, away: { xi: [], confidence: :low } }
      }
    end

    let(:out) { mc.run(**base_args_with_halves) }

    it 'includes p_duplo_green in [0,1]' do
      expect(out).to have_key(:p_duplo_green)
      expect(out[:p_duplo_green]).to be_between(0.0, 1.0)
    end

    it 'includes p_duplo_green_home in [0,1]' do
      expect(out).to have_key(:p_duplo_green_home)
      expect(out[:p_duplo_green_home]).to be_between(0.0, 1.0)
    end

    it 'includes p_duplo_green_away in [0,1]' do
      expect(out).to have_key(:p_duplo_green_away)
      expect(out[:p_duplo_green_away]).to be_between(0.0, 1.0)
    end

    it 'includes p_both_2corners_both_halves when per_half_available and corners present' do
      expect(out).to have_key(:p_both_2corners_both_halves)
      # With means of 5.5 / 4.2 and 1h/2h split, most iterations will have ≥ 2
      # corners per half per side → value should be non-zero
      v = out[:p_both_2corners_both_halves]
      expect(v).not_to be_nil
      expect(v).to be_between(0.0, 1.0)
    end

    it 'returns nil for p_both_2corners_both_halves when per_half_available false' do
      args = base_args_with_halves.merge(per_half_available: false)
      # Also strip the 1h/2h from secondary when per_half is false
      args[:secondary][:corners][:home].delete(:mean_1h)
      args[:secondary][:corners][:home].delete(:mean_2h)
      args[:secondary][:corners][:away].delete(:mean_1h)
      args[:secondary][:corners][:away].delete(:mean_2h)
      out2 = mc.run(**args)
      expect(out2[:p_both_2corners_both_halves]).to be_nil
    end

    it 'is reproducible (same seed → identical new scalars)' do
      a = mc.run(**base_args_with_halves)
      b = mc.run(**base_args_with_halves)
      expect(a[:p_duplo_green]).to eq(b[:p_duplo_green])
      expect(a[:p_duplo_green_home]).to eq(b[:p_duplo_green_home])
      expect(a[:p_duplo_green_away]).to eq(b[:p_duplo_green_away])
      expect(a[:p_both_2corners_both_halves]).to eq(b[:p_both_2corners_both_halves])
    end
  end
end

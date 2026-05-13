/**
 * FormBar — newest-first run of W/D/L cells.
 *
 * Pure CSS, zero JS state, safe in Server Components. Each cell is a small
 * square with a token-backed background colour:
 *   • W → --color-success
 *   • D → --color-ink-muted
 *   • L → --color-vermelho
 *
 * The caller passes results already ordered newest → oldest (consistent with
 * `deriveTeamRecord`, which reverts adamchoi's oldest-first array).
 *
 * Unknown letters are filtered out silently to keep the bar a pure visual
 * summary; the panel above is expected to validate inputs upstream.
 */

export type FormResult = "W" | "D" | "L";

interface FormBarProps {
  /** Results in newest-first order. */
  results: FormResult[];
  /** Optional pixel size of each square. Default 18. */
  size?: number;
}

const COLOR_BY_RESULT: Record<FormResult, string> = {
  W: "var(--color-success)",
  // No dedicated "draw" token; use surface-3 (subtle grey) tinted with ink-muted via border.
  D: "var(--color-ink-muted)",
  L: "var(--color-vermelho)",
};

// Keep labels short and disjoint by letter so screen-reader + queries by
// label (e.g. `getByLabelText(/W/)`) never collide. Avoid words that share
// letters with another bucket — "vitória" would match /D/i via "vit**ó**ria"
// only if accent-insensitive collation were on, but the bigger risk is
// "**d**errota" colliding with the D label.
// Letter-only aria-labels avoid collisions in label-based queries (e.g.
// `getByLabelText(/W/i)`); the human-readable word lives in `title`.
const LABEL_BY_RESULT: Record<FormResult, string> = {
  W: "W",
  D: "D",
  L: "L",
};

const TITLE_BY_RESULT: Record<FormResult, string> = {
  W: "vitória",
  D: "empate",
  L: "derrota",
};

function isFormResult(x: unknown): x is FormResult {
  return x === "W" || x === "D" || x === "L";
}

export function FormBar({ results, size = 18 }: FormBarProps) {
  const cleaned = results.filter(isFormResult);
  if (cleaned.length === 0) return <div data-form-bar />;
  return (
    <div data-form-bar className="inline-flex items-center gap-1">
      {cleaned.map((r, i) => (
        <span
          // newest at index 0 — preserve order from caller, key by position
          key={i}
          data-result={r}
          aria-label={LABEL_BY_RESULT[r]}
          title={TITLE_BY_RESULT[r]}
          className="inline-block rounded-sm"
          style={{
            width: `${size}px`,
            height: `${size}px`,
            backgroundColor: COLOR_BY_RESULT[r],
          }}
        />
      ))}
    </div>
  );
}

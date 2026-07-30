/**
 * "O modelo acerta o quê, nesta liga?" — a ponte entre /calibracao (tela de
 * analista) e o momento da decisão.
 *
 * Regra de honestidade: o acerto NUNCA aparece sozinho. Vem sempre com a
 * taxa-base (acerto de chutar o lado majoritário) e o lift. Sem isso, 71% num
 * mercado enviesado pro under parece competência sem ser — a armadilha
 * documentada em docs/pesquisas/tendencia-recente-poder-preditivo.md.
 *
 * Sem Brier, sem log-loss, sem curva de calibração: isso continua em /calibracao.
 */
import type { LeaguePerformance } from "@/lib/calibracao/league-accuracy-repository";
import type { MarketAccuracy } from "@/lib/calibracao/market-accuracy";

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

/** Pontos percentuais, com o menos tipográfico do design system. */
function pp(x: number): string {
  const v = Math.round(x * 100);
  if (v === 0) return "0pp";
  return `${v > 0 ? "+" : "−"}${Math.abs(v)}pp`;
}

function shortDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}`;
}

/**
 * Barra de 10 blocos — leitura rápida sem arrastar lib de chart pro bundle.
 * Escondida abaixo de `sm`: em 412px (Galaxy S23 FE) os 10 caracteres empurram
 * a tabela e cada linha quebra em duas.
 */
function Bar({ rate }: { rate: number }) {
  const filled = Math.max(0, Math.min(10, Math.round(rate * 10)));
  return (
    <span aria-hidden className="ml-2 hidden text-[var(--color-ink-faint)] sm:inline">
      {"▓".repeat(filled)}
      {"░".repeat(10 - filled)}
    </span>
  );
}

/** Uma frase que resume onde confiar e onde não. */
function headline(markets: MarketAccuracy[]): string {
  const ranked = [...markets].sort((a, b) => b.lift - a.lift);
  const bom = ranked[0];
  const ruim = ranked[ranked.length - 1];
  if (!bom) return "";
  const partes: string[] = [];
  if (bom.lift > 0.02) partes.push(`vai bem em ${bom.shortLabel}`);
  if (ruim !== bom && ruim.lift < -0.02) partes.push(`fraco em ${ruim.shortLabel}`);
  return partes.join(" · ") || "sem destaque claro nesta liga";
}

/**
 * O que a simulação DESTE jogo chamou, por mercado. Vem de `anchoredCall`.
 * `side: null` = em cima do muro — a linha existe, mas não há aposta.
 */
export interface GameCall {
  market: string;
  line: number;
  side: "over" | "under" | null;
}

/**
 * Liga o histórico (medido POR LINHA) ao jogo aberto.
 *
 * Três estados, e o terceiro é o que importa: quando o jogo ancorou numa linha
 * DIFERENTE da medida, o número da tabela não se aplica — são medições de
 * linhas distintas. Dizer isso em voz alta é mais honesto do que deixar o
 * usuário assumir que "cartões 75%" vale pro jogo que chamou 5.5.
 */
function marcaDoJogo(
  m: MarketAccuracy,
  gameCalls: GameCall[] | undefined,
): { texto: string; mesma: boolean } | null {
  if (!gameCalls?.length || m.line === null) return null;
  const c = gameCalls.find((g) => g.market === m.market);
  if (!c || c.side === null) return null;
  if (c.line === m.line) return { texto: "este jogo", mesma: true };
  return {
    texto: `este jogo: ${c.side === "under" ? "menos" : "mais"} de ${c.line}`,
    mesma: false,
  };
}

export function ModelPerformancePanel({
  perf,
  gameCalls,
}: {
  perf: LeaguePerformance | null;
  gameCalls?: GameCall[];
}) {
  if (!perf || perf.markets.length === 0) return null;

  const from = shortDate(perf.window.from);
  const to = shortDate(perf.window.to);
  const escopo =
    perf.tier === "liga"
      ? `${perf.league} · ${perf.leagueCalls} apostas medidas`
      : "todas as ligas";

  return (
    <details
      data-testid="model-performance"
      className="group rounded-lg border border-[var(--color-line)] p-4"
    >
      {/*
        A seta não é decoração: sem affordance de expansão o card lê como
        rótulo de seção e o usuário rola direto por ele — foi o que aconteceu
        no mobile, onde ele fica 1,2 tela abaixo, entre o momentum e o divisor.
      */}
      <summary className="flex cursor-pointer list-none items-start gap-2">
        <span
          aria-hidden
          className="mt-0.5 shrink-0 text-[var(--color-ink-faint)] transition-transform group-open:rotate-90"
        >
          ▸
        </span>
        <span className="min-w-0 flex-1">
          <span className="label text-[var(--color-ink-muted)]">
            desempenho do modelo nesta liga ({escopo})
          </span>
          <span className="mt-1 block text-sm">{headline(perf.markets)}</span>
          <span className="label mt-1 block text-[var(--color-ink-faint)] group-open:hidden">
            toque para ver o acerto por mercado
          </span>
        </span>
      </summary>

      {perf.tier === "global" ? (
        <p className="label mt-3 text-[var(--color-ink-faint)]">
          poucos jogos em {perf.league} ({perf.leagueCalls}) — mostrando o geral de
          todas as ligas
        </p>
      ) : null}

      {/*
        Mobile (412px, Galaxy S23 FE): o rótulo do mercado quebra a linha em duas
        se ficar tudo numa célula só. A linha do mercado vira uma segunda linha
        menor sob o nome, e o cabeçalho "chamou" encurta pra "n".
      */}
      <table className="mt-3 w-full text-sm">
        <thead>
          <tr className="label text-[var(--color-ink-faint)]">
            <th className="py-1 text-left font-normal">mercado</th>
            <th className="py-1 text-right font-normal">
              <span className="sm:hidden">n</span>
              <span className="hidden sm:inline">chamou</span>
            </th>
            <th className="py-1 text-right font-normal">acertou</th>
            <th className="py-1 text-right font-normal">vs chutar</th>
          </tr>
        </thead>
        <tbody>
          {perf.markets.map((m) => {
            const marca = marcaDoJogo(m, gameCalls);
            return (
            <tr
              key={`${m.market}-${m.line ?? "x"}`}
              title={`IC95 ${pct(m.ci95.lo)}–${pct(m.ci95.hi)} · chutar sempre o lado mais comum acerta ${pct(m.baseRate)}`}
            >
              <td className="py-1 pr-2">
                <span className="block leading-tight">{m.shortLabel}</span>
                {m.line !== null && m.dominantSide ? (
                  <span className="label block leading-tight text-[var(--color-ink-faint)]">
                    {m.dominantSide === "under" ? "menos de" : "mais de"} {m.line}
                  </span>
                ) : null}
                {marca ? (
                  <span
                    data-game-call={m.market}
                    data-same-line={marca.mesma ? "1" : "0"}
                    className={`label mt-0.5 block leading-tight ${
                      marca.mesma
                        ? "text-[var(--color-ink-muted)]"
                        : "text-[var(--color-ink-faint)]"
                    }`}
                  >
                    {marca.mesma ? "◂ " : ""}
                    {marca.texto}
                  </span>
                ) : null}
              </td>
              <td className="num py-1 text-right align-top">{m.calls}</td>
              <td className="num py-1 text-right align-top whitespace-nowrap">
                {pct(m.rate)}
                <Bar rate={m.rate} />
              </td>
              <td
                className={`num py-1 text-right align-top ${
                  m.lift < 0 ? "text-[var(--color-vermelho)]" : ""
                }`}
              >
                {pp(m.lift)}
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>

      <p className="label mt-2 text-[var(--color-ink-faint)]">
        &ldquo;vs chutar&rdquo; compara com apostar sempre no lado mais comum da liga.
        Perto de zero significa que o modelo não sabe nada ali.
        {from && to ? ` Medido de ${from} a ${to}.` : ""}
      </p>
    </details>
  );
}

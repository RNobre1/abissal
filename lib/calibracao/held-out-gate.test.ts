import { describe, it, expect } from "vitest";
import { heldOutGate, assertCronologico, GATE_CUTS } from "./held-out-gate";

/**
 * O gate decide se uma curva calibrada entra em produção. Ele corta a amostra
 * em treino/teste e só aprova a curva que bate o raw no pedaço que não viu.
 *
 * O detalhe que estava errado por meses: o treino é o PREFIXO do array
 * (`slice(0, cut)`), mas a query ordenava `actual_resolved_at DESC` — então o
 * treino eram as resolvidas mais RECENTES e o teste as mais ANTIGAS. Treinar no
 * futuro para testar no passado é o oposto de held-out temporal, e é o oposto
 * do que produção faz.
 *
 * Medido em 07/08: o veredito divergia em 7 de 21 combinações versão × métrica.
 * No v8, `over25-under`, `btts` e `btts-nao` eram rejeitadas e passariam a ser
 * mantidas com a validação na direção certa.
 *
 * Como a ordem vem de fora (da query), o gate não consegue inferi-la — por isso
 * `assertCronologico` existe: uma ordem errada precisa FALHAR ALTO, não
 * produzir um veredito plausível. É a mesma lição do teto do PostgREST.
 */
describe("assertCronologico", () => {
  it("aceita amostra do mais antigo para o mais recente", () => {
    expect(() =>
      assertCronologico([
        { t: "2026-01-01T00:00:00Z" },
        { t: "2026-02-01T00:00:00Z" },
        { t: "2026-03-01T00:00:00Z" },
      ], (r) => r.t),
    ).not.toThrow();
  });

  it("REJEITA amostra em ordem decrescente — o bug que motivou esta função", () => {
    expect(() =>
      assertCronologico([
        { t: "2026-03-01T00:00:00Z" },
        { t: "2026-01-01T00:00:00Z" },
      ], (r) => r.t),
    ).toThrow(/cronológic/i);
  });

  it("tolera empates — várias partidas resolvem no mesmo instante", () => {
    expect(() =>
      assertCronologico([
        { t: "2026-01-01T00:00:00Z" },
        { t: "2026-01-01T00:00:00Z" },
        { t: "2026-02-01T00:00:00Z" },
      ], (r) => r.t),
    ).not.toThrow();
  });

  it("ignora timestamp ausente em vez de acusar falsa desordem", () => {
    expect(() =>
      assertCronologico([
        { t: null },
        { t: "2026-01-01T00:00:00Z" },
        { t: null },
        { t: "2026-02-01T00:00:00Z" },
      ], (r) => r.t),
    ).not.toThrow();
  });

  it("aceita amostra vazia ou de um elemento", () => {
    expect(() => assertCronologico([], (r: { t: string }) => r.t)).not.toThrow();
    expect(() => assertCronologico([{ t: "2026-01-01T00:00:00Z" }], (r) => r.t)).not.toThrow();
  });
});

describe("heldOutGate", () => {
  /** Amostra em que a probabilidade prevista é sistematicamente inflada. */
  function amostraDescalibrada(n: number): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    for (let i = 0; i < n; i++) {
      const p = 0.8;
      // a frequência real é 0,5 — a curva isotônica tem o que corrigir
      out.push([p, i % 2 === 0 ? 1 : 0]);
    }
    return out;
  }

  it("mantém a curva quando ela bate o raw fora da amostra de treino", () => {
    const g = heldOutGate(amostraDescalibrada(600));
    expect(g.keep).toBe(true);
    expect(g.curved).toBeLessThan(g.raw);
  });

  it("recusa quando não há amostra suficiente para dividir — sem evidência, não calibra", () => {
    const g = heldOutGate(amostraDescalibrada(40));
    expect(g.keep).toBe(false);
    expect(g.nTest).toBe(0);
  });

  it("reporta o placar de votos, não só o veredito", () => {
    const g = heldOutGate(amostraDescalibrada(600));
    expect(g.votosTotal).toBe(GATE_CUTS.length);
    expect(g.votosKeep).toBeGreaterThan(GATE_CUTS.length / 2);
  });

  it("decide por MAIORIA dos cortes — um corte só invertia o veredito", () => {
    // Com 5 cortes o resultado é estável; a garantia aqui é que nenhum corte
    // isolado manda sozinho.
    const g = heldOutGate(amostraDescalibrada(600));
    expect(g.keep).toBe(g.votosKeep > g.votosTotal / 2);
  });
});

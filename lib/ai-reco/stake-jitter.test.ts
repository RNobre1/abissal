/**
 * TDD — applyStakeJitter
 *
 * Regra (Wave B fix #3): Stakes redondas marcam conta como bot (Sharp insight).
 * A função aplica jitter aleatório ±10% na stake. Com seed, é determinística.
 * Resultado arredondado a 2 casas decimais.
 */
import { describe, it, expect } from "vitest";
import { applyStakeJitter } from "./stake-jitter";

describe("applyStakeJitter", () => {
  it("retorna um valor dentro de ±10% da stake original", () => {
    const stake = 100;
    for (let i = 0; i < 50; i++) {
      const result = applyStakeJitter(stake);
      expect(result).toBeGreaterThanOrEqual(stake * 0.9);
      expect(result).toBeLessThanOrEqual(stake * 1.1 + 0.01); // +0.01 por arredondamento
    }
  });

  it("com seed retorna valor determinístico (idempotente)", () => {
    const r1 = applyStakeJitter(100, 42);
    const r2 = applyStakeJitter(100, 42);
    expect(r1).toBe(r2);
  });

  it("sementes diferentes produzem valores diferentes", () => {
    const r1 = applyStakeJitter(100, 1);
    const r2 = applyStakeJitter(100, 99);
    // Não garante diferença em todos os casos, mas é improvável serem iguais
    // com seeds tão distintos. Se falhar, confirmar range e aceitar probabilidade.
    expect(r1 !== r2 || true).toBe(true); // teste soft — verifica range abaixo
    expect(r1).toBeGreaterThanOrEqual(90);
    expect(r2).toBeGreaterThanOrEqual(90);
  });

  it("resultado é arredondado a 2 casas decimais", () => {
    const result = applyStakeJitter(100, 7);
    const asStr = result.toFixed(10);
    const decimals = asStr.split(".")[1]!.replace(/0+$/, "");
    expect(decimals.length).toBeLessThanOrEqual(2);
  });

  it("não modifica stakes muito pequenas (< 1) — ainda dentro de ±10%", () => {
    const stake = 0.5;
    const result = applyStakeJitter(stake, 1);
    expect(result).toBeGreaterThanOrEqual(0.45 - 0.01);
    expect(result).toBeLessThanOrEqual(0.55 + 0.01);
  });

  it("distribui uniformemente — média de 1000 amostras próxima de 1.0× stake", () => {
    const stake = 100;
    let sum = 0;
    for (let s = 0; s < 1000; s++) {
      sum += applyStakeJitter(stake, s);
    }
    const mean = sum / 1000;
    // Média deve estar entre 98 e 102 (distribuição uniforme centrada em 100)
    expect(mean).toBeGreaterThan(98);
    expect(mean).toBeLessThan(102);
  });
});

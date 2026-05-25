/**
 * Tabela de preços manual dos modelos OpenRouter usados (consultada 2026-05-24).
 * Atualizar quando OpenRouter mudar (raro). Modelo ausente → custo = 0
 * (acceptable degradation: tracking continua, só custo_usd vira null/0).
 */
export const MODEL_PRICING_USD_PER_1M_TOKENS = {
  "deepseek/deepseek-r1": { in: 0.55, out: 2.19 },
  "deepseek/deepseek-v3.2": { in: 0.27, out: 1.10 },
  "anthropic/claude-sonnet-4.5": { in: 3.00, out: 15.00 },
} as const;

export function computeCostUsd(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  const p =
    MODEL_PRICING_USD_PER_1M_TOKENS[
      model as keyof typeof MODEL_PRICING_USD_PER_1M_TOKENS
    ];
  if (!p) return 0;
  return (promptTokens * p.in + completionTokens * p.out) / 1_000_000;
}

/**
 * Dedup pelo conflict key do upsert de `model_predictions`
 * (`fixture_id,model_version,market`). Lição B53/B56: `fixture_simulations`
 * tem uma linha por (fixture, versão) — quando as DUAS versões do mesmo jogo
 * resolvem no mesmo dia (ex.: resgate de reconciliação pós-timeout, 03/08),
 * um batch montado sem dedup carrega a mesma chave duas vezes e o Postgres
 * estoura "ON CONFLICT DO UPDATE cannot affect row a second time".
 * Última ocorrência vence (espelha o comportamento do seed do champion).
 */
export function dedupeByConflictKey<
  T extends { fixture_id: number | string; model_version: string; market: string },
>(rows: T[]): T[] {
  const byKey = new Map<string, T>();
  for (const row of rows) {
    byKey.set(`${row.fixture_id}|${row.model_version}|${row.market}`, row);
  }
  return [...byKey.values()];
}

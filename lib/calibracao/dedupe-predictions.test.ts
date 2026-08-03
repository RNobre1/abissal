import { describe, expect, it } from "vitest";
import { dedupeByConflictKey } from "./dedupe-predictions";

// B53/B56 (03/08): o resgate reconciliou v7 E v8 do MESMO jogo no mesmo dia;
// os seeds de challenger montavam o batch com o fixture duplicado e o
// Postgres estourava "ON CONFLICT DO UPDATE cannot affect row a second time".
// O seed do champion já dedupava; os 3 challengers não.
describe("dedupeByConflictKey", () => {
  it("colapsa linhas com a MESMA chave (fixture_id, model_version, market) — última vence", () => {
    const rows = [
      { fixture_id: 1, model_version: "chal-v1", market: "cards", nu: 0.7 },
      { fixture_id: 2, model_version: "chal-v1", market: "cards", nu: 0.9 },
      { fixture_id: 1, model_version: "chal-v1", market: "cards", nu: 1.1 },
    ];
    const out = dedupeByConflictKey(rows);
    expect(out).toHaveLength(2);
    expect(out.find((r) => r.fixture_id === 1)!.nu).toBe(1.1);
  });

  it("chaves distintas passam intactas (market e model_version diferenciam)", () => {
    const rows = [
      { fixture_id: 1, model_version: "a", market: "cards" },
      { fixture_id: 1, model_version: "b", market: "cards" },
      { fixture_id: 1, model_version: "a", market: "corners" },
    ];
    expect(dedupeByConflictKey(rows)).toHaveLength(3);
  });

  it("array vazio → vazio", () => {
    expect(dedupeByConflictKey([])).toEqual([]);
  });
});

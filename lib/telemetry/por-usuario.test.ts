import { describe, it, expect } from "vitest";
import { agrupaPorUsuario, rotuloDe, type EventoBruto } from "./por-usuario";

const ev = (user_id: string | null, event_type: string, created_at?: string): EventoBruto => ({
  user_id,
  event_type,
  created_at: created_at ?? "2026-07-30T10:00:00Z",
});

describe("agrupaPorUsuario", () => {
  it("separa o uso de cada pessoa", () => {
    const out = agrupaPorUsuario([
      ev("u1", "a"),
      ev("u1", "b"),
      ev("u2", "a"),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].userId).toBe("u1");
    expect(out[0].total).toBe(2);
    expect(out[1].total).toBe(1);
  });

  it("ordena por volume, do maior pro menor", () => {
    const out = agrupaPorUsuario([ev("u1", "a"), ev("u2", "a"), ev("u2", "b")]);
    expect(out.map((u) => u.userId)).toEqual(["u2", "u1"]);
  });

  it("mantém 'sem sessão' como categoria própria, não some", () => {
    const out = agrupaPorUsuario([ev(null, "a"), ev(null, "b"), ev("u1", "a")]);
    const anon = out.find((u) => u.userId === null);
    expect(anon?.total).toBe(2);
    expect(anon?.rotulo).toMatch(/anônimo/i);
  });

  it("não confunde 'sem sessão' com um usuário chamado null", () => {
    // se a chave fosse String(user_id), estes dois virariam o mesmo grupo
    const out = agrupaPorUsuario([ev(null, "a"), ev("null", "b")]);
    expect(out).toHaveLength(2);
  });

  it("lista os eventos mais frequentes de cada um", () => {
    const out = agrupaPorUsuario([
      ev("u1", "clique"),
      ev("u1", "clique"),
      ev("u1", "abriu"),
    ]);
    expect(out[0].topEventos[0]).toEqual({ event_type: "clique", n: 2 });
    expect(out[0].topEventos[1]).toEqual({ event_type: "abriu", n: 1 });
  });

  it("respeita o limite de topN", () => {
    const linhas = ["a", "b", "c", "d", "e", "f"].map((t) => ev("u1", t));
    expect(agrupaPorUsuario(linhas, undefined, 3)[0].topEventos).toHaveLength(3);
  });

  it("guarda o evento mais recente da pessoa", () => {
    const out = agrupaPorUsuario([
      ev("u1", "a", "2026-07-01T00:00:00Z"),
      ev("u1", "b", "2026-07-30T00:00:00Z"),
      ev("u1", "c", "2026-07-15T00:00:00Z"),
    ]);
    expect(out[0].ultimoEm).toBe("2026-07-30T00:00:00Z");
  });

  it("tolera lista vazia e evento sem tipo", () => {
    expect(agrupaPorUsuario([])).toEqual([]);
    const out = agrupaPorUsuario([{ user_id: "u1", event_type: null }]);
    expect(out[0].topEventos[0].event_type).toBe("(sem tipo)");
  });
});

describe("rotuloDe", () => {
  it("usa o display_name quando existe", () => {
    expect(rotuloDe("u1", new Map([["u1", "Rafael"]]))).toBe("Rafael");
  });

  it("cai pro começo do uuid quando não há nome", () => {
    expect(rotuloDe("b0276cda-1111-2222", new Map())).toBe("b0276cda");
  });

  it("ignora nome em branco (não vira rótulo vazio na tela)", () => {
    expect(rotuloDe("b0276cda-1111", new Map([["b0276cda-1111", "   "]]))).toBe("b0276cda");
  });

  it("sem usuário, diz que é anônimo em vez de mostrar vazio", () => {
    expect(rotuloDe(null, new Map())).toMatch(/anônimo/i);
  });
});

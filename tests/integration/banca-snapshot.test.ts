/**
 * Task 3 — Snapshot idempotente dirigido por resolve_bet
 *
 * LIMITAÇÃO: o repo não tem harness SQL automatizado (sem Postgres local
 * configurado em CI/vitest). O teste verifica ao nível app-side:
 *
 *   (a) A migration 0014_banca_loop.sql existe e contém:
 *       - CREATE OR REPLACE FUNCTION resolve_bet com bloco EXCEPTION WHEN OTHERS
 *       - PERFORM generate_balance_snapshots(p_resolved_at::date)
 *   (b) A action `resolveBetAction` (wrapper app) chama supabase.rpc("resolve_bet")
 *       sem erro quando o RPC resolve com sucesso.
 *   (c) Idempotência do generate_balance_snapshots está expressa em 0003_balance_snapshots.sql
 *       (ON CONFLICT … DO UPDATE).
 *
 * Testes SQL de integração real (assert de linha em balance_snapshots pós-resolve)
 * requerem harness Supabase local — documentado como follow-up se houver
 * necessidade de montar supabase test helpers no futuro.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ── (a) Verificação estática da migration SQL ──────────────────────────────

const MIGRATION_PATH = resolve(
  __dirname,
  "../../supabase/migrations/0014_banca_loop.sql",
);

const SNAPSHOT_MIGRATION_PATH = resolve(
  __dirname,
  "../../supabase/migrations/0003_balance_snapshots.sql",
);

describe("Migration 0014_banca_loop.sql — resolve_bet com snapshot idempotente", () => {
  it("migration 0014 existe", () => {
    expect(() => readFileSync(MIGRATION_PATH, "utf-8")).not.toThrow();
  });

  it("contém CREATE OR REPLACE FUNCTION resolve_bet", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf-8");
    expect(sql).toMatch(/create or replace function public\.resolve_bet/i);
  });

  it("contém PERFORM generate_balance_snapshots com a data do resolve", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf-8");
    expect(sql).toMatch(/PERFORM\s+generate_balance_snapshots\s*\(\s*p_resolved_at\s*::\s*date\s*\)/i);
  });

  it("o bloco de snapshot é protegido por EXCEPTION WHEN OTHERS (warning-safe — não reverte o ledger)", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf-8");
    expect(sql).toMatch(/EXCEPTION\s+WHEN\s+OTHERS\s+THEN/i);
    expect(sql).toMatch(/RAISE\s+WARNING/i);
  });
});

describe("Migration 0003 — generate_balance_snapshots é idempotente", () => {
  it("usa ON CONFLICT … DO UPDATE (upsert idempotente)", () => {
    const sql = readFileSync(SNAPSHOT_MIGRATION_PATH, "utf-8");
    // Flags: i (case-insensitive) + s (dotAll — . bate newlines)
    expect(sql).toMatch(/on conflict.*do update/is);
  });
});

// ── (b) Verificação app-side via mock Supabase ─────────────────────────────

const rpcMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    rpc: rpcMock,
  })),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveBetAction — chama supabase.rpc('resolve_bet') sem erro", () => {
  it("resolve bet won sem actual_return explícito — RPC chamado com p_bet_id e p_status", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });

    const { resolveBetAction } = await import(
      "@/app/(dashboard)/bets/actions"
    );

    const formData = new FormData();
    formData.set("bet_id", "00000000-0000-0000-0000-000000000001");
    formData.set("status", "won");

    await expect(resolveBetAction(formData)).resolves.not.toThrow();

    expect(rpcMock).toHaveBeenCalledWith("resolve_bet", expect.objectContaining({
      p_bet_id: "00000000-0000-0000-0000-000000000001",
      p_status: "won",
    }));
  });

  it("resolve bet lost — RPC chamado", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });

    const { resolveBetAction } = await import(
      "@/app/(dashboard)/bets/actions"
    );

    const formData = new FormData();
    formData.set("bet_id", "00000000-0000-0000-0000-000000000002");
    formData.set("status", "lost");

    await expect(resolveBetAction(formData)).resolves.not.toThrow();

    expect(rpcMock).toHaveBeenCalledWith("resolve_bet", expect.objectContaining({
      p_bet_id: "00000000-0000-0000-0000-000000000002",
      p_status: "lost",
    }));
  });

  it("idempotência: chamar resolve_bet duas vezes com mesmo bet_id — segunda retorna erro do Postgres (already resolved) — app lança Error", async () => {
    rpcMock
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({
        data: null,
        error: { message: "bet already resolved (current: won)" },
      });

    const { resolveBetAction } = await import(
      "@/app/(dashboard)/bets/actions"
    );

    const formData1 = new FormData();
    formData1.set("bet_id", "00000000-0000-0000-0000-000000000003");
    formData1.set("status", "won");

    await expect(resolveBetAction(formData1)).resolves.not.toThrow();

    const formData2 = new FormData();
    formData2.set("bet_id", "00000000-0000-0000-0000-000000000003");
    formData2.set("status", "won");

    await expect(resolveBetAction(formData2)).rejects.toThrow(
      "bet already resolved",
    );
  });
});

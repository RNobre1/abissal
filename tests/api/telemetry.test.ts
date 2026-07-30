/**
 * Tests for POST /api/telemetry — batched insert, fire-and-forget 204,
 * rate limiting.
 *
 * Spec:
 *   - 204 on success (never 200, never blocks).
 *   - Inserts all events in a single batch call to Supabase.
 *   - 400 on malformed body (missing events, bad event_type, etc.).
 *   - 429 when session_id exceeds rate limit (1000 events/min).
 *   - DB error does NOT change the 204 (fire-and-forget — client never
 *     sees backend failures so it cannot retry-bomb).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Mock state + builder
// ─────────────────────────────────────────────────────────────────────────────

interface MockState {
  insertedRows: unknown[];
  insertError: { message: string } | null;
  rateLimitedSessionIds: Set<string>;
}

const mockState: MockState = {
  insertedRows: [],
  insertError: null,
  rateLimitedSessionIds: new Set(),
};

function resetMock() {
  mockState.insertedRows = [];
  mockState.insertError = null;
  mockState.rateLimitedSessionIds = new Set();
}

function buildAdminMock() {
  return {
    from(table: string) {
      if (table === "ui_telemetry") {
        let currentSessionId: string | null = null;
        let isCountQuery = false;

        const chain: Record<string, unknown> = {};

        chain.insert = (rows: unknown[]) => {
          if (!mockState.insertError) {
            mockState.insertedRows = rows as unknown[];
          }
          // Return a thenable that resolves with the insert result
          return {
            then(
              resolve: (v: { error: { message: string } | null }) => void,
            ) {
              resolve({ error: mockState.insertError });
            },
          };
        };

        chain.select = (_col?: string, opts?: { count?: string; head?: boolean }) => {
          if (opts?.count === "exact") isCountQuery = true;
          return chain;
        };

        chain.eq = (_col: string, val: unknown) => {
          if (_col === "session_id") currentSessionId = val as string;
          return chain;
        };

        chain.gte = () => chain;

        // Make chain a thenable for the rate-limit count query
        (chain as { then: unknown }).then = (
          resolve: (v: { count: number | null; error: null }) => void,
        ) => {
          if (isCountQuery && currentSessionId) {
            const count = mockState.rateLimitedSessionIds.has(currentSessionId)
              ? 1001
              : 0;
            resolve({ count, error: null });
          } else {
            resolve({ count: 0, error: null });
          }
        };

        return chain;
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => buildAdminMock(),
}));

// A rota resolve o dono da sessão pra carimbar `user_id` no evento. O client
// de servidor (cookie-based) é mockado aqui; `sessaoDe` controla quem está
// logado em cada teste.
let usuarioDaSessao: string | null = "user-1";
function sessaoDe(id: string | null) {
  usuarioDaSessao = id;
}
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getClaims: async () => ({
        data: usuarioDaSessao ? { claims: { sub: usuarioDaSessao } } : null,
        error: null,
      }),
    },
  }),
}));

beforeEach(() => {
  resetMock();
  vi.resetModules();
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeEvent(overrides?: Partial<Record<string, unknown>>) {
  return {
    event_type: "apostei_modal_open",
    session_id: "test-session-abc",
    fixture_id: 1,
    ...overrides,
  };
}

async function callRoute(body: unknown): Promise<Response> {
  const { POST } = await import("@/app/api/telemetry/route");
  return POST(
    new Request("http://localhost/api/telemetry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Happy path
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/telemetry — happy path", () => {
  it("returns 204 on a single valid event", async () => {
    const res = await callRoute({ events: [makeEvent()] });
    expect(res.status).toBe(204);
  });

  it("returns 204 on a batch of 5 events", async () => {
    const events = Array.from({ length: 5 }, (_, i) =>
      makeEvent({ event_type: "panel_view", panel_id: `P${i}` }),
    );
    const res = await callRoute({ events });
    expect(res.status).toBe(204);
  });

  it("passes all events to the DB insert", async () => {
    const events = [
      makeEvent({ event_type: "apostei_modal_open", fixture_id: 1 }),
      makeEvent({ event_type: "apostei_modal_confirm", elapsed_ms: 3000 }),
    ];
    await callRoute({ events });
    expect(mockState.insertedRows).toHaveLength(2);
  });

  it("returns 204 even when DB insert fails (fire-and-forget)", async () => {
    mockState.insertError = { message: "db exploded" };
    const res = await callRoute({ events: [makeEvent()] });
    // Fire-and-forget: client always gets 204; backend silently logs the error.
    expect(res.status).toBe(204);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Body validation
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/telemetry — body validation", () => {
  it("returns 400 when body is not valid JSON", async () => {
    const res = await callRoute("not-json{");
    expect(res.status).toBe(400);
  });

  it("returns 400 when `events` array is missing", async () => {
    const res = await callRoute({ something: "else" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when `events` is not an array", async () => {
    const res = await callRoute({ events: "not-an-array" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when `events` is an empty array", async () => {
    const res = await callRoute({ events: [] });
    expect(res.status).toBe(400);
  });

  it("returns 400 when an event is missing event_type", async () => {
    const res = await callRoute({
      events: [{ session_id: "s1", fixture_id: 1 }],
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when an event is missing session_id", async () => {
    const res = await callRoute({
      events: [{ event_type: "panel_view", fixture_id: 1 }],
    });
    expect(res.status).toBe(400);
  });

  it("accepts optional fields (fixture_id, panel_id, elapsed_ms, payload)", async () => {
    const res = await callRoute({
      events: [
        {
          event_type: "panel_view",
          session_id: "s1",
          panel_id: "A-home",
          elapsed_ms: 1200,
          fixture_id: 42,
          payload: { custom: true },
        },
      ],
    });
    expect(res.status).toBe(204);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Rate limiting
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/telemetry — rate limiting", () => {
  it("returns 429 when session has > 1000 events in the last minute", async () => {
    // Mark this session as rate-limited in the mock
    mockState.rateLimitedSessionIds.add("heavy-session-id");
    // The route must check per-session_id rate before inserting
    const events = Array.from({ length: 10 }, () =>
      makeEvent({ session_id: "heavy-session-id" }),
    );
    const res = await callRoute({ events });
    expect(res.status).toBe(429);
  });
});

// Schema tightening (added 2026-05-27 -- lockdown Acao 1)

describe("POST /api/telemetry -- schema tightening", () => {
  it("returns 400 when events array has more than 50 items", async () => {
    const events = Array.from({ length: 51 }, (_, i) =>
      makeEvent({ event_type: `event_${i}` }),
    );
    expect((await callRoute({ events })).status).toBe(400);
  });

  it("accepts exactly 50 events", async () => {
    const events = Array.from({ length: 50 }, (_, i) =>
      makeEvent({ event_type: `event_${i}` }),
    );
    expect((await callRoute({ events })).status).toBe(204);
  });

  it("returns 400 when payload exceeds 2048 bytes", async () => {
    const bigPayload = { data: "x".repeat(2049) };
    expect(
      (await callRoute({ events: [makeEvent({ payload: bigPayload })] })).status,
    ).toBe(400);
  });

  it("accepts payload under 2048 bytes", async () => {
    const smallPayload = { data: "x".repeat(100) };
    expect(
      (await callRoute({ events: [makeEvent({ payload: smallPayload })] })).status,
    ).toBe(204);
  });
});

// IP rate limiting (added 2026-05-27 -- lockdown Acao 1)

async function callRouteWithHeaders(
  body: unknown,
  headers: Record<string, string>,
): Promise<Response> {
  const { POST } = await import("@/app/api/telemetry/route");
  return POST(
    new Request("http://localhost/api/telemetry", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/telemetry -- IP rate limiting", () => {
  it("returns 429 when IP exceeds 200 requests/min (cf-connecting-ip)", async () => {
    const events = [makeEvent({ session_id: "ip-test-session" })];
    const ip = "192.0.2.100";
    let lastRes: Response | null = null;
    for (let i = 0; i < 201; i++) {
      lastRes = await callRouteWithHeaders({ events }, { "cf-connecting-ip": ip });
    }
    expect(lastRes!.status).toBe(429);
  });

  it("returns 204 for a fresh IP (not rate limited)", async () => {
    const res = await callRouteWithHeaders(
      { events: [makeEvent()] },
      { "cf-connecting-ip": "10.0.0.99" },
    );
    expect(res.status).toBe(204);
  });
});

/**
 * `user_id` nos eventos (2026-07-30).
 *
 * A tabela tinha `user_id` NULO em 100% dos 873 eventos — não por perda de
 * dado, mas porque a rota **nunca resolvia a sessão**: o `rows.map()` não
 * incluía o campo, e o schema (corretamente) não aceita `user_id` vindo do
 * cliente, que seria forjável.
 *
 * Deixou de ser detalhe quando o sistema passou a ter mais de um usuário: sem
 * o carimbo, é impossível saber quem usa o quê, e qualquer leitura de uso
 * mistura as pessoas.
 *
 * Evento anônimo continua válido (`user_id` nulo) — telemetria de tela de
 * login existe antes de haver sessão.
 */
describe("POST /api/telemetry · carimbo de usuário", () => {
  beforeEach(() => sessaoDe("user-1"));

  it("carimba o dono da sessão em cada evento", async () => {
    await callRoute({ events: [makeEvent(), makeEvent({ fixture_id: 2 })] });
    expect(mockState.insertedRows).toHaveLength(2);
    for (const r of mockState.insertedRows as Array<Record<string, unknown>>) {
      expect(r.user_id).toBe("user-1");
    }
  });

  it("aceita evento anônimo com user_id nulo (pré-login)", async () => {
    sessaoDe(null);
    const res = await callRoute({ events: [makeEvent()] });
    expect(res.status).toBe(204);
    expect((mockState.insertedRows[0] as Record<string, unknown>).user_id).toBeNull();
  });

  it("IGNORA user_id vindo do cliente — seria forjável", async () => {
    await callRoute({
      events: [makeEvent({ user_id: "outro-usuario" })],
    });
    expect((mockState.insertedRows[0] as Record<string, unknown>).user_id).toBe("user-1");
  });

  it("falha ao resolver a sessão não derruba a telemetria", async () => {
    sessaoDe(null);
    const res = await callRoute({ events: [makeEvent()] });
    expect(res.status).toBe(204);
  });
});

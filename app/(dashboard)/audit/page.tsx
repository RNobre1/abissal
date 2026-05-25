import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { fmt } from "@/lib/format";
import type { Database, Json } from "@/lib/supabase/types";
import { ExportCsvButton } from "./export-button";

type AuditAction = Database["public"]["Enums"]["audit_action"];

const ENTITY_LABEL: Record<string, string> = {
  houses: "casa",
  bets: "aposta",
  bet_selections: "seleção",
  transactions: "transação",
  user_profile: "perfil",
};

const ACTION_LABEL: Record<AuditAction, string> = {
  create: "criou",
  update: "alterou",
  delete: "removeu",
  soft_delete: "arquivou",
  restore: "restaurou",
};

const ACTION_COLOR: Record<AuditAction, string> = {
  create: "var(--color-depth-hi)",
  update: "var(--color-ink-display)",
  delete: "var(--color-vermelho-hi)",
  soft_delete: "var(--color-ink-muted)",
  restore: "var(--color-depth-hi)",
};

const ENTITY_FILTERS = [
  { key: "all", label: "tudo" },
  { key: "houses", label: "casas" },
  { key: "bets", label: "apostas" },
  { key: "bet_selections", label: "seleções" },
  { key: "transactions", label: "transações" },
];

const ACTION_FILTERS = [
  { key: "all", label: "todas" },
  { key: "create", label: "criar" },
  { key: "update", label: "alterar" },
  { key: "delete", label: "remover" },
];

const PAGE_SIZE = 50;

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ entity?: string; action?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const entityKey = sp.entity ?? "all";
  const actionKey = sp.action ?? "all";
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const supabase = await createClient();
  let q = supabase
    .from("audit_log")
    .select(
      "id, occurred_at, entity_type, entity_id, action, before, after, context",
      { count: "exact" },
    )
    .order("occurred_at", { ascending: false })
    .range(from, to);

  if (entityKey !== "all") q = q.eq("entity_type", entityKey);
  if (actionKey !== "all") q = q.eq("action", actionKey as AuditAction);

  const { data, count } = await q;
  const rows = data ?? [];
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const buildHref = (next: { entity?: string; action?: string; page?: number }) => {
    const params = new URLSearchParams();
    const e = next.entity ?? entityKey;
    const a = next.action ?? actionKey;
    const p = next.page ?? page;
    if (e !== "all") params.set("entity", e);
    if (a !== "all") params.set("action", a);
    if (p !== 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/audit?${qs}` : "/audit";
  };

  return (
    <main id="main" tabIndex={-1} className="mx-auto w-full max-w-5xl flex-1 px-6 py-12 lg:px-12 lg:py-16">
      <header className="mb-10 flex items-end justify-between gap-4">
        <div>
          <span className="label">auditoria</span>
          <h2 className="mt-2">tudo que aconteceu</h2>
        </div>
        <ExportCsvButton
          entity={entityKey === "all" ? undefined : entityKey}
          action={actionKey === "all" ? undefined : actionKey}
        />
      </header>

      <section className="mb-6 flex flex-col gap-3">
        <nav className="flex flex-wrap gap-1">
          {ENTITY_FILTERS.map((f) => {
            const active = entityKey === f.key;
            return (
              <Link
                key={f.key}
                href={buildHref({ entity: f.key, page: 1 })}
                className="rounded-[var(--radius-sm)] px-3 py-1.5 text-xs uppercase tracking-[0.18em] transition-colors"
                style={{
                  color: active
                    ? "var(--color-ink-display)"
                    : "var(--color-ink-muted)",
                  backgroundColor: active
                    ? "var(--color-surface-2)"
                    : "transparent",
                }}
              >
                {f.label}
              </Link>
            );
          })}
        </nav>
        <nav className="flex flex-wrap gap-1">
          {ACTION_FILTERS.map((f) => {
            const active = actionKey === f.key;
            return (
              <Link
                key={f.key}
                href={buildHref({ action: f.key, page: 1 })}
                className="rounded-[var(--radius-sm)] px-3 py-1 text-[10px] uppercase tracking-[0.18em] transition-colors"
                style={{
                  color: active
                    ? "var(--color-ink)"
                    : "var(--color-ink-faint)",
                  backgroundColor: active
                    ? "var(--color-surface-2)"
                    : "transparent",
                }}
              >
                {f.label}
              </Link>
            );
          })}
        </nav>
      </section>

      <p className="mb-4 text-xs text-[var(--color-ink-muted)]">
        {total} {total === 1 ? "evento" : "eventos"} · página {page} / {totalPages}
      </p>

      {rows.length === 0 ? (
        <p className="card p-8 text-sm text-[var(--color-ink-muted)]">
          nada por aqui — sem eventos para os filtros aplicados.
        </p>
      ) : (
        <ol className="flex flex-col gap-[2px] overflow-hidden rounded-[var(--radius-sm)] bg-[var(--color-line)]">
          {rows.map((row) => (
            <li
              key={row.id}
              className="bg-[var(--color-surface-2)]"
            >
              <details className="group">
                <summary className="grid cursor-pointer list-none grid-cols-[auto_auto_1fr_auto] items-center gap-3 px-4 py-3 hover:bg-[color-mix(in_srgb,var(--color-surface-2)_94%,transparent)]">
                  <span className="num text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-muted)]">
                    {fmt.datetime(row.occurred_at)}
                  </span>
                  <span
                    className="num text-[10px] uppercase tracking-[0.18em]"
                    style={{ color: ACTION_COLOR[row.action] }}
                  >
                    {ACTION_LABEL[row.action]}
                  </span>
                  <span className="truncate text-sm text-[var(--color-ink)]">
                    {ENTITY_LABEL[row.entity_type] ?? row.entity_type}
                    {row.entity_id && (
                      <span className="num text-[10px] text-[var(--color-ink-faint)]">
                        {" "}
                        · {row.entity_id.slice(0, 8)}
                      </span>
                    )}
                  </span>
                  <span className="label group-open:hidden">expandir</span>
                  <span className="label hidden group-open:block">recolher</span>
                </summary>
                <div className="border-t border-[var(--color-line-subtle)] bg-[var(--color-surface-1)] px-4 py-4">
                  <DiffView
                    action={row.action}
                    before={row.before}
                    after={row.after}
                  />
                </div>
              </details>
            </li>
          ))}
        </ol>
      )}

      {totalPages > 1 && (
        <nav className="mt-6 flex items-center justify-between">
          {page > 1 ? (
            <Link
              href={buildHref({ page: page - 1 })}
              className="label hover:text-[var(--color-ink)]"
            >
              ← anterior
            </Link>
          ) : (
            <span />
          )}
          {page < totalPages ? (
            <Link
              href={buildHref({ page: page + 1 })}
              className="label hover:text-[var(--color-ink)]"
            >
              próxima →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </main>
  );
}

function DiffView({
  action,
  before,
  after,
}: {
  action: AuditAction;
  before: Json | null;
  after: Json | null;
}) {
  if (action === "create" || action === "restore") {
    return <Snapshot data={after} title="depois" />;
  }
  if (action === "delete" || action === "soft_delete") {
    return <Snapshot data={before} title="antes" />;
  }

  // update — show changed keys only
  const beforeObj = isObj(before) ? before : {};
  const afterObj = isObj(after) ? after : {};
  const keys = Array.from(
    new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)]),
  ).filter((k) => !shallowEqual(beforeObj[k], afterObj[k]));

  if (keys.length === 0) {
    return (
      <p className="text-xs italic text-[var(--color-ink-muted)]">
        sem campos alterados.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {keys.map((k) => (
        <li key={k} className="grid grid-cols-[auto_1fr_auto_1fr] items-baseline gap-3">
          <span className="num text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-muted)]">
            {k}
          </span>
          <code className="num truncate text-xs text-[var(--color-ink-muted)] line-through">
            {format(beforeObj[k])}
          </code>
          <span className="num text-[10px] text-[var(--color-ink-faint)]">→</span>
          <code className="num truncate text-xs text-[var(--color-ink-display)]">
            {format(afterObj[k])}
          </code>
        </li>
      ))}
    </ul>
  );
}

function Snapshot({ data, title }: { data: Json | null; title: string }) {
  if (!isObj(data)) {
    return (
      <p className="text-xs italic text-[var(--color-ink-muted)]">
        sem snapshot.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <span className="label">{title}</span>
      <ul className="flex flex-col gap-1">
        {Object.entries(data).map(([k, v]) => (
          <li
            key={k}
            className="grid grid-cols-[160px_1fr] items-baseline gap-3"
          >
            <span className="num text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-muted)]">
              {k}
            </span>
            <code className="num truncate text-xs text-[var(--color-ink)]">
              {format(v)}
            </code>
          </li>
        ))}
      </ul>
    </div>
  );
}

function isObj(v: unknown): v is Record<string, Json | undefined> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a === "object") return JSON.stringify(a) === JSON.stringify(b);
  return false;
}

function format(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

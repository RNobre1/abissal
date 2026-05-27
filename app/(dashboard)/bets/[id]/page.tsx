import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fmt } from "@/lib/format";
import type { Database } from "@/lib/supabase/types";
import { ResolveForm } from "./resolve-form";
import { SelectionsList } from "./selections-list";

type BetStatus = Database["public"]["Enums"]["bet_status"];
type BetKind = Database["public"]["Enums"]["bet_kind"];
type BetEventType = Database["public"]["Enums"]["bet_event_type"];

const STATUS_LABEL: Record<BetStatus, string> = {
  pending: "pendente",
  won: "ganha",
  lost: "perdida",
  void: "anulada",
  cashed_out: "cash-out",
  half_won: "meia ganha",
  half_lost: "meia perdida",
  partially_void: "parcial anulada",
};

const KIND_LABEL: Record<BetKind, string> = {
  single: "simples",
  multiple: "múltipla",
  system: "sistema",
  bet_builder: "bet builder",
};

const EVENT_LABEL: Record<BetEventType, string> = {
  placed: "criada",
  edited: "editada",
  resolved: "resolvida",
  voided: "anulada",
  cashed_out: "cash-out",
  reopened: "reaberta",
};

const TX_KIND_LABEL: Record<string, string> = {
  bet_stake: "stake",
  bet_return: "retorno",
  deposit: "depósito",
  withdrawal: "saque",
  bonus_credit: "bônus",
  bonus_rollover: "rollover",
  fee: "taxa",
  adjustment_credit: "ajuste +",
  adjustment_debit: "ajuste −",
  transfer_in: "transf. ←",
  transfer_out: "transf. →",
};

function statusColor(s: BetStatus): string {
  if (s === "won" || s === "half_won" || s === "cashed_out")
    return "var(--color-depth-hi)";
  if (s === "lost" || s === "half_lost") return "var(--color-vermelho-hi)";
  if (s === "void" || s === "partially_void") return "var(--color-ink-muted)";
  return "var(--color-ink-display)";
}

export default async function BetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [betQuery, selectionsQuery, txsQuery, eventsQuery, housesQuery] =
    await Promise.all([
      supabase.from("bets").select("*").eq("id", id).maybeSingle(),
      supabase
        .from("bet_selections")
        .select("*")
        .eq("bet_id", id)
        .order("position_index"),
      supabase
        .from("transactions")
        .select("id, kind, direction, amount, occurred_at, note")
        .eq("related_bet_id", id)
        .order("occurred_at"),
      supabase
        .from("bet_events")
        .select("*")
        .eq("bet_id", id)
        .order("occurred_at"),
      supabase.from("houses").select("id, name, color_hex"),
    ]);

  const bet = betQuery.data;
  if (!bet) notFound();

  const selections = selectionsQuery.data ?? [];
  const txs = txsQuery.data ?? [];
  const events = eventsQuery.data ?? [];
  const house = (housesQuery.data ?? []).find((h) => h.id === bet.house_id);

  const isPending = bet.status === "pending";
  const pl =
    bet.actual_return != null
      ? Number(bet.actual_return) - Number(bet.total_stake)
      : null;

  return (
    <main id="main" tabIndex={-1} className="mx-auto w-full max-w-3xl flex-1 px-6 py-12 lg:px-12 lg:py-16">
      <header className="mb-10">
        <Link
          href="/bets"
          className="label hover:text-[var(--color-ink)]"
        >
          ← apostas
        </Link>
        <div className="mt-4 flex items-end justify-between gap-4">
          <div>
            <span className="label">{KIND_LABEL[bet.kind]}</span>
            <h2 className="mt-2">
              {selections[0]?.event_label ?? "aposta"}
              {selections.length > 1 && (
                <span className="num text-base text-[var(--color-ink-muted)]">
                  {" "}
                  + {selections.length - 1}
                </span>
              )}
            </h2>
          </div>
          <span
            className="num text-xs uppercase tracking-[0.18em]"
            style={{ color: statusColor(bet.status) }}
          >
            {STATUS_LABEL[bet.status]}
          </span>
        </div>
      </header>

      <section className="mb-10 grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius)] border border-[var(--color-line)] bg-[var(--color-line)] md:grid-cols-4">
        <Stat
          label="casa"
          value={house?.name ?? "—"}
          accent={house?.color_hex ?? null}
        />
        <Stat label="stake" value={fmt.currency(Number(bet.total_stake))} mono />
        <Stat
          label="odd combinada"
          value={fmt.number(Number(bet.total_odds))}
          mono
        />
        {isPending ? (
          <Stat
            label="retorno esperado"
            value={fmt.currency(Number(bet.expected_return))}
            mono
            tone="depth"
          />
        ) : (
          <Stat
            label="P/L"
            value={pl != null ? fmt.signed(pl) : "—"}
            mono
            tone={pl != null && pl >= 0 ? "depth" : "vermelho"}
          />
        )}
      </section>

      <section className="mb-10">
        <span className="label">seleções</span>
        <div className="mt-4">
          <SelectionsList selections={selections} kind={bet.kind} />
        </div>
      </section>

      {bet.note && (
        <section className="mb-10">
          <span className="label">nota</span>
          <p className="mt-3 whitespace-pre-wrap text-sm text-[var(--color-ink)]">
            {bet.note}
          </p>
        </section>
      )}

      {isPending && (
        <section className="mb-10">
          <span className="label">resolver</span>
          <div className="mt-4">
            <ResolveForm
              betId={bet.id}
              expectedReturn={Number(bet.expected_return)}
              totalStake={Number(bet.total_stake)}
            />
          </div>
        </section>
      )}

      {txs.length > 0 && (
        <section className="mb-10">
          <span className="label">transações vinculadas</span>
          <ol className="mt-4 flex flex-col gap-[2px] overflow-hidden rounded-[var(--radius-sm)] bg-[var(--color-line)]">
            {txs.map((t) => {
              const isIn = t.direction === "in";
              return (
                <li
                  key={t.id}
                  className="grid grid-cols-[auto_1fr_auto] items-center gap-4 bg-[var(--color-surface-2)] px-4 py-2.5"
                >
                  <span className="num text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-muted)]">
                    {fmt.datetime(t.occurred_at)}
                  </span>
                  <span className="truncate text-sm text-[var(--color-ink)]">
                    {TX_KIND_LABEL[t.kind] ?? t.kind}
                    {t.note && (
                      <span className="text-[var(--color-ink-muted)]">
                        {" "}
                        · {t.note}
                      </span>
                    )}
                  </span>
                  <span
                    className="num text-sm"
                    style={{
                      color: isIn
                        ? "var(--color-depth-hi)"
                        : "var(--color-ink)",
                    }}
                  >
                    {isIn ? "+" : "−"}
                    {fmt.currency(Number(t.amount))}
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {events.length > 0 && (
        <section>
          <span className="label">linha do tempo</span>
          <ol className="mt-4 flex flex-col gap-3 border-l border-[var(--color-line-subtle)] pl-4">
            {events.map((e) => (
              <li key={e.id} className="flex flex-col gap-0.5">
                <div className="flex items-baseline justify-between">
                  <span className="num text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink)]">
                    {EVENT_LABEL[e.event_type]}
                  </span>
                  <span className="num text-[10px] text-[var(--color-ink-muted)]">
                    {fmt.datetime(e.occurred_at)}
                  </span>
                </div>
                {e.from_status && e.to_status && (
                  <span className="num text-[10px] text-[var(--color-ink-muted)]">
                    {STATUS_LABEL[e.from_status]} → {STATUS_LABEL[e.to_status]}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}
    </main>
  );
}

function Stat({
  label,
  value,
  tone,
  mono,
  accent,
}: {
  label: string;
  value: string;
  tone?: "depth" | "vermelho";
  mono?: boolean;
  accent?: string | null;
}) {
  return (
    <div className="flex flex-col gap-2 bg-[var(--color-surface-2)] p-5">
      <div className="flex items-center gap-2">
        {accent && (
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: accent }}
            aria-hidden
          />
        )}
        <span className="label">{label}</span>
      </div>
      <span
        className={`${mono ? "num" : ""} text-lg`}
        style={{
          color:
            tone === "depth"
              ? "var(--color-depth-hi)"
              : tone === "vermelho"
                ? "var(--color-vermelho-hi)"
                : "var(--color-ink-display)",
        }}
      >
        {value}
      </span>
    </div>
  );
}

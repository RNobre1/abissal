import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { logoutAction } from "@/app/(auth)/login/actions";
import { CommandPalette } from "@/components/command-palette";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";
import { getDraftSlip } from "@/lib/bet-slip/actions";
import { BetSlipProvider } from "@/components/bet-slip/bet-slip-provider";

const NAV_GROUPS: Array<{
  label: string;
  items: Array<{ href: string; label: string }>;
}> = [
  {
    label: "operação",
    items: [
      { href: "/", label: "overview" },
      { href: "/banca", label: "banca" },
      { href: "/houses", label: "casas" },
      { href: "/transactions", label: "transações" },
      { href: "/bets", label: "apostas" },
      { href: "/bilhete", label: "bilhete" },
      { href: "/forecast", label: "previsão" },
    ],
  },
  {
    label: "análise",
    items: [
      { href: "/fixtures", label: "fixtures" },
      { href: "/explore", label: "explorar" },
      { href: "/calibracao", label: "calibração" },
    ],
  },
  {
    label: "sistema",
    items: [
      { href: "/audit", label: "auditoria" },
      { href: "/logs", label: "logs IA" },
      { href: "/llm-observability", label: "observability IA" },
      { href: "/admin/telemetry", label: "telemetria" },
    ],
  },
];

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // O middleware (`lib/supabase/middleware.ts`) já chamou `getUser()` (round-trip
  // de rede canônico) e redirecionou não-autenticados antes de o layout rodar.
  // Aqui usamos `getClaims()`, que verifica a assinatura do JWT criptograficamente
  // via JWKS do projeto (sem round-trip de rede após o fetch inicial cacheado),
  // apenas para obter os metadados de exibição (display_name / email).
  // O `redirect` abaixo é um gate defensivo para o caso improvável de o
  // middleware não cobrir a rota — não é a validação primária de autenticação.
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();

  const claims = data?.claims ?? null;

  if (!claims) redirect("/login");

  const display =
    (claims.user_metadata?.display_name as string | undefined) ??
    (claims.email as string | undefined)?.split("@")[0] ??
    "you";

  // Bet slip — fetch draft slip + houses for FAB/drawer (graceful degradation on error)
  const [draftSlip, housesResult] = await Promise.all([
    getDraftSlip().catch(() => null),
    Promise.resolve(
      supabase
        .from("houses")
        .select("id, name")
        .is("archived_at", null)
        .order("name"),
    )
      .then((res: { data: Array<{ id: string; name: string }> | null }) => res.data ?? [])
      .catch(() => [] as Array<{ id: string; name: string }>),
  ]);

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      {/* Desktop sidebar */}
      <aside className="hidden border-r border-[var(--color-line-subtle)] bg-[var(--color-surface-1)] lg:flex lg:w-64 lg:flex-col lg:px-6 lg:py-8">
        <Link href="/" className="block">
          <span className="label">abissal</span>
          <p
            className="mt-2 font-[var(--font-display)] text-2xl italic leading-none"
            style={{ color: "var(--color-vermelho)" }}
          >
            habitada
          </p>
        </Link>

        <nav className="mt-12 flex flex-col gap-6">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="flex flex-col gap-1">
              <span className="label mb-1 text-[var(--color-ink-faint)]">
                {group.label}
              </span>
              {group.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-[var(--radius-sm)] px-3 py-2 text-sm text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
                >
                  {item.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>

        <div className="mt-auto flex items-center justify-between border-t border-[var(--color-line-subtle)] pt-4">
          <span className="num text-xs text-[var(--color-ink-muted)]">
            {display}
          </span>
          <form action={logoutAction}>
            <button
              type="submit"
              className="label hover:text-[var(--color-vermelho)]"
            >
              sair
            </button>
          </form>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex flex-1 flex-col pb-20 lg:pb-0">{children}</div>

      <CommandPalette />

      <MobileBottomNav />

      {/* Bet slip FAB + Drawer — always-visible when draft slip has legs */}
      <BetSlipProvider initialSlip={draftSlip} houses={housesResult} />
    </div>
  );
}

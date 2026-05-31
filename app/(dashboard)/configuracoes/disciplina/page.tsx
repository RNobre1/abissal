import { createClient } from "@/lib/supabase/server";
import { authedUserId } from "@/lib/supabase/auth";
import { redirect } from "next/navigation";
import { DisciplinaSettingsForm } from "./_components/disciplina-settings-form";
import type { DisciplinaSettingsValues } from "./_components/disciplina-settings-form";

export const metadata = {
  title: "Disciplina · Abissal",
  description: "Configurações de fricção ética: stop-loss, cooldown pós-loss, quiet mode, thesis gate.",
};

export default async function DisciplinaSettingsPage() {
  const supabase = await createClient();
  const userId = await authedUserId(supabase);

  if (!userId) redirect("/login");

  // Busca settings existentes (graceful: tabela pode não existir em dev sem migration)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawSettings } = await (supabase as any)
    .from("disciplina_settings")
    .select(
      "stop_loss_daily_pct, max_bets_per_day, cooldown_after_loss_min, quiet_mode_drawdown_pct, thesis_gate_enabled, quiet_mode_enabled",
    )
    .eq("user_id", userId)
    .maybeSingle();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const settings = rawSettings as Record<string, any> | null;

  const initialSettings: DisciplinaSettingsValues = settings
    ? {
        stop_loss_daily_pct: settings.stop_loss_daily_pct != null
          ? Number(settings.stop_loss_daily_pct)
          : null,
        max_bets_per_day: settings.max_bets_per_day != null
          ? Number(settings.max_bets_per_day)
          : null,
        cooldown_after_loss_min: Number(settings.cooldown_after_loss_min ?? 60),
        quiet_mode_drawdown_pct: Number(settings.quiet_mode_drawdown_pct ?? 5),
        thesis_gate_enabled: Boolean(settings.thesis_gate_enabled ?? true),
        quiet_mode_enabled: Boolean(settings.quiet_mode_enabled ?? true),
      }
    : null;

  return (
    <main
      id="main"
      tabIndex={-1}
      className="mx-auto w-full max-w-2xl flex-1 px-6 py-12 lg:px-12 lg:py-16"
    >
      <header className="mb-10">
        <span className="label">configurações · disciplina</span>
        <h1 className="mt-4">fricção ética</h1>
        <p className="mt-4 max-w-prose text-sm text-[var(--color-ink-muted)]">
          Configure limites para proteger sua banca de decisões impulsivas.
          Bloqueios são aplicados server-side — não podem ser contornados
          pelo frontend.
        </p>
      </header>

      <div className="card p-6">
        <DisciplinaSettingsForm initialSettings={initialSettings} />
      </div>

      <section className="mt-8 card p-5">
        <h2 className="label mb-3">kill switches de ambiente</h2>
        <p className="text-sm text-[var(--color-ink-muted)]">
          As variáveis de ambiente abaixo sobrepõem os toggles da UI quando
          definidas como <code className="num text-xs">false</code>:
        </p>
        <ul className="mt-3 flex flex-col gap-1 text-sm">
          <li>
            <code className="num text-xs text-[var(--color-ink)]">
              FRICAO_THESIS_GATE_ENABLED
            </code>{" "}
            <span className="text-[var(--color-ink-muted)]">
              — desabilita thesis gate completamente (default: habilitado)
            </span>
          </li>
          <li>
            <code className="num text-xs text-[var(--color-ink)]">
              FRICAO_QUIET_MODE_ENABLED
            </code>{" "}
            <span className="text-[var(--color-ink-muted)]">
              — desabilita quiet mode completamente (default: habilitado)
            </span>
          </li>
        </ul>
      </section>
    </main>
  );
}

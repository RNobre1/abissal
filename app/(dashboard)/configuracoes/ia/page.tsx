import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { authedUserId } from "@/lib/supabase/auth";
import { isAiEnabled } from "@/lib/settings/ai-toggle";
import { AiToggleForm } from "./_components/ai-toggle-form";

export const metadata = {
  title: "Inteligência Artificial · Abissal",
  description:
    "Kill switch global de IA: liga/desliga o recomendador, a análise on-demand e o OCR de bilhete.",
};

export default async function IaSettingsPage() {
  const supabase = await createClient();
  const userId = await authedUserId(supabase);
  if (!userId) redirect("/login");

  const enabled = await isAiEnabled(supabase);

  return (
    <main
      id="main"
      tabIndex={-1}
      className="mx-auto w-full max-w-2xl flex-1 px-6 py-12 lg:px-12 lg:py-16"
    >
      <header className="mb-10">
        <span className="label">configurações · inteligência artificial</span>
        <h1 className="mt-4">kill switch de IA</h1>
        <p className="mt-4 max-w-prose text-sm text-[var(--color-ink-muted)]">
          Desligue todo o uso de IA do sistema num clique — útil quando os
          créditos do OpenRouter acabam ou em períodos sem jogos relevantes.
          Afeta as três frentes que consomem LLM: o recomendador diário (cron),
          o botão de análise on-demand e o OCR de foto de bilhete. A simulação
          estatística (Monte Carlo) NÃO usa IA e continua rodando normalmente.
        </p>
      </header>

      <div className="card p-6">
        <AiToggleForm initialEnabled={enabled} />
      </div>

      <p className="mt-6 text-sm text-[var(--color-ink-muted)]">
        <Link
          href="/configuracoes/disciplina"
          className="underline hover:text-[var(--color-ink)]"
        >
          ← disciplina (fricção ética)
        </Link>
      </p>
    </main>
  );
}

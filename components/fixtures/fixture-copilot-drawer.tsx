"use client";

import { useEffect, useRef, useState } from "react";
import { MessageCircle, X, ArrowRight, Wrench } from "lucide-react";
import { ChatMessageView, type ChatMessage } from "./chat-message";

interface FixtureCopilotDrawerProps {
  fixtureId: number;
  homeTeam: string;
  awayTeam: string;
}

interface Hop {
  tool: string;
  args: unknown;
  result_summary: string;
  took_ms: number;
}

interface CopilotMeta {
  model: string;
  latency_ms: number;
  hops: Hop[];
  usage_total: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  reasoning?: string;
}

/**
 * Floating Action Button + bottom-sheet (mobile) / right-side (desktop) drawer
 * that hosts the per-fixture Copilot chat. Mirrors {@link CopilotFab}'s proven
 * FAB + drawer / ESC / scroll-lock / focus pattern.
 *
 * Deliberate divergence from {@link CopilotFab}: the tool-call steps render
 * ALWAYS in the chat (see {@link FixtureToolSteps}) — they are NOT hidden
 * behind the `showLog` dev flag. The per-fixture copilot treats tool
 * transparency as a product requirement, not a debug affordance.
 */
export function FixtureCopilotDrawer({
  fixtureId,
  homeTeam,
  awayTeam,
}: FixtureCopilotDrawerProps) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messagesMeta, setMessagesMeta] = useState<Record<number, CopilotMeta>>(
    {},
  );
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [useReasoner, setUseReasoner] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const SUGGESTIONS: ReadonlyArray<string> = [
    `Resumo do ${homeTeam} x ${awayTeam} para aposta`,
    "Quais insights têm valor neste jogo?",
    "Como estão os splits de 1º vs 2º tempo?",
    "O árbitro puxa cartão?",
  ];

  useEffect(() => {
    try {
      const reasoner =
        window.localStorage.getItem("abissal:dev-reasoner") === "1";
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setUseReasoner(reasoner);
    } catch {
      /* SSR / Safari private */
    }
  }, []);

  // ESC closes the drawer + body scroll lock while open.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Defer focus so the slide-in animation finishes first.
    const t = window.setTimeout(() => inputRef.current?.focus(), 120);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      window.clearTimeout(t);
    };
  }, [open]);

  // Auto-scroll to bottom whenever a new message lands.
  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, pending]);

  async function send(question: string) {
    const q = question.trim();
    if (!q || pending) return;
    const newMessages: ChatMessage[] = [
      ...messages,
      { role: "user", content: q },
    ];
    setMessages(newMessages);
    setInput("");
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/fixture-copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fixture_id: fixtureId,
          reasoner: useReasoner,
          messages: newMessages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });
      // Parse defensivo: usa res.text() + JSON.parse para nunca lançar erro cru
      // de JSON quando a plataforma devolve HTML (e.g. Cloudflare Workers kill).
      const raw = await res.text();
      let body: { content?: string; error?: string; meta?: CopilotMeta } | null = null;
      try {
        const parsed: unknown = raw ? JSON.parse(raw) : null;
        if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
          body = parsed as { content?: string; error?: string; meta?: CopilotMeta };
        }
      } catch {
        body = null;
      }
      if (!res.ok || !body) {
        setError(
          body?.error ??
            "O copilot demorou demais ou falhou. Tente uma pergunta mais específica sobre o jogo.",
        );
        return;
      }
      setMessages((prev) => {
        const next: ChatMessage[] = [
          ...prev,
          { role: "assistant", content: body.content ?? "" },
        ];
        if (body.meta) {
          setMessagesMeta((m) => ({ ...m, [next.length - 1]: body.meta! }));
        }
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "erro desconhecido");
    } finally {
      setPending(false);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    void send(input);
  }

  return (
    <>
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Abrir copilot do jogo"
          className="fixed right-4 bottom-20 z-40 flex h-14 w-14 items-center justify-center rounded-full text-[var(--color-ink-display)] shadow-xl transition-transform hover:scale-105 active:scale-95 lg:bottom-6 lg:right-6"
          style={{ backgroundColor: "var(--color-vermelho)" }}
        >
          <MessageCircle size={22} strokeWidth={1.75} aria-hidden />
        </button>
      ) : null}

      {open ? (
        <div className="fixed inset-0 z-[60] flex">
          <button
            type="button"
            aria-label="Fechar copilot"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />
          <section
            role="dialog"
            aria-modal="true"
            aria-label={`Copilot do jogo ${homeTeam} x ${awayTeam}`}
            className="relative ml-auto flex h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl border-t border-[var(--color-line)] bg-[var(--color-surface-1)] motion-safe:animate-in motion-safe:slide-in-from-bottom motion-safe:duration-300 mt-auto lg:h-full lg:max-w-[480px] lg:rounded-none lg:border-t-0 lg:border-l lg:motion-safe:slide-in-from-right"
          >
            <header className="flex items-center justify-between border-b border-[var(--color-line-subtle)] px-5 py-4">
              <div>
                <span className="label">copilot do jogo</span>
                <h3 className="mt-1 text-lg">
                  {homeTeam}{" "}
                  <span className="text-[var(--color-ink-muted)]">x</span>{" "}
                  {awayTeam}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Fechar"
                className="rounded-[var(--radius-sm)] border border-[var(--color-line-subtle)] p-1.5 text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
              >
                <X size={16} strokeWidth={1.75} />
              </button>
            </header>

            <div
              ref={scrollRef}
              className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-4"
              aria-live="polite"
            >
              {messages.length === 0 ? (
                <div className="flex flex-col gap-2">
                  <p className="text-sm italic text-[var(--color-ink-muted)]">
                    Pergunte sobre este jogo. Exemplos:
                  </p>
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => void send(s)}
                      className="card card-hover px-4 py-3 text-left text-sm text-[var(--color-ink)]"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              ) : (
                messages.map((m, i) => (
                  <div key={i} className="flex flex-col gap-2">
                    {m.role === "assistant" && messagesMeta[i] ? (
                      <FixtureToolSteps hops={messagesMeta[i].hops} />
                    ) : null}
                    <ChatMessageView message={m} />
                  </div>
                ))
              )}

              {pending ? <DrawerLoader /> : null}

              {error ? (
                <p
                  className="text-sm"
                  style={{ color: "var(--color-vermelho)" }}
                  role="alert"
                >
                  {error}
                </p>
              ) : null}
            </div>

            <form
              onSubmit={onSubmit}
              className="flex items-center gap-2 border-t border-[var(--color-line-subtle)] px-5 py-3"
            >
              <label htmlFor="fixture-copilot-input" className="sr-only">
                Pergunta
              </label>
              <input
                ref={inputRef}
                id="fixture-copilot-input"
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={pending}
                placeholder="pergunte sobre este jogo…"
                className="flex-1 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-ink)] placeholder-[var(--color-ink-muted)] focus:border-[var(--color-line-strong)] focus:outline-none disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={pending || !input.trim()}
                aria-label="Enviar"
                className="rounded-[var(--radius-sm)] p-2 text-[var(--color-ink-display)] disabled:opacity-50"
                style={{ backgroundColor: "var(--color-vermelho)" }}
              >
                <ArrowRight size={16} strokeWidth={2} />
              </button>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}

/** Passos de tool SEMPRE visíveis no chat (requisito de transparência do spec). */
function FixtureToolSteps({ hops }: { hops: Hop[] }) {
  if (!hops || hops.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      {hops.map((h, i) => {
        const isErr = h.result_summary.startsWith("error:");
        return (
          <div
            key={i}
            className="flex flex-col gap-0.5 rounded-[var(--radius-sm)] border border-[var(--color-line-subtle)] bg-[var(--color-surface-2)] px-3 py-1.5 font-mono text-[11px] leading-relaxed"
          >
            <span className="flex items-center gap-1.5 text-[var(--color-ink)]">
              <Wrench
                size={11}
                strokeWidth={2}
                aria-hidden
                style={{ color: "var(--color-vermelho)" }}
              />
              <span style={{ color: "var(--color-vermelho)" }}>{h.tool}</span>
              <span className="text-[var(--color-ink-faint)]">
                · {JSON.stringify(h.args)} · {h.took_ms} ms
              </span>
            </span>
            <span
              style={{
                color: isErr
                  ? "var(--color-vermelho)"
                  : "var(--color-ink-muted)",
              }}
            >
              {isErr ? "✗" : "✓"} {h.result_summary}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function DrawerLoader() {
  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-1.5" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="block h-1.5 w-1.5 rounded-full motion-safe:animate-bounce"
            style={{
              animationDelay: `${i * 140}ms`,
              backgroundColor: "var(--color-vermelho)",
            }}
          />
        ))}
      </div>
      <span className="label text-[var(--color-ink-faint)]">
        analisando o jogo…
      </span>
    </div>
  );
}

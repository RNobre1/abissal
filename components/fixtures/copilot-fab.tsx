"use client";

import { useEffect, useRef, useState } from "react";
import { MessageCircle, X, ArrowRight } from "lucide-react";
import { ChatMessageView, type ChatMessage } from "./chat-message";
import { CopilotToolSteps } from "./copilot-tool-steps";

interface CopilotFabProps {
  /** "today" / "tomorrow" / "YYYY-MM-DD" — passed as a hint to the backend. */
  date: string;
}

interface CopilotMeta {
  model: string;
  latency_ms: number;
  hops: Array<{
    tool: string;
    args: unknown;
    result_summary: string;
    took_ms: number;
  }>;
  usage_total: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  reasoning?: string;
}

const SUGGESTIONS: ReadonlyArray<string> = [
  "Quais jogos hoje têm cartão alto?",
  "Tem algum jogo com over alto?",
  "Quais ligas têm jogos hoje?",
  "Algum confronto com sequência de gols no 1º tempo?",
];

/**
 * Floating Action Button (bottom-right) + bottom-sheet drawer (mobile) /
 * right-side drawer (desktop) that hosts the fixtures-day Copilot chat.
 *
 * Talks to POST /api/copilot, which runs a tool-call loop on OpenRouter to
 * query the fixtures DB and answer natural-language questions about the day.
 *
 * The FAB sits above the mobile bottom-nav (which is fixed at bottom-0) and
 * close to the edge on desktop. While the drawer is open the FAB hides so
 * it doesn't compete with the close button.
 */
export function CopilotFab({ date }: CopilotFabProps) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messagesMeta, setMessagesMeta] = useState<Record<number, CopilotMeta>>(
    {},
  );
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [useReasoner, setUseReasoner] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      const log = window.localStorage.getItem("abissal:dev-log") === "1";
      const reasoner =
        window.localStorage.getItem("abissal:dev-reasoner") === "1";
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShowLog(log);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setUseReasoner(reasoner);
    } catch {
      /* SSR / Safari private mode */
    }
  }, []);

  function toggleReasoner() {
    setUseReasoner((v) => {
      const next = !v;
      try {
        window.localStorage.setItem(
          "abissal:dev-reasoner",
          next ? "1" : "0",
        );
      } catch {
        /* ignore */
      }
      return next;
    });
  }

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
      const res = await fetch("/api/copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          reasoner: useReasoner,
          messages: newMessages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const body = (await res.json()) as {
        content?: string;
        error?: string;
        meta?: CopilotMeta;
      };
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`);
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
          aria-label="Abrir copilot"
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
            aria-label="Copilot de fixtures"
            className="relative ml-auto flex h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl border-t border-[var(--color-line)] bg-[var(--color-surface-1)] motion-safe:animate-in motion-safe:slide-in-from-bottom motion-safe:duration-300 mt-auto lg:h-full lg:max-w-[480px] lg:rounded-none lg:border-t-0 lg:border-l lg:motion-safe:slide-in-from-right"
          >
            <header className="flex items-center justify-between border-b border-[var(--color-line-subtle)] px-5 py-4">
              <div>
                <span className="label">copilot</span>
                <h3 className="mt-1 text-lg">jogos do dia</h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={toggleReasoner}
                  aria-pressed={useReasoner}
                  title="Usar DeepSeek R1 com raciocínio (mais caro/lento)"
                  className="label inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-line-subtle)] px-2 py-1 text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
                >
                  <span
                    aria-hidden
                    className="inline-block h-1.5 w-1.5 rounded-full"
                    style={{
                      backgroundColor: useReasoner
                        ? "var(--color-vermelho)"
                        : "var(--color-ink-faint)",
                    }}
                  />
                  R1
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Fechar"
                  className="rounded-[var(--radius-sm)] border border-[var(--color-line-subtle)] p-1.5 text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
                >
                  <X size={16} strokeWidth={1.75} />
                </button>
              </div>
            </header>

            <div
              ref={scrollRef}
              className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-4"
              aria-live="polite"
            >
              {messages.length === 0 ? (
                <div className="flex flex-col gap-2">
                  <p className="text-sm italic text-[var(--color-ink-muted)]">
                    Pergunte algo sobre os jogos. Exemplos:
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
                    {m.role === "assistant" && messagesMeta[i]?.reasoning ? (
                      <CopilotReasoningDetails
                        content={messagesMeta[i].reasoning!}
                      />
                    ) : null}
                    <ChatMessageView message={m} />
                    {m.role === "assistant" && messagesMeta[i] ? (
                      <CopilotToolSteps hops={messagesMeta[i].hops} />
                    ) : null}
                    {showLog && m.role === "assistant" && messagesMeta[i] ? (
                      <CopilotLogDetails meta={messagesMeta[i]} />
                    ) : null}
                  </div>
                ))
              )}

              {pending ? <CopilotLoader /> : null}

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
              <label htmlFor="copilot-input" className="sr-only">
                Pergunta
              </label>
              <input
                ref={inputRef}
                id="copilot-input"
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={pending}
                placeholder="pergunte sobre os jogos do dia…"
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

function CopilotReasoningDetails({ content }: { content: string }) {
  return (
    <details className="rounded-[var(--radius-sm)] border border-dashed border-[var(--color-line-subtle)] bg-[var(--color-surface-2)]">
      <summary className="label cursor-pointer select-none px-3 py-2 text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]">
        raciocínio — {content.length} chars
      </summary>
      <pre className="overflow-x-auto whitespace-pre-wrap break-words px-3 pb-3 font-mono text-[11px] leading-relaxed text-[var(--color-ink-muted)]">
        {content}
      </pre>
    </details>
  );
}

function CopilotLogDetails({ meta }: { meta: CopilotMeta }) {
  return (
    <details className="rounded-[var(--radius-sm)] border border-[var(--color-line-subtle)] bg-[var(--color-surface-2)]">
      <summary className="label cursor-pointer select-none px-3 py-2 text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]">
        log do turno ({meta.hops.length} tool{meta.hops.length === 1 ? "" : "s"})
      </summary>
      <div className="flex flex-col gap-3 px-3 pb-3 font-mono text-[11px] leading-relaxed">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt className="text-[var(--color-ink-faint)]">modelo</dt>
          <dd className="text-[var(--color-ink-muted)]">{meta.model}</dd>
          <dt className="text-[var(--color-ink-faint)]">latência</dt>
          <dd className="text-[var(--color-ink-muted)]">{meta.latency_ms} ms</dd>
          <dt className="text-[var(--color-ink-faint)]">tokens in</dt>
          <dd className="text-[var(--color-ink-muted)]">
            {meta.usage_total.prompt_tokens}
          </dd>
          <dt className="text-[var(--color-ink-faint)]">tokens out</dt>
          <dd className="text-[var(--color-ink-muted)]">
            {meta.usage_total.completion_tokens}
          </dd>
        </dl>
        {meta.hops.length > 0 ? (
          <div className="flex flex-col gap-2">
            <span className="label text-[var(--color-ink-faint)]">
              tool calls
            </span>
            {meta.hops.map((h, i) => (
              <div
                key={i}
                className="rounded-[var(--radius-sm)] border border-[var(--color-line-subtle)] p-2"
              >
                <div className="text-[var(--color-ink)]">
                  <span className="text-[var(--color-vermelho)]">{h.tool}</span>
                  <span className="text-[var(--color-ink-faint)]">
                    {" "}
                    · {h.took_ms} ms
                  </span>
                </div>
                <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words text-[var(--color-ink-muted)]">
                  args: {JSON.stringify(h.args, null, 2)}
                </pre>
                <pre className="mt-1 whitespace-pre-wrap break-words text-[var(--color-ink-muted)]">
                  → {h.result_summary}
                </pre>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </details>
  );
}

function CopilotLoader() {
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
        consultando os jogos…
      </span>
    </div>
  );
}

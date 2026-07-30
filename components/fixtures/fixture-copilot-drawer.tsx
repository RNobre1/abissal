"use client";

import { useEffect, useRef, useState } from "react";
import { MessageCircle, X, ArrowRight, Wrench } from "lucide-react";
import { MarkdownRenderer } from "./markdown-renderer";
import { useTelemetry } from "@/lib/telemetry/use-telemetry";

/**
 * FixtureCopilotDrawer — FAB "pergunte ao jogo" + drawer de chat do copilot
 * escopado a UM fixture (/api/fixture-copilot).
 *
 * - Streaming SSE: deltas viram texto ao vivo; cada tool chamada pelo modelo
 *   vira um chip SEMPRE visível (✓/✗) acima da resposta — transparência total.
 * - Estado do chat em memória do client (por fixture; some ao sair da página).
 * - Kill switch OFF (503 ai_disabled) → mensagem clara, nunca tela branca.
 * - Mobile-first: bottom sheet (92vh) no Galaxy S23 FE; painel lateral no lg+.
 */

interface FixtureCopilotDrawerProps {
  fixtureId: number;
  homeTeam: string;
  awayTeam: string;
}

interface HopView {
  tool: string;
  ok: boolean;
  result_summary: string;
  took_ms: number;
}

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
  /** Chips de tool exibidos acima da resposta do assistant. */
  hops?: HopView[];
}

export function FixtureCopilotDrawer({
  fixtureId,
  homeTeam,
  awayTeam,
}: FixtureCopilotDrawerProps) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const track = useTelemetry();

  const SUGGESTIONS: ReadonlyArray<string> = [
    `Resumo do ${homeTeam} x ${awayTeam} para aposta`,
    "Quais insights têm valor neste jogo?",
    "Como estão os splits de 1º vs 2º tempo?",
    "O árbitro puxa cartão?",
  ];

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = window.setTimeout(() => inputRef.current?.focus(), 120);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      window.clearTimeout(t);
    };
  }, [open]);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, pending]);

  function openDrawer() {
    setOpen(true);
    track("copilot_open", { fixture_id: fixtureId });
  }

  async function send(question: string) {
    const q = question.trim();
    if (!q || pending) return;
    const history = [...messages, { role: "user" as const, content: q }];
    setMessages(history);
    setInput("");
    setPending(true);
    setError(null);
    track("copilot_message_sent", { fixture_id: fixtureId });

    // Draft do assistant preenchido ao vivo pelos eventos SSE.
    const draft: ChatMsg = { role: "assistant", content: "", hops: [] };
    let draftMounted = false;
    const syncDraft = () => {
      const snapshot: ChatMsg = {
        role: "assistant",
        content: draft.content,
        hops: [...(draft.hops ?? [])],
      };
      if (!draftMounted) {
        draftMounted = true;
        setMessages((prev) => [...prev, snapshot]);
      } else {
        setMessages((prev) => [...prev.slice(0, -1), snapshot]);
      }
    };

    try {
      const res = await fetch("/api/fixture-copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fixture_id: fixtureId,
          messages: history.map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      if (!res.ok) {
        let body: { error?: string; ai_disabled?: boolean } = {};
        try {
          body = (await res.json()) as typeof body;
        } catch {
          /* corpo não-JSON */
        }
        setError(
          body.ai_disabled
            ? "IA desativada nas configurações."
            : (body.error ?? `HTTP ${res.status}`),
        );
        return;
      }

      await consumeSse(res, (event, data) => {
        if (event === "hop") {
          const h = data as HopView;
          draft.hops = [...(draft.hops ?? []), h];
          syncDraft();
        } else if (event === "delta") {
          const d = data as { text?: string };
          draft.content += d.text ?? "";
          syncDraft();
        } else if (event === "error") {
          const e = data as { message?: string };
          setError(e.message ?? "erro do copilot");
        }
        // "done" só encerra — meta fica no server (llm_request_logs).
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
          onClick={openDrawer}
          aria-label="Abrir copilot do jogo"
          className="fixed right-4 bottom-20 z-40 flex h-14 w-14 items-center justify-center rounded-full text-[var(--color-ink-display)] shadow-xl transition-transform hover:scale-105 active:scale-95 lg:right-6 lg:bottom-6"
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
            className="relative mt-auto ml-auto flex h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl border-t border-[var(--color-line)] bg-[var(--color-surface-1)] lg:h-full lg:max-w-[480px] lg:rounded-none lg:border-t-0 lg:border-l"
          >
            <header className="flex items-center justify-between border-b border-[var(--color-line-subtle)] px-5 py-4">
              <div>
                <span className="label">pergunte ao jogo</span>
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
                  <p className="text-sm text-[var(--color-ink-muted)] italic">
                    Pergunte sobre este jogo. Cada consulta que a IA fizer aos
                    dados aparece como um passo no chat. Exemplos:
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
                    {m.role === "assistant" && m.hops && m.hops.length > 0 ? (
                      <ToolSteps hops={m.hops} />
                    ) : null}
                    {m.role === "user" ? (
                      <p className="ml-8 rounded-[var(--radius-sm)] border border-[var(--color-line-subtle)] bg-[var(--color-surface-2)] px-4 py-2.5 text-sm text-[var(--color-ink)]">
                        {m.content}
                      </p>
                    ) : m.content ? (
                      <div className="text-sm leading-relaxed text-[var(--color-ink)]">
                        <MarkdownRenderer content={m.content} />
                      </div>
                    ) : null}
                  </div>
                ))
              )}
              {pending ? <DrawerLoader /> : null}
              {error ? (
                <p
                  role="alert"
                  className="text-sm"
                  style={{ color: "var(--color-vermelho)" }}
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

/**
 * Consome uma Response SSE chamando `onEvent(event, data)` por bloco.
 * Usa o reader do body quando disponível; degrada pra `res.text()` inteiro
 * (ambientes de teste sem streams) — o parse é o mesmo.
 */
async function consumeSse(
  res: Response,
  onEvent: (event: string, data: unknown) => void,
): Promise<void> {
  const handleBlock = (block: string) => {
    let event = "message";
    let data = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event: ")) event = line.slice(7).trim();
      else if (line.startsWith("data: ")) data += line.slice(6);
    }
    if (!data) return;
    try {
      onEvent(event, JSON.parse(data));
    } catch {
      /* bloco malformado — tolera */
    }
  };

  const body = res.body;
  if (body && typeof body.getReader === "function") {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) >= 0) {
        handleBlock(buffer.slice(0, sep));
        buffer = buffer.slice(sep + 2);
      }
    }
    if (buffer.trim()) handleBlock(buffer);
  } else {
    const text = await res.text();
    for (const block of text.split("\n\n")) {
      if (block.trim()) handleBlock(block);
    }
  }
}

/** Passos de tool SEMPRE visíveis no chat (transparência do tool-loop). */
function ToolSteps({ hops }: { hops: HopView[] }) {
  return (
    <ul className="flex list-none flex-col gap-1.5" aria-label="Consultas feitas pela IA">
      {hops.map((h, i) => (
        <li
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
            <span className="num text-[var(--color-ink-faint)]">
              · {h.took_ms} ms
            </span>
          </span>
          <span
            style={{
              color: h.ok ? "var(--color-ink-muted)" : "var(--color-vermelho)",
            }}
          >
            <span aria-hidden>{h.ok ? "✓" : "✗"}</span>
            <span className="sr-only">{h.ok ? "sucesso" : "falha"}</span>{" "}
            {h.result_summary}
          </span>
        </li>
      ))}
    </ul>
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

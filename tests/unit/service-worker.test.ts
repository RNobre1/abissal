import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";

/**
 * Testa o `public/sw.js` REAL executando-o num `self` mockado.
 *
 * Contexto (28/07): o PWA demorava tanto pra abrir que o Pilot fechava e
 * reabria 3x até pegar. Causa medida em prod via Playwright:
 * `navigationPreload.getState()` → `{enabled: false}`. Com o preload
 * desligado, toda abertura fria serializa [boot do service worker] +
 * [requisição de rede] — em celular isso soma facilmente segundos, e o
 * handler de navegação não tinha escape nenhum enquanto a rede não voltasse.
 */

type Listener = (event: unknown) => void;

function loadServiceWorker() {
  const src = readFileSync(resolve(process.cwd(), "public/sw.js"), "utf8");
  const listeners = new Map<string, Listener>();

  const cacheStore = new Map<string, unknown>();
  const cache = {
    add: vi.fn(async () => undefined),
    put: vi.fn(async (req: unknown, res: unknown) => {
      cacheStore.set(String((req as { url?: string })?.url ?? req), res);
    }),
    keys: vi.fn(async () => []),
  };
  const caches = {
    open: vi.fn(async () => cache),
    keys: vi.fn(async () => ["abissal-v1", "abissal-old"]),
    delete: vi.fn(async () => true),
    match: vi.fn(async (k: unknown) => cacheStore.get(String(k)) ?? "OFFLINE_PAGE"),
  };

  const navigationPreload = {
    enable: vi.fn(async () => undefined),
    disable: vi.fn(async () => undefined),
    getState: vi.fn(async () => ({ enabled: true })),
  };

  const self = {
    addEventListener: (type: string, fn: Listener) => listeners.set(type, fn),
    skipWaiting: vi.fn(async () => undefined),
    clients: { claim: vi.fn(async () => undefined) },
    location: { origin: "https://abissal.rnobre.dev" },
    registration: { navigationPreload },
    caches,
  };

  const fetchMock = vi.fn(async () => ({ ok: true, clone: () => ({}), body: "NETWORK" }));

  const context = vm.createContext({ self, caches, fetch: fetchMock, URL, Promise, console });
  vm.runInContext(src, context);

  return { listeners, caches, cache, navigationPreload, self, fetchMock };
}

/** Evento de fetch mockado: captura o que o SW passou pro respondWith. */
function fetchEvent(request: Record<string, unknown>, preloadResponse?: unknown) {
  let responded: unknown;
  return {
    event: {
      request,
      preloadResponse: Promise.resolve(preloadResponse),
      respondWith: (r: unknown) => {
        responded = r;
      },
    },
    getResponded: () => responded,
  };
}

function waitEvent() {
  let waited: unknown;
  return {
    event: {
      waitUntil: (p: unknown) => {
        waited = p;
      },
    },
    getWaited: () => waited,
  };
}

describe("service worker (public/sw.js)", () => {
  describe("navigation preload", () => {
    it("habilita navigationPreload no activate", async () => {
      const { listeners, navigationPreload } = loadServiceWorker();
      const { event, getWaited } = waitEvent();

      listeners.get("activate")!(event);
      await getWaited();

      // Sem isso, o browser boota o SW ANTES de começar a requisição de rede —
      // é a serialização que fazia o app parecer travado ao abrir.
      expect(navigationPreload.enable).toHaveBeenCalled();
    });

    it("usa a preloadResponse quando o browser já adiantou a requisição", async () => {
      const { listeners } = loadServiceWorker();
      const { event, getResponded } = fetchEvent(
        { method: "GET", mode: "navigate", url: "https://abissal.rnobre.dev/painel" },
        { ok: true, body: "PRELOADED" },
      );

      listeners.get("fetch")!(event);
      const res = (await getResponded()) as { body?: string };

      expect(res?.body).toBe("PRELOADED");
    });

    it("cai pra rede quando não há preloadResponse", async () => {
      const { listeners, fetchMock } = loadServiceWorker();
      const { event, getResponded } = fetchEvent(
        { method: "GET", mode: "navigate", url: "https://abissal.rnobre.dev/painel" },
        undefined,
      );

      listeners.get("fetch")!(event);
      const res = (await getResponded()) as { body?: string };

      expect(fetchMock).toHaveBeenCalled();
      expect(res?.body).toBe("NETWORK");
    });
  });

  describe("comportamento preservado (regressão)", () => {
    it("serve a página offline quando a rede falha numa navegação", async () => {
      const { listeners, fetchMock } = loadServiceWorker();
      fetchMock.mockRejectedValueOnce(new Error("offline"));

      const { event, getResponded } = fetchEvent({
        method: "GET",
        mode: "navigate",
        url: "https://abissal.rnobre.dev/painel",
      });

      listeners.get("fetch")!(event);
      await expect(getResponded()).resolves.toBe("OFFLINE_PAGE");
    });

    it("ignora requisições não-GET", () => {
      const { listeners } = loadServiceWorker();
      const { event, getResponded } = fetchEvent({
        method: "POST",
        mode: "navigate",
        url: "https://abissal.rnobre.dev/api/telemetry",
      });

      listeners.get("fetch")!(event);
      expect(getResponded()).toBeUndefined();
    });

    it("NÃO cacheia HTML autenticado (só estáticos versionados)", () => {
      const { listeners, cache } = loadServiceWorker();
      const { event } = fetchEvent({
        method: "GET",
        mode: "navigate",
        url: "https://abissal.rnobre.dev/painel",
      });

      listeners.get("fetch")!(event);
      expect(cache.put).not.toHaveBeenCalled();
    });

    it("limpa caches de versões antigas no activate", async () => {
      const { listeners, caches } = loadServiceWorker();
      const { event, getWaited } = waitEvent();

      listeners.get("activate")!(event);
      await getWaited();

      expect(caches.delete).toHaveBeenCalledWith("abissal-old");
      expect(caches.delete).not.toHaveBeenCalledWith("abissal-v1");
    });
  });
});

// Service worker do Abissal — conservador de propósito:
//  - NUNCA cacheia HTML autenticado (evita vazar dado/servir stale).
//  - Navegações: network-first, com fallback offline (/offline.html).
//  - Estáticos versionados (_next/static, /icons): cache-first.
const CACHE = "abissal-v1";
// URL limpa: OpenNext serve public/offline.html em /offline (307 em /offline.html).
// O SW só roda em produção, então referenciar a URL limpa é seguro.
const OFFLINE_URL = "/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // Precache tolerante: falha aqui não deve abortar a instalação do SW.
      .then((cache) => cache.add(OFFLINE_URL).catch(() => undefined))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
      // Navigation preload: manda o browser disparar a requisição de navegação
      // EM PARALELO ao boot do service worker. Sem isso, toda abertura fria do
      // PWA (SW dormindo) serializa [boot do SW] + [rede] — foi o que fazia o
      // app parecer travado e exigir fechar/reabrir até o SW estar quente.
      .then(() =>
        self.registration && self.registration.navigationPreload
          ? self.registration.navigationPreload.enable().catch(() => undefined)
          : undefined,
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  // Navegações (HTML): usa a resposta que o browser já adiantou via navigation
  // preload quando existir; senão vai à rede. Offline → fallback estático.
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const preloaded = await event.preloadResponse;
          if (preloaded) return preloaded;
          return await fetch(req);
        } catch {
          return caches.match(OFFLINE_URL);
        }
      })(),
    );
    return;
  }

  // Estáticos imutáveis: cache-first com preenchimento preguiçoso.
  const url = new URL(req.url);
  if (
    url.origin === self.location.origin &&
    (url.pathname.startsWith("/_next/static") ||
      url.pathname.startsWith("/icons/"))
  ) {
    event.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ||
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
            return res;
          }),
      ),
    );
  }
});

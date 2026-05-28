"use client";

import { useEffect } from "react";

/**
 * Registra o service worker (/sw.js) em produção. Em dev fica inerte para
 * evitar caching agressivo durante o desenvolvimento (HMR + dados frescos).
 */
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Falha de registro não é fatal — o app funciona sem PWA.
      });
    };

    if (document.readyState === "complete") register();
    else {
      window.addEventListener("load", register);
      return () => window.removeEventListener("load", register);
    }
  }, []);

  return null;
}

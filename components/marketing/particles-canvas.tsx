"use client";

/**
 * ParticlesCanvas — canvas decorativo de partículas bioluminescentes.
 *
 * Comportamento:
 * - ~50 pontos de luz (configurável via `density`) sobem do fundo ao topo com
 *   drift horizontal senoidal, opacidade pulsante e glow via shadowBlur.
 * - Metade das partículas quando `window.innerWidth < 640`.
 * - Loop via requestAnimationFrame; pausa com IntersectionObserver quando fora
 *   da viewport; frame único estático com `prefers-reduced-motion: reduce`.
 * - devicePixelRatio limitado a 2; handler de resize.
 * - Cleanup completo no unmount.
 * - getContext("2d") nulo → não anima, não lança erro.
 */

import { useEffect, useRef } from "react";

export interface ParticlesCanvasProps {
  className?: string;
  density?: number;
}

interface Particle {
  x: number;
  y: number;
  radius: number;
  speed: number;       // px/frame (y sobe → y decresce)
  drift: number;       // amplitude horizontal senoidal
  phase: number;       // fase inicial do drift
  phaseSpeed: number;  // velocidade de oscilação
  opacity: number;     // opacidade atual
  opacityDir: number;  // +1 ou -1 (fade in/out)
  opacitySpeed: number;
  hue: number;         // variação de matiz (vermelho quente ±15°)
}

const BASE_COLOR_HEX = "#d43535";

function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + 6) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}

const [BASE_H] = hexToHsl(BASE_COLOR_HEX);

function makeParticle(width: number, height: number, randomY = false): Particle {
  return {
    x: Math.random() * width,
    y: randomY ? Math.random() * height : height + Math.random() * 40,
    radius: 1.2 + Math.random() * 2.8,      // 1.2–4 px
    speed: 0.3 + Math.random() * 0.55,      // sobe lentamente
    drift: 20 + Math.random() * 30,
    phase: Math.random() * Math.PI * 2,
    phaseSpeed: 0.005 + Math.random() * 0.01,
    opacity: 0.3 + Math.random() * 0.5,
    opacityDir: Math.random() < 0.5 ? 1 : -1,
    opacitySpeed: 0.003 + Math.random() * 0.007,
    hue: BASE_H + (Math.random() - 0.5) * 30, // ±15° em torno do vermelho
  };
}

export function ParticlesCanvas({ className, density = 64 }: ParticlesCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return; // happy-dom / ambientes sem canvas — não anima, não lança

    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // ── setup de tamanho ──────────────────────────────────────────────────────
    const dpr = Math.min(
      typeof window !== "undefined" ? window.devicePixelRatio ?? 1 : 1,
      2,
    );

    function resize() {
      if (!canvas) return;
      const w = canvas.offsetWidth || canvas.parentElement?.offsetWidth || 300;
      const h = canvas.offsetHeight || canvas.parentElement?.offsetHeight || 600;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    resize();

    // ── partículas ───────────────────────────────────────────────────────────
    const isMobile =
      typeof window !== "undefined" && window.innerWidth < 640;
    const count = Math.round(density * (isMobile ? 0.5 : 1));
    const cw = () => canvas.width / dpr;
    const ch = () => canvas.height / dpr;

    const particles: Particle[] = Array.from({ length: count }, () =>
      makeParticle(cw(), ch(), true),
    );

    // ── frame estático (reduced-motion) ──────────────────────────────────────
    function drawStatic() {
      if (!ctx || !canvas) return;
      ctx.clearRect(0, 0, cw(), ch());
      for (const p of particles) {
        ctx.save();
        ctx.globalAlpha = p.opacity;
        ctx.shadowBlur = p.radius * 10;
        ctx.shadowColor = `hsl(${p.hue}, 82%, 56%)`;
        ctx.fillStyle = `hsl(${p.hue}, 80%, 68%)`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    if (prefersReduced) {
      drawStatic();
      return;
    }

    // ── loop animado ─────────────────────────────────────────────────────────
    let rafId = 0;
    let running = false;

    function tick() {
      if (!running || !ctx || !canvas) return;

      ctx.clearRect(0, 0, cw(), ch());

      for (const p of particles) {
        // mover
        p.y -= p.speed;
        p.phase += p.phaseSpeed;
        p.x += Math.sin(p.phase) * (p.drift * 0.02);

        // loop: sai pelo topo → reaparece embaixo
        if (p.y + p.radius < 0) {
          const fresh = makeParticle(cw(), ch(), false);
          Object.assign(p, fresh);
        }

        // pulso de opacidade
        p.opacity += p.opacitySpeed * p.opacityDir;
        if (p.opacity >= 0.95) { p.opacity = 0.95; p.opacityDir = -1; }
        if (p.opacity <= 0.2) { p.opacity = 0.2; p.opacityDir = 1; }

        // desenhar
        ctx.save();
        ctx.globalAlpha = p.opacity;
        ctx.shadowBlur = p.radius * 10;
        ctx.shadowColor = `hsl(${p.hue}, 82%, 56%)`;
        ctx.fillStyle = `hsl(${p.hue}, 80%, 68%)`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      rafId = requestAnimationFrame(tick);
    }

    function start() {
      if (running) return;
      running = true;
      rafId = requestAnimationFrame(tick);
    }

    function stop() {
      running = false;
      cancelAnimationFrame(rafId);
    }

    // ── IntersectionObserver ─────────────────────────────────────────────────
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) start();
        else stop();
      },
      { threshold: 0 },
    );
    observer.observe(canvas);

    // ── resize ───────────────────────────────────────────────────────────────
    function onResize() {
      resize();
      // reposicionar partículas que ficaram fora do novo tamanho
      const w = cw();
      const h = ch();
      for (const p of particles) {
        if (p.x > w) p.x = Math.random() * w;
        if (p.y > h) p.y = Math.random() * h;
      }
    }

    window.addEventListener("resize", onResize);

    // ── cleanup ──────────────────────────────────────────────────────────────
    return () => {
      stop();
      observer.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, [density]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={className}
      style={{ pointerEvents: "none", display: "block", width: "100%", height: "100%" }}
    />
  );
}

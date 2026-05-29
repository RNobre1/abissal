"use client";

/**
 * AbyssShader — fundo WebGL fullscreen de profundidade abissal.
 *
 * Shader GLSL:
 * - Gradiente vertical #0d0d12 (topo) → #050507 (fundo).
 * - Caustics/ondulação sutil via fbm (fractional Brownian motion, 4 oitavas)
 *   modulado por u_time — textura de água profunda discreta.
 * - Brilho vermelho pulsante (#c42b2b) na base central — o farol distante.
 * - Movimento lento e hipnótico.
 *
 * ogl importado dinamicamente dentro do useEffect → SSR seguro.
 *
 * Fallback:
 * - Se WebGL indisponível OU prefers-reduced-motion → <div> com gradiente CSS
 *   equivalente. Em happy-dom (sem WebGL) cai aqui sem lançar erro.
 *
 * Performance:
 * - Cap ~30 fps (delta mínimo de 33ms entre frames).
 * - Pausa fora da viewport via IntersectionObserver.
 * - dpr limitado a 1.5.
 * - Cleanup completo no unmount.
 */

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface AbyssShaderProps {
  className?: string;
}

// ── GLSL ─────────────────────────────────────────────────────────────────────

const VERTEX = /* glsl */ `
  attribute vec2 position;
  attribute vec2 uv;
  varying vec2 v_uv;
  void main() {
    v_uv = uv;
    gl_Position = vec4(position, 0.0, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  precision mediump float;

  uniform float u_time;
  uniform vec2  u_resolution;
  varying vec2  v_uv;

  // ── hash / noise ────────────────────────────────────────────────────────
  float hash(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 19.19);
    return fract(p.x * p.y);
  }

  float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f); // Hermite smoothstep
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  // 4-octave fbm
  float fbm(vec2 p) {
    float v    = 0.0;
    float amp  = 0.5;
    float freq = 1.0;
    for (int i = 0; i < 4; i++) {
      v    += amp * valueNoise(p * freq);
      freq *= 2.1;
      amp  *= 0.48;
    }
    return v;
  }

  // ── cores ────────────────────────────────────────────────────────────────
  vec3 colorTop    = vec3(0.051, 0.051, 0.071); // #0d0d12
  vec3 colorBottom = vec3(0.020, 0.020, 0.027); // #050507
  vec3 colorRed    = vec3(0.769, 0.169, 0.169); // #c42b2b

  void main() {
    vec2 uv = v_uv;                         // [0,1]² — y=0 embaixo (OGL)
    float y = 1.0 - uv.y;                   // y=0 topo, y=1 fundo

    // ── gradiente base ───────────────────────────────────────────────────
    vec3 base = mix(colorTop, colorBottom, y);

    // ── caustics / água profunda ─────────────────────────────────────────
    // Domínio deslocado pelo tempo — dois planos de fbm se cruzam
    vec2 p1 = uv * 3.0 + vec2(u_time * 0.04, u_time * 0.02);
    vec2 p2 = uv * 2.2 - vec2(u_time * 0.03, u_time * 0.015);
    float n1 = fbm(p1);
    float n2 = fbm(p2 + n1 * 0.6);         // domain warping sutil
    float caustic = n2 * 0.5 + 0.5;

    // Amplitude discreta: máx 0.025 de luminância
    float causticStrength = 0.025 * (1.0 - y * 0.5); // mais sutil no fundo
    base += causticStrength * (caustic - 0.5);

    // ── brilho vermelho pulsante na base central ─────────────────────────
    // Pulso lento: ciclo ~8s
    float pulse = 0.55 + 0.45 * sin(u_time * 0.785); // 0.785 ≈ 2π/8

    // Posição: centro horizontal, ~80–95% para baixo (y grande = base)
    float cx    = 0.5;
    float cy    = 0.90;                     // em coords y=0-topo
    float dx    = (uv.x - cx) * (u_resolution.x / u_resolution.y); // aspect ratio
    float dy    = (1.0 - uv.y) - cy;        // distância ao ponto de luz
    float dist2 = dx * dx + dy * dy;

    // Falloff: foco estreito (radius ≈ 0.18 no aspect corrigido)
    float glow = pulse * 0.18 / (dist2 * 18.0 + 0.1);
    glow = clamp(glow, 0.0, 0.12);          // cap: visível mas discreto

    base += colorRed * glow;

    gl_FragColor = vec4(clamp(base, 0.0, 1.0), 1.0);
  }
`;

// ── helpers ───────────────────────────────────────────────────────────────────

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function webglAvailable(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") ?? c.getContext("webgl"));
  } catch {
    return false;
  }
}

// ── Fallback CSS ──────────────────────────────────────────────────────────────

function AbyssShaderFallback({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none", className)}
      style={{
        background: [
          "radial-gradient(ellipse 60% 20% at 50% 100%, rgba(196,43,43,0.18) 0%, transparent 70%)",
          "linear-gradient(to bottom, #0d0d12 0%, #050507 100%)",
        ].join(", "),
      }}
    />
  );
}

// ── Componente principal ──────────────────────────────────────────────────────

export function AbyssShader({ className }: AbyssShaderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // A decisão de fallback é computada uma única vez — ambas as APIs
  // (matchMedia + getContext) são síncronas. Usamos useState com lazy
  // initializer: o valor nunca muda, mas controla o que renderizamos.
  // O useEffect lê pelo ref para não precisar listá-lo como dependência
  // (o valor é imutável após a montagem).
  const [useFallback] = useState(
    () => prefersReducedMotion() || !webglAvailable(),
  );
  // Ref espelho para o effect — evita o aviso exhaustive-deps sem eslint-disable.
  const fallbackRef = useRef(useFallback);

  useEffect(() => {
    if (fallbackRef.current) return;

    const container = containerRef.current;
    if (!container) return;

    // Variáveis de controle de ciclo de vida
    let rafId = 0;
    let running = false;
    let observer: IntersectionObserver | null = null;
    let resizeHandler: (() => void) | null = null;
    let destroyed = false;

    // Ref para o teardown que só existe após o import async completar.
    // Declarado ANTES do IIFE para que o IIFE possa escrever nele.
    const teardownRef = { current: () => {} };

    // Import dinâmico do ogl — nunca no top-level (SSR / happy-dom safe)
    void (async () => {
      const { Renderer, Triangle, Program, Mesh } = await import("ogl");

      if (destroyed) return;

      // ── Renderer ───────────────────────────────────────────────────────
      const dpr = Math.min(
        typeof window !== "undefined" ? (window.devicePixelRatio ?? 1) : 1,
        1.5,
      );

      const renderer = new Renderer({
        alpha: false,
        antialias: false,
        dpr,
        powerPreference: "low-power",
      });

      const gl = renderer.gl;
      const canvas = gl.canvas as HTMLCanvasElement;

      // Posiciona o canvas fullscreen dentro do container
      canvas.style.cssText =
        "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;";
      container.appendChild(canvas);

      // ── Geometria fullscreen ───────────────────────────────────────────
      const geometry = new Triangle(gl);

      // ── Uniforms ───────────────────────────────────────────────────────
      const uniforms = {
        u_time: { value: 0 },
        u_resolution: { value: [gl.canvas.width, gl.canvas.height] as [number, number] },
      };

      const program = new Program(gl, {
        vertex: VERTEX,
        fragment: FRAGMENT,
        uniforms,
      });

      const mesh = new Mesh(gl, { geometry, program });

      // ── Resize ────────────────────────────────────────────────────────
      function resize() {
        const w = container!.offsetWidth || window.innerWidth;
        const h = container!.offsetHeight || window.innerHeight;
        renderer.setSize(w, h);
        uniforms.u_resolution.value = [gl.canvas.width, gl.canvas.height];
      }

      resize();

      resizeHandler = resize;
      window.addEventListener("resize", resize);

      // ── Loop ──────────────────────────────────────────────────────────
      const TARGET_INTERVAL = 1000 / 33; // ~30 fps
      let lastTime = 0;

      function tick(now: number) {
        if (!running) return;
        rafId = requestAnimationFrame(tick);

        const delta = now - lastTime;
        if (delta < TARGET_INTERVAL) return; // fps cap
        lastTime = now - (delta % TARGET_INTERVAL);

        uniforms.u_time.value = now * 0.001; // segundos
        renderer.render({ scene: mesh });
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

      // ── IntersectionObserver ───────────────────────────────────────────
      observer = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting) start();
          else stop();
        },
        { threshold: 0 },
      );
      observer.observe(container);

      // ── Registra teardown completo (pós-async) ─────────────────────────
      teardownRef.current = () => {
        stop();
        observer?.disconnect();
        if (resizeHandler) window.removeEventListener("resize", resizeHandler);
        // Libera contexto WebGL explicitamente
        const ext = gl.getExtension("WEBGL_lose_context");
        ext?.loseContext();
        canvas.remove();
      };
    })();

    return () => {
      destroyed = true;
      // Se o import já completou, roda o teardown completo; caso contrário,
      // a flag `destroyed` aborta o setup antes de qualquer montagem.
      teardownRef.current();
    };
  }, []);

  if (useFallback) {
    return <AbyssShaderFallback className={className} />;
  }

  return (
    <div
      ref={containerRef}
      aria-hidden
      className={cn("pointer-events-none", className)}
    />
  );
}

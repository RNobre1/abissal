"use client";

/**
 * AbyssShader — fundo WebGL fullscreen de profundidade abissal.
 *
 * Shader GLSL: gradiente vertical (azul-abismo → fundo quase preto) + caustics
 * fbm animadas + farol vermelho distante pulsante na base. Movimento lento.
 *
 * SSR-safe SEM hydration mismatch: o markup é SEMPRE o mesmo <div> (idêntico no
 * servidor e no cliente). A decisão WebGL-vs-fallback acontece DENTRO do
 * useEffect (só-cliente); o fallback é um gradiente CSS aplicado via style.
 *
 * Performance: cap ~30fps, pausa fora da viewport (IntersectionObserver),
 * dpr ≤ 1.5, cleanup completo no unmount.
 */

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export interface AbyssShaderProps {
  className?: string;
}

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

  float hash(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 19.19);
    return fract(p.x * p.y);
  }

  float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  float fbm(vec2 p) {
    float v = 0.0, amp = 0.5, freq = 1.0;
    for (int i = 0; i < 4; i++) {
      v += amp * valueNoise(p * freq);
      freq *= 2.1;
      amp *= 0.48;
    }
    return v;
  }

  vec3 colorTop    = vec3(0.060, 0.105, 0.165); // azul-abismo (superfície)
  vec3 colorBottom = vec3(0.010, 0.012, 0.024); // fundo do abismo
  vec3 colorRed    = vec3(0.831, 0.208, 0.208); // #d43535

  void main() {
    vec2 uv = v_uv;
    float y = 1.0 - uv.y; // y=0 topo, y=1 fundo

    vec3 base = mix(colorTop, colorBottom, pow(y, 0.72));

    // caustics
    vec2 p1 = uv * 3.0 + vec2(u_time * 0.04, u_time * 0.02);
    vec2 p2 = uv * 2.2 - vec2(u_time * 0.03, u_time * 0.015);
    float n1 = fbm(p1);
    float n2 = fbm(p2 + n1 * 0.6);
    float caustic = n2 * 0.5 + 0.5;
    float causticStrength = 0.10 * (1.0 - y * 0.45);
    base += causticStrength * (caustic - 0.5);
    base += vec3(0.02, 0.05, 0.08) * max(caustic - 0.62, 0.0) * (1.0 - y * 0.6);

    // farol distante pulsante na base central
    float pulse = 0.55 + 0.45 * sin(u_time * 0.785);
    float cx = 0.5;
    float cy = 0.90;
    float dx = (uv.x - cx) * (u_resolution.x / u_resolution.y);
    float dy = (1.0 - uv.y) - cy;
    float dist2 = dx * dx + dy * dy;
    float glow = pulse * 0.5 / (dist2 * 16.0 + 0.14);
    glow = clamp(glow, 0.0, 0.42);
    base += colorRed * glow;

    gl_FragColor = vec4(clamp(base, 0.0, 1.0), 1.0);
  }
`;

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

function weakDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    connection?: { saveData?: boolean };
  };
  return (
    (nav.hardwareConcurrency ?? 8) <= 4 ||
    (nav.deviceMemory ?? 8) <= 4 ||
    nav.connection?.saveData === true
  );
}

const FALLBACK_BG = [
  "radial-gradient(ellipse 60% 24% at 50% 100%, rgba(196,43,43,0.20) 0%, transparent 70%)",
  "linear-gradient(to bottom, #0a1018 0%, #050507 100%)",
].join(", ");

export function AbyssShader({ className }: AbyssShaderProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Markup SSR/cliente idêntico (sem mismatch). O fallback CSS já vem no style
    // inline do <div> (pintado no SSR → sem flash de preto). Aqui só decidimos se
    // vale subir o WebGL por cima.
    if (prefersReducedMotion() || !webglAvailable() || weakDevice()) {
      return; // permanece no fallback CSS já presente
    }

    let rafId = 0;
    let running = false;
    let observer: IntersectionObserver | null = null;
    let resizeHandler: (() => void) | null = null;
    let destroyed = false;
    const teardownRef = { current: () => {} };

    const boot = async () => {
      const { Renderer, Triangle, Program, Mesh } = await import("ogl");
      if (destroyed) return;

      const dpr = Math.min(window.devicePixelRatio ?? 1, 1.5);
      const renderer = new Renderer({
        alpha: false,
        antialias: false,
        dpr,
        powerPreference: "low-power",
      });
      const gl = renderer.gl;
      const canvas = gl.canvas as HTMLCanvasElement;
      canvas.style.cssText =
        "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;";
      container.appendChild(canvas);

      const geometry = new Triangle(gl);
      const uniforms = {
        u_time: { value: 0 },
        u_resolution: {
          value: [gl.canvas.width, gl.canvas.height] as [number, number],
        },
      };
      const program = new Program(gl, { vertex: VERTEX, fragment: FRAGMENT, uniforms });
      const mesh = new Mesh(gl, { geometry, program });

      function resize() {
        const w = container!.offsetWidth || window.innerWidth;
        const h = container!.offsetHeight || window.innerHeight;
        renderer.setSize(w, h);
        uniforms.u_resolution.value = [gl.canvas.width, gl.canvas.height];
      }
      resize();
      resizeHandler = resize;
      window.addEventListener("resize", resize);

      const TARGET_INTERVAL = 1000 / 33;
      let lastTime = 0;
      function tick(now: number) {
        if (!running) return;
        rafId = requestAnimationFrame(tick);
        const delta = now - lastTime;
        if (delta < TARGET_INTERVAL) return;
        lastTime = now - (delta % TARGET_INTERVAL);
        uniforms.u_time.value = now * 0.001;
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

      observer = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting) start();
          else stop();
        },
        { threshold: 0 },
      );
      observer.observe(container);

      teardownRef.current = () => {
        stop();
        observer?.disconnect();
        if (resizeHandler) window.removeEventListener("resize", resizeHandler);
        const ext = gl.getExtension("WEBGL_lose_context");
        ext?.loseContext();
        canvas.remove();
      };
    };

    // Adia o WebGL pra depois do paint do hero (protege LCP/INP — Igloo SOTY).
    const idleId =
      typeof requestIdleCallback !== "undefined"
        ? requestIdleCallback(() => void boot(), { timeout: 800 })
        : (setTimeout(() => void boot(), 200) as unknown as number);

    return () => {
      destroyed = true;
      if (typeof cancelIdleCallback !== "undefined") cancelIdleCallback(idleId);
      else clearTimeout(idleId);
      teardownRef.current();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      aria-hidden
      className={cn("pointer-events-none", className)}
      style={{ background: FALLBACK_BG }}
    />
  );
}

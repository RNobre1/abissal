/**
 * AbissalMark — o mark "estratos + farol" reutilizável (frente D).
 * Geometria/parâmetros: docs/superpowers/specs/2026-05-29-identidade-visual-design.md §3.
 * O teste cobre estrutura + acessibilidade + o toggle de animação;
 * o CSS de animação (G2) é validado por smoke visual, não por unit.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { AbissalMark } from "@/components/brand/abissal-mark";

afterEach(cleanup);

describe("AbissalMark", () => {
  it("renderiza um SVG acessível com o tamanho pedido", () => {
    const { container } = render(<AbissalMark size={48} />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute("role")).toBe("img");
    expect(svg!.getAttribute("aria-label")).toBe("Abissal");
    expect(svg!.getAttribute("width")).toBe("48");
    expect(svg!.getAttribute("height")).toBe("48");
    expect(svg!.getAttribute("viewBox")).toBe("0 0 100 100");
  });

  it("desenha os 4 estratos e o farol", () => {
    const { container } = render(<AbissalMark size={64} />);
    expect(container.querySelectorAll("line").length).toBe(4);
    expect(container.querySelectorAll("circle").length).toBe(1);
  });

  it("aceita um title (aria-label) customizado", () => {
    const { container } = render(
      <AbissalMark title="Abissal — voltar ao início" />,
    );
    expect(container.querySelector("svg")!.getAttribute("aria-label")).toBe(
      "Abissal — voltar ao início",
    );
  });

  it("é animada por padrão e estática quando animated=false", () => {
    const { container: anim } = render(<AbissalMark />);
    expect(anim.querySelector("svg")!.getAttribute("data-animated")).toBe(
      "true",
    );
    cleanup();
    const { container: still } = render(<AbissalMark animated={false} />);
    expect(still.querySelector("svg")!.getAttribute("data-animated")).toBe(
      "false",
    );
  });

  it("repassa className extra", () => {
    const { container } = render(<AbissalMark className="size-6" />);
    expect(container.querySelector("svg")!.getAttribute("class")).toContain(
      "size-6",
    );
  });
});

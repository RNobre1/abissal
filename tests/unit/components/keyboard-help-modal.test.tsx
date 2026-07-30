/**
 * KeyboardHelpModal — atalho "b" (+ bilhete).
 *
 * O TODO(Wave M) segurava o atalho "b" fantasma no help. A Wave M está
 * mergeada: o botão real "+ bilhete" (AddToSlipButton) expõe
 * `data-add-to-slip`. O atalho "b" foca o primeiro botão presente na página
 * e a linha aparece listada no modal de ajuda.
 */

import "@testing-library/jest-dom/vitest";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { KeyboardHelpModal } from "@/components/keyboard-help-modal";

function pressKey(key: string) {
  fireEvent.keyDown(window, { key });
}

describe("<KeyboardHelpModal />", () => {
  it("abre com '?' e lista o atalho 'b' do + bilhete", () => {
    render(<KeyboardHelpModal />);
    pressKey("?");

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("b")).toBeInTheDocument();
    expect(screen.getByText(/bilhete/i)).toBeInTheDocument();
  });

  it("'b' foca o primeiro botão [data-add-to-slip] da página", () => {
    render(
      <div>
        <button type="button" data-add-to-slip>
          + bilhete
        </button>
        <KeyboardHelpModal />
      </div>,
    );

    pressKey("b");

    const btn = document.querySelector<HTMLButtonElement>("[data-add-to-slip]");
    expect(btn).not.toBeNull();
    expect(document.activeElement).toBe(btn);
  });

  it("'b' sem botão presente não explode", () => {
    render(<KeyboardHelpModal />);
    expect(() => pressKey("b")).not.toThrow();
  });
});

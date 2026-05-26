import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import type { ShortcutConfig } from "@/hooks/use-keyboard-shortcuts";

describe("useKeyboardShortcuts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fires handler on matching key", () => {
    const handler = vi.fn();
    const shortcuts: ShortcutConfig[] = [{ key: "j", handler }];

    renderHook(() => useKeyboardShortcuts({ shortcuts }));

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "j" }));
    });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does not fire when disabled is true", () => {
    const handler = vi.fn();
    const shortcuts: ShortcutConfig[] = [{ key: "k", handler }];

    renderHook(() => useKeyboardShortcuts({ shortcuts, disabled: true }));

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k" }));
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it("does not fire when typing in input", () => {
    const handler = vi.fn();
    const shortcuts: ShortcutConfig[] = [{ key: "j", handler }];

    renderHook(() => useKeyboardShortcuts({ shortcuts }));

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "j", bubbles: true }),
      );
    });

    expect(handler).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });

  it("does not fire when typing in textarea", () => {
    const handler = vi.fn();
    const shortcuts: ShortcutConfig[] = [{ key: "s", handler }];

    renderHook(() => useKeyboardShortcuts({ shortcuts }));

    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    textarea.focus();

    act(() => {
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "s", bubbles: true }),
      );
    });

    expect(handler).not.toHaveBeenCalled();
    document.body.removeChild(textarea);
  });

  it("supports multiple shortcuts independently", () => {
    const jHandler = vi.fn();
    const kHandler = vi.fn();
    const shortcuts: ShortcutConfig[] = [
      { key: "j", handler: jHandler },
      { key: "k", handler: kHandler },
    ];

    renderHook(() => useKeyboardShortcuts({ shortcuts }));

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "j" }));
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k" }));
    });

    expect(jHandler).toHaveBeenCalledTimes(1);
    expect(kHandler).toHaveBeenCalledTimes(1);
  });

  it("fires handler for bracket shortcuts", () => {
    const prevHandler = vi.fn();
    const nextHandler = vi.fn();
    const shortcuts: ShortcutConfig[] = [
      { key: "[", handler: prevHandler },
      { key: "]", handler: nextHandler },
    ];

    renderHook(() => useKeyboardShortcuts({ shortcuts }));

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "[" }));
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "]" }));
    });

    expect(prevHandler).toHaveBeenCalledTimes(1);
    expect(nextHandler).toHaveBeenCalledTimes(1);
  });

  it("cleans up listener on unmount", () => {
    const handler = vi.fn();
    const shortcuts: ShortcutConfig[] = [{ key: "?", handler }];

    const { unmount } = renderHook(() =>
      useKeyboardShortcuts({ shortcuts }),
    );

    unmount();

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "?" }));
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it("passes the keyboard event to the handler", () => {
    const handler = vi.fn();
    const shortcuts: ShortcutConfig[] = [{ key: "Enter", handler }];

    renderHook(() => useKeyboardShortcuts({ shortcuts }));

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    });

    expect(handler).toHaveBeenCalledWith(expect.any(KeyboardEvent));
  });
});

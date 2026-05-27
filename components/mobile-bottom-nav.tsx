"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  LayoutDashboard,
  Target,
  CalendarDays,
  ArrowLeftRight,
  MoreHorizontal,
  type LucideIcon,
} from "lucide-react";

interface NavItem {
  href: string;
  label: string;
  Icon: LucideIcon;
  /**
   * Routes that should highlight this tab. We match `pathname === match` for
   * the root, and `pathname.startsWith(match + "/") || pathname === match`
   * for nested routes (so /fixtures/[id] still highlights the fixtures tab).
   */
  match: string;
}

const PRIMARY_ITEMS: NavItem[] = [
  { href: "/", label: "início", Icon: LayoutDashboard, match: "/" },
  { href: "/bets", label: "apostas", Icon: Target, match: "/bets" },
  { href: "/fixtures", label: "fixtures", Icon: CalendarDays, match: "/fixtures" },
  {
    href: "/transactions",
    label: "transações",
    Icon: ArrowLeftRight,
    match: "/transactions",
  },
];

const MORE_GROUPS: Array<{
  label: string;
  items: Array<{ href: string; label: string }>;
}> = [
  {
    label: "operação",
    items: [
      { href: "/banca", label: "banca" },
      { href: "/houses", label: "casas" },
      { href: "/forecast", label: "previsão" },
    ],
  },
  {
    label: "análise",
    items: [
      { href: "/explore", label: "explorar" },
      { href: "/calibracao", label: "calibração" },
    ],
  },
  {
    label: "sistema",
    items: [
      { href: "/audit", label: "auditoria" },
      { href: "/logs", label: "logs IA" },
    ],
  },
];

function isActive(pathname: string, match: string): boolean {
  if (match === "/") return pathname === "/";
  return pathname === match || pathname.startsWith(`${match}/`);
}

/**
 * Mobile-only bottom navigation. Four primary tabs (início/apostas/fixtures/
 * transações) plus a "mais" button that opens a drawer with the remaining
 * routes grouped (operação/análise/sistema), mirroring the desktop sidebar.
 *
 * Lives outside the desktop layout via `lg:hidden`; the parent layout pads
 * `pb-20` so content above doesn't disappear under it.
 */
export function MobileBottomNav() {
  const pathname = usePathname() ?? "/";
  const [open, setOpen] = useState(false);

  return (
    <>
      <nav
        className="fixed inset-x-0 bottom-0 z-50 grid grid-cols-5 border-t border-[var(--color-line)] bg-[var(--color-surface-1)]/95 backdrop-blur supports-[backdrop-filter]:bg-[var(--color-surface-1)]/80 lg:hidden"
        aria-label="Navegação principal"
      >
        {PRIMARY_ITEMS.map(({ href, label, Icon, match }) => {
          const active = isActive(pathname, match);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={[
                "relative flex flex-col items-center justify-center gap-1 py-3 transition-colors",
                active
                  ? "text-[var(--color-vermelho)]"
                  : "text-[var(--color-ink-muted)] active:bg-[var(--color-surface-2)]",
              ].join(" ")}
            >
              {active ? (
                <span
                  aria-hidden
                  className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-[var(--color-vermelho)]"
                />
              ) : null}
              <Icon size={18} strokeWidth={1.75} aria-hidden />
              <span className="label">{label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="relative flex flex-col items-center justify-center gap-1 py-3 text-[var(--color-ink-muted)] transition-colors active:bg-[var(--color-surface-2)]"
          aria-label="Mais opções de navegação"
          data-nav-more
        >
          <MoreHorizontal size={18} strokeWidth={1.75} aria-hidden />
          <span className="label">mais</span>
        </button>
      </nav>

      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm lg:hidden" />
          <Dialog.Content
            className="fixed inset-x-0 bottom-0 z-[70] flex max-h-[80vh] flex-col gap-4 overflow-auto rounded-t-[var(--radius)] border-t border-[var(--color-line)] bg-[var(--color-surface-1)] p-5 pb-8 lg:hidden"
            data-mobile-more-drawer
          >
            <Dialog.Title className="sr-only">Mais opções</Dialog.Title>
            <div className="flex items-center justify-between">
              <span className="label text-[var(--color-ink-faint)]">mais</span>
              <Dialog.Close className="label text-[var(--color-ink-muted)] hover:text-[var(--color-vermelho)]">
                fechar
              </Dialog.Close>
            </div>
            {MORE_GROUPS.map((group) => (
              <div key={group.label} className="flex flex-col gap-1">
                <span className="label mb-1 text-[var(--color-ink-faint)]">
                  {group.label}
                </span>
                {group.items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className="rounded-[var(--radius-sm)] px-3 py-2 text-sm text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            ))}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

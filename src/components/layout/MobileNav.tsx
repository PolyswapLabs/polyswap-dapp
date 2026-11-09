"use client";

import Link from "next/link";
import { Icon } from "@/components/icons";
import { useModalDismiss } from "@/hooks/useModalDismiss";
import { cn } from "@/utils/cn";

export interface MobileNavLink {
  href: string;
  label: string;
  active?: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  links: MobileNavLink[];
  footer?: React.ReactNode;
}

export function MobileNav({ open, onClose, links, footer }: Props) {
  useModalDismiss(open, onClose);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 lg:hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Navigation"
    >
      <button
        type="button"
        aria-label="Close navigation"
        onClick={onClose}
        className="absolute inset-0 bg-ink/30"
      />
      <aside
        className={cn(
          "absolute top-0 right-0 flex h-full w-[min(360px,86vw)] flex-col",
          "border-l border-ink bg-paper"
        )}
      >
        <div className="flex items-center justify-between border-b border-ink px-5 py-4">
          <span className="eyebrow">Menu</span>
          <button
            type="button"
            aria-label="Close menu"
            onClick={onClose}
            className="-m-2 inline-flex size-11 items-center justify-center text-ink hover:bg-paper-3"
          >
            <Icon.x size={18} aria-hidden />
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={onClose}
              className={cn(
                "flex items-center justify-between border-b border-rule-soft px-5 py-4 text-base",
                l.active ? "bg-ink text-paper" : "hover:bg-paper-2"
              )}
            >
              <span className="font-serif text-xl">{l.label}</span>
              <Icon.chevronRight size={16} aria-hidden />
            </Link>
          ))}
        </nav>
        {footer && <div className="border-t border-ink p-5">{footer}</div>}
      </aside>
    </div>
  );
}

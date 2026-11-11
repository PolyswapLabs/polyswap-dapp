"use client";

import { useEffect } from "react";

/** While `open`: locks page scroll and, unless disabled, closes on Escape. */
export function useModalDismiss(
  open: boolean,
  onClose: () => void,
  options: { closeOnEscape?: boolean } = {}
) {
  const { closeOnEscape = true } = options;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (closeOnEscape && e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
    };
  }, [open, onClose, closeOnEscape]);
}

import { useLayoutEffect, useState, type RefObject } from "react";

export function fitPlayfield(width: number, height: number) {
  const scale = Math.max(0, Math.min(width / 320, height / 400));
  return { width: 320 * scale, height: 400 * scale };
}

/** Fit inside the actual host and visual viewport, including classic routes.
 * The host may provide --si-host-height once the OS adapter owns its layout.
 * No page-wide scroll lock or shell mutation is needed. */
export function usePlayfieldSize(root: RefObject<HTMLElement | null>, slot: RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState({ availableHeight: 0, width: 0, height: 0, landscape: false });
  useLayoutEffect(() => {
    const el = root.current;
    const field = slot.current;
    if (!el || !field) return;
    const parents: HTMLElement[] = [];
    for (let p = el.parentElement; p; p = p.parentElement) parents.push(p);
    const navigation = Array.from(document.querySelectorAll<HTMLElement>('nav[aria-label="Mobile navigation"]'));
    const measure = () => {
      const rect = el.getBoundingClientRect();
      const viewport = window.visualViewport;
      let bottom = viewport ? viewport.offsetTop + viewport.height : document.documentElement.clientHeight;
      for (const p of parents) {
        if (document.fullscreenElement && !document.fullscreenElement.contains(p)) continue;
        const css = getComputedStyle(p);
        // Only independently bounded hosts constrain us. A shrink-wrapped
        // overflow:hidden ancestor would otherwise shrink by 4px on every
        // observer delivery as our own height changes.
        const parentDisplay = p.parentElement ? getComputedStyle(p.parentElement).display : "";
        const flexItem = Number(css.flexGrow) > 0 && /^(inline-)?flex$/.test(parentDisplay);
        const bounded = flexItem || css.position === "absolute" || css.position === "fixed";
        if (!bounded || !/(auto|scroll|hidden|clip)/.test(css.overflowY)) continue;
        const box = p.getBoundingClientRect();
        if (box.height > 0) bottom = Math.min(bottom, box.bottom - (parseFloat(css.paddingBottom) || 0) - (parseFloat(css.borderBottomWidth) || 0));
      }
      // Classic routes have a fixed mobile tab bar outside their scroll host.
      // Measure its real top (including safe area), never a guessed pixel inset.
      for (const nav of navigation) {
        if (document.fullscreenElement && !document.fullscreenElement.contains(nav)) continue;
        const box = nav.getBoundingClientRect();
        if (getComputedStyle(nav).position === "fixed" && box.height > 0 && box.top > rect.top && box.left < rect.right && box.right > rect.left) bottom = Math.min(bottom, box.top);
      }
      const availableHeight = Math.max(0, Math.floor(bottom - Math.max(0, rect.top) - 4));
      const fieldRect = field.getBoundingClientRect();
      const fitted = fitPlayfield(fieldRect.width, fieldRect.height);
      const explicitHostHeight = getComputedStyle(el).getPropertyValue("--si-host-height").trim();
      const layoutHeight = explicitHostHeight ? rect.height : availableHeight;
      const next = { availableHeight, ...fitted, landscape: rect.width >= 500 && layoutHeight < 500 };
      setSize(prev => Object.keys(next).every(k => prev[k as keyof typeof prev] === next[k as keyof typeof next]) ? prev : next);
    };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    [el, field, ...parents, ...navigation].forEach(p => observer?.observe(p));
    document.addEventListener("fullscreenchange", measure);
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("scroll", measure);
    measure();
    return () => {
      observer?.disconnect();
      document.removeEventListener("fullscreenchange", measure);
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("scroll", measure);
    };
  }, [root, slot]);
  return size;
}

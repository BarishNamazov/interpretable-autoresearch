// Tiny DOM helper used by all components. Avoids a framework dependency.

type Primitive = string | number | boolean;
type EventMap = Record<string, EventListener>;

export interface DomAttrs {
  class?: string;
  style?: string;
  id?: string;
  title?: string;
  type?: string;
  value?: Primitive;
  placeholder?: string;
  href?: string;
  src?: string;
  selected?: boolean;
  checked?: boolean;
  disabled?: boolean;
  hidden?: boolean;
  name?: string;
  role?: string;
  tabIndex?: number;
  dataset?: Record<string, string>;
  on?: EventMap;
  [key: `data-${string}`]: string | undefined;
  [key: `aria-${string}`]: string | undefined;
}

export type DomChild = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: DomAttrs = {},
  children: DomChild[] = []
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null) continue;
    if (k === "class") el.className = v as string;
    else if (k === "style") el.setAttribute("style", v as string);
    else if (k === "dataset")
      for (const [dk, dv] of Object.entries(v as Record<string, string>)) el.dataset[dk] = dv;
    else if (k === "on")
      for (const [ek, eh] of Object.entries(v as EventMap)) el.addEventListener(ek, eh);
    else if (k === "checked" || k === "disabled" || k === "hidden" || k === "selected") {
      (el as unknown as Record<string, boolean>)[k] = Boolean(v);
    } else if (k === "value" || k === "tabIndex") {
      (el as unknown as Record<string, Primitive>)[k] = v as Primitive;
    } else if (k.startsWith("data-") || k.startsWith("aria-")) {
      el.setAttribute(k, String(v));
    } else {
      // Standard attribute (id, type, placeholder, href, ...).
      try {
        (el as unknown as Record<string, unknown>)[k] = v;
      } catch {
        el.setAttribute(k, String(v));
      }
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return el;
}

export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | undefined> = {},
  children: (SVGElement | string)[] = []
): SVGElementTagNameMap[K] {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined) continue;
    el.setAttribute(k, String(v));
  }
  for (const c of children) {
    el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return el;
}

export function clear(el: HTMLElement): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

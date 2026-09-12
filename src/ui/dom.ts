export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string | null)[]
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'style') n.setAttribute('style', v);
    else if (k.startsWith('data-')) n.setAttribute(k, v);
    else n.setAttribute(k, v);
  }
  for (const c of kids) {
    if (c === null) continue;
    n.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return n;
}

export function clear(n: HTMLElement): void {
  while (n.firstChild) n.removeChild(n.firstChild);
}

export function on<K extends keyof HTMLElementEventMap>(
  n: HTMLElement, ev: K, fn: (e: HTMLElementEventMap[K]) => void,
): void {
  n.addEventListener(ev, fn);
}

let tipEl: HTMLDivElement | null = null;
export function showTip(html: HTMLElement, x: number, y: number): void {
  hideTip();
  tipEl = el('div', { class: 'tip' });
  tipEl.append(html);
  document.body.append(tipEl);
  const r = tipEl.getBoundingClientRect();
  const px = Math.min(window.innerWidth - r.width - 10, x + 16);
  const py = Math.min(window.innerHeight - r.height - 10, y + 10);
  tipEl.style.left = Math.max(8, px) + 'px';
  tipEl.style.top = Math.max(8, py) + 'px';
}
export function hideTip(): void {
  tipEl?.remove();
  tipEl = null;
}

export function toast(msg: string, ms = 1800): void {
  const host = document.getElementById('toasts')!;
  const n = el('div', { class: 'toast', style: 'top:' + (72 + host.children.length * 46) + 'px' }, msg);
  host.append(n);
  setTimeout(() => {
    n.style.transition = 'opacity .3s';
    n.style.opacity = '0';
    setTimeout(() => n.remove(), 320);
  }, ms);
}

export function fmt(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e4) return (n / 1e3).toFixed(1) + 'k';
  return Math.floor(n).toLocaleString();
}

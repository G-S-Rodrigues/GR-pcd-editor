/** A tiny DOM stand-in for the node-environment vitest runs: enough for `h`, `control`, icon builders and the bars. */
export class FakeEl {
  attrs = new Map<string, string>();
  children: FakeEl[] = [];
  listeners = new Map<string, ((e: unknown) => void)[]>();
  className = "";
  textContent = "";
  disabled = false;
  value = "";
  hidden = false;
  tabIndex = 0;
  focused = 0;
  focus(): void {
    this.focused++;
  }
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  private classes = new Set<string>();
  constructor(readonly tag: string) {}
  get firstElementChild(): FakeEl | undefined {
    return this.children[0];
  }
  get title(): string {
    return this.attrs.get("title") ?? "";
  }
  set title(v: string) {
    this.attrs.set("title", v);
  }
  get classList() {
    const self = this;
    return {
      toggle(c: string, on?: boolean) {
        const want = on ?? !self.classes.has(c);
        if (want) self.classes.add(c);
        else self.classes.delete(c);
      },
      add: (c: string) => void this.classes.add(c),
      remove: (c: string) => void this.classes.delete(c),
      contains: (c: string) => this.classes.has(c) || this.className.split(/\s+/).includes(c),
    };
  }
  setAttribute(k: string, v: string): void {
    this.attrs.set(k, v);
  }
  getAttribute(k: string): string | null {
    return this.attrs.get(k) ?? null;
  }
  hasAttribute(k: string): boolean {
    return this.attrs.has(k);
  }
  removeAttribute(k: string): void {
    this.attrs.delete(k);
  }
  addEventListener(t: string, f: (e: unknown) => void): void {
    this.listeners.set(t, [...(this.listeners.get(t) ?? []), f]);
  }
  fire(t: string, e: unknown = {}): void {
    for (const f of this.listeners.get(t) ?? []) f(e);
  }
  append(...c: (FakeEl | string)[]): void {
    for (const x of c) {
      if (typeof x === "string") {
        const t = new FakeEl("#text");
        t.textContent = x;
        this.children.push(t);
      } else this.children.push(x);
    }
  }
  replaceChildren(...c: (FakeEl | string)[]): void {
    this.children = [];
    this.append(...c);
  }
  /** Every descendant (depth first, self excluded). */
  all(): FakeEl[] {
    return this.children.flatMap((c) => [c, ...c.all()]);
  }
  contains(n: unknown): boolean {
    return n === this || this.all().includes(n as FakeEl);
  }
  control(id: string): FakeEl | undefined {
    return this.all().find((e) => e.attrs.get("data-control") === id);
  }
  text(): string {
    return this.tag === "#text" ? this.textContent : this.textContent + this.children.map((c) => c.text()).join("");
  }
}

/** Installs a fake `document`/`window`; returns a root element and a restore function. */
export function installFakeDom(): { root: FakeEl; restore: () => void } {
  const g = globalThis as Record<string, unknown>;
  const before = { document: g.document, window: g.window };
  g.document = {
    createElement: (t: string) => new FakeEl(t),
    createElementNS: (_ns: string, t: string) => new FakeEl(t),
    activeElement: null,
  };
  g.window = { addEventListener: () => undefined };
  return {
    root: new FakeEl("div"),
    restore: () => {
      g.document = before.document;
      g.window = before.window;
    },
  };
}

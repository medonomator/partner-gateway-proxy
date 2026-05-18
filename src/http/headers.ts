/**
 * Case-insensitive headers map.
 *
 * HTTP header names are case-insensitive (RFC 7230 §3.2). The rest of the
 * gateway treats headers as a stable lookup table, so we normalize to
 * lowercase on the way in. Anything that needs the original casing should
 * not be using this type.
 */
export class Headers {
  private readonly map = new Map<string, string>();

  constructor(init?: Record<string, string> | Headers | ReadonlyArray<[string, string]>) {
    if (!init) return;
    if (init instanceof Headers) {
      for (const [k, v] of init.entries()) this.map.set(k, v);
      return;
    }
    if (Array.isArray(init)) {
      for (const [k, v] of init) this.map.set(k.toLowerCase(), v);
      return;
    }
    for (const [k, v] of Object.entries(init)) this.map.set(k.toLowerCase(), v);
  }

  get(name: string): string | undefined {
    return this.map.get(name.toLowerCase());
  }

  set(name: string, value: string): void {
    this.map.set(name.toLowerCase(), value);
  }

  has(name: string): boolean {
    return this.map.has(name.toLowerCase());
  }

  delete(name: string): boolean {
    return this.map.delete(name.toLowerCase());
  }

  entries(): IterableIterator<[string, string]> {
    return this.map.entries();
  }

  toObject(): Record<string, string> {
    return Object.fromEntries(this.map);
  }

  clone(): Headers {
    return new Headers(this);
  }
}

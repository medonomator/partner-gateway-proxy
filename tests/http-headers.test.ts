import { describe, expect, it } from 'vitest';
import { Headers } from '../src/http';

describe('Headers', () => {
  it('is case-insensitive on get/set/has/delete', () => {
    const h = new Headers();
    h.set('Authorization', 'Bearer abc');
    expect(h.get('authorization')).toBe('Bearer abc');
    expect(h.get('AUTHORIZATION')).toBe('Bearer abc');
    expect(h.has('Authorization')).toBe(true);
    expect(h.delete('AUTHORIZATION')).toBe(true);
    expect(h.has('authorization')).toBe(false);
  });

  it('accepts an init record / array / Headers', () => {
    const fromObj = new Headers({ 'X-A': '1' });
    const fromArr = new Headers([['X-B', '2']]);
    const fromHeaders = new Headers(fromObj);
    expect(fromObj.get('x-a')).toBe('1');
    expect(fromArr.get('x-b')).toBe('2');
    expect(fromHeaders.get('x-a')).toBe('1');
  });

  it('clones independently', () => {
    const a = new Headers({ 'x-foo': '1' });
    const b = a.clone();
    b.set('x-foo', '2');
    expect(a.get('x-foo')).toBe('1');
    expect(b.get('x-foo')).toBe('2');
  });
});

import { computeTextNoCommentsHash, computeTsSignatureHash } from './SentinelService';

describe('SentinelService', () => {
  it('newline/formatting changes do not change text_nocomments_v1 hash', () => {
    const original = 'const total = 1; // comment\n';
    const reformatted = 'const   total = 1;\n\n';

    expect(computeTextNoCommentsHash(original)).toBe(computeTextNoCommentsHash(reformatted));
  });

  it('changing exported signature changes ts_signature_v1 hash', () => {
    const before = 'export function foo(a: string): number { return 1; }';
    const after = 'export function foo(a: number): number { return 1; }';

    expect(computeTsSignatureHash(before, 'function:foo')).not.toBe(
      computeTsSignatureHash(after, 'function:foo')
    );
  });

  it('changing body does not change ts_signature_v1 hash', () => {
    const before = 'export function foo(a: string): number { const count = a.length; return count; }';
    const after = 'export function foo(a: string): number { const total = a.length; return total; }';

    expect(computeTsSignatureHash(before, 'function:foo')).toBe(
      computeTsSignatureHash(after, 'function:foo')
    );
  });
});

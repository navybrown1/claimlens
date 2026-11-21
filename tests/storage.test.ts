import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSavedRuns, putSavedRuns } from '../src/lib/storage';
import { generateDemo } from '../src/lib/demo';
import { DEFAULT_POLICY } from '../src/lib/audit';
import type { SavedRun } from '../src/types';

const KEY = 'claimlens.runs.v1';
const run = (): SavedRun => ({ id: 'audit-1', name: 'Review', createdAt: '2026-11-20T20:00:00Z', ...generateDemo(), policy: { ...DEFAULT_POLICY }, decisions: {}, events: [], comparisonClaims: [], isDemo: false });
let data: Map<string, string>;

beforeEach(() => {
  data = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('saved audit storage', () => {
  it('round-trips complete validated audit snapshots', () => {
    const snapshot = run();
    snapshot.comparisonClaims = [{ ...snapshot.claims[0], id: 'OLD-1' }];
    putSavedRuns([snapshot]);
    expect(getSavedRuns()).toEqual([snapshot]);
  });
  it('discards a corrupt snapshot without losing healthy snapshots', () => {
    const good = run();
    data.set(KEY, JSON.stringify([null, { ...good, id: 'broken', claims: [{ amount: null }] }, good]));
    expect(getSavedRuns()).toHaveLength(1);
    expect(getSavedRuns()[0].id).toBe(good.id);
  });
  it('rejects invalid policy and decision types before writing', () => {
    const good = run();
    putSavedRuns([good]);
    const prior = data.get(KEY);
    expect(() => putSavedRuns([{ ...good, policy: { ...DEFAULT_POLICY, mealLimit: NaN } }])).toThrow();
    expect(data.get(KEY)).toBe(prior);
    expect(() => putSavedRuns([{ ...good, decisions: 5 } as unknown as SavedRun])).toThrow();
  });
  it('never persists extra configuration, including nested key-like fields', () => {
    const good = run();
    const untrusted = { ...good, apiKey: 'TOP-LEVEL-SECRET', claims: [{ ...good.claims[0], apiKey: 'NESTED-SECRET' }], policy: { ...good.policy, apiKey: 'POLICY-SECRET' } };
    putSavedRuns([untrusted]);
    expect(data.get(KEY)).not.toContain('SECRET');
  });
  it('does not infer that a real audit is demo data from its name', () => {
    const old = { ...run(), name: 'Demo expenses', isDemo: undefined };
    data.set(KEY, JSON.stringify([old]));
    expect(getSavedRuns()[0].isDemo).toBe(false);
  });
  it('returns an empty state for unavailable or malformed storage', () => {
    data.set(KEY, '{broken');
    expect(getSavedRuns()).toEqual([]);
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('Blocked'); } });
    expect(getSavedRuns()).toEqual([]);
  });
  it('propagates a quota failure so the UI can download a backup', () => {
    vi.stubGlobal('localStorage', { setItem: () => { throw new Error('Quota exceeded'); } });
    expect(() => putSavedRuns([run()])).toThrow('Quota exceeded');
  });
  it('retains prototype-like claim identifiers without changing object prototypes', () => {
    const good = run();
    good.claims[0].id = '__proto__';
    good.decisions = JSON.parse('{"__proto__":{"decision":"follow-up","note":"Verify details","updatedAt":"2026-11-20T20:00:00Z"}}');
    putSavedRuns([good]);
    const restored = getSavedRuns()[0];
    expect(Object.getPrototypeOf(restored.decisions)).toBeNull();
    expect(restored.decisions['__proto__'].decision).toBe('follow-up');
    expect(({} as Record<string, unknown>).decision).toBeUndefined();
  });
});

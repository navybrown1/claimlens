import { describe, expect, it } from 'vitest';
import { auditClaims, DEFAULT_POLICY } from '../src/lib/audit';
import { generateDemo } from '../src/lib/demo';
import type { Claim, Employee, Policy } from '../src/types';

const NOW = new Date('2026-11-20T18:00:00Z');
const roster: Employee[] = [{ id: 'E-1', name: 'Jamie Smith', department: 'Sales', status: 'active' }];
const base: Claim = { id: 'C-1', employeeId: 'E-1', employeeName: 'Jamie Smith', department: 'Sales', date: '2026-11-18', submittedDate: '2026-11-19', merchant: 'Cafe', category: 'Meals', amount: 24.5, currency: 'USD', receipt: true, description: 'Client meeting' };
const check = (changes: Partial<Claim> = {}, policy: Partial<Policy> = {}) => auditClaims([{ ...base, ...changes }], roster, { ...DEFAULT_POLICY, ...policy }, [], NOW)[0];
const codes = (claim: ReturnType<typeof check>) => claim.findings.map(finding => finding.code);

describe('deterministic claim review', () => {
  it('clears a complete expense inside policy without creating a decision', () => {
    const result = check();
    expect(result.status).toBe('clear');
    expect(result.riskScore).toBe(0);
    expect(result.findings).toEqual([]);
    expect(result).not.toHaveProperty('decision');
  });
  it('flags both duplicate rows with the related claim ID', () => {
    const result = auditClaims([base, { ...base, id: 'C-2' }], roster, DEFAULT_POLICY, [], NOW);
    expect(result.every(claim => claim.status === 'hold')).toBe(true);
    expect(result[0].findings.find(finding => finding.code === 'duplicate')?.relatedIds).toEqual(['C-2']);
    expect(result[1].findings.find(finding => finding.code === 'duplicate')?.relatedIds).toEqual(['C-1']);
  });
  it('does not confuse a prior snapshot of the same claim with a duplicate', () => {
    expect(auditClaims([base], roster, DEFAULT_POLICY, [{ ...base }], NOW)[0].status).toBe('clear');
    const result = auditClaims([base], roster, DEFAULT_POLICY, [{ ...base, id: 'OLD-1' }], NOW)[0];
    expect(codes(result)).toContain('history-duplicate');
  });
  it('finds nearby repeats in the current batch and previous runs', () => {
    const other = { ...base, id: 'C-2', date: '2026-11-16' };
    expect(codes(auditClaims([base, other], roster, DEFAULT_POLICY, [], NOW)[0])).toContain('near-duplicate');
    expect(codes(auditClaims([base], roster, DEFAULT_POLICY, [other], NOW)[0])).toContain('history-near-duplicate');
    expect(codes(auditClaims([base], roster, DEFAULT_POLICY, [{ ...other, id: base.id }], NOW)[0])).not.toContain('history-near-duplicate');
  });
  it('keeps currency-specific limits separate without inventing exchange rates', () => {
    const result = check({ currency: 'JPY', amount: 8000 });
    expect(codes(result)).toContain('currency');
    expect(codes(result)).not.toContain('meal-limit');
    expect(codes(result)).not.toContain('high-value');
  });
  it('applies the receipt threshold inclusively and allows smaller unreceipted amounts', () => {
    expect(codes(check({ amount: 25, receipt: false }))).toContain('missing-receipt');
    expect(codes(check({ amount: 24.99, receipt: false }))).not.toContain('missing-receipt');
  });
  it('checks inactive and unknown employees without conflating IDs that differ by punctuation', () => {
    expect(codes(check({ employeeId: 'UNKNOWN' }))).toContain('unknown-employee');
    expect(codes(check({ employeeId: 'E1' }))).toContain('unknown-employee');
    const inactive = auditClaims([base], [{ ...roster[0], status: 'inactive' }], DEFAULT_POLICY, [], NOW)[0];
    expect(codes(inactive)).toContain('inactive-employee');
  });
  it('does not report an empty employee list as successful verification', () => {
    expect(codes(auditClaims([base], [], DEFAULT_POLICY, [], NOW)[0])).toContain('missing-roster');
  });
  it('checks submission age, date validity, future dates, and date ordering', () => {
    expect(codes(check({ date: '2026-09-01' }))).toContain('late-submission');
    expect(codes(check({ date: '2026-11-30' }))).toEqual(expect.arrayContaining(['future-date', 'date-order']));
    expect(codes(check({ date: '2026-02-30' }))).toContain('invalid-date');
    expect(codes(check({ submittedDate: '' }))).toContain('submission-date');
    expect(codes(check({ submittedDate: '2026-11-21' }))).toContain('future-submission');
  });
  it('uses the reviewer local calendar day when UTC has already reached tomorrow', () => {
    const prior = process.env.TZ;
    try {
      process.env.TZ = 'America/New_York';
      const evening = new Date('2026-11-21T01:00:00Z');
      expect(evening.getDate()).toBe(20);
      const tomorrow = auditClaims([{ ...base, date: '2026-11-21', submittedDate: '2026-11-21' }], roster, DEFAULT_POLICY, [], evening)[0];
      expect(codes(tomorrow)).toEqual(expect.arrayContaining(['future-date', 'future-submission']));
      const today = auditClaims([{ ...base, date: '2026-11-20', submittedDate: '2026-11-20' }], roster, DEFAULT_POLICY, [], evening)[0];
      expect(codes(today)).not.toContain('future-date');
    } finally {
      if (prior === undefined) delete process.env.TZ;
      else process.env.TZ = prior;
    }
  });
  it('honors configurable optional rules and recalculates against new limits', () => {
    expect(codes(check({ date: '2026-11-15' }))).not.toContain('weekend');
    expect(codes(check({ date: '2026-11-15' }, { weekendReview: true }))).toContain('weekend');
    expect(codes(check({ description: '' }, { requiredDescription: false }))).not.toContain('missing-purpose');
    expect(check({}, { blockedMerchants: ['cafe'] }).status).toBe('hold');
    expect(codes(check({ amount: 90 }, { mealLimit: 100 }))).not.toContain('meal-limit');
  });
  it('checks mileage against the configured rate without assuming a legal entitlement', () => {
    expect(codes(check({ category: 'Mileage', amount: 70, mileage: 100 }))).not.toContain('mileage-limit');
    expect(codes(check({ category: 'Mileage', amount: 71, mileage: 100 }))).toContain('mileage-limit');
    expect(codes(check({ category: 'Mileage' }))).toContain('missing-mileage');
  });
  it('caps the risk score and holds high-priority exceptions', () => {
    const result = check({ employeeId: 'UNKNOWN', amount: 5000, receipt: false, description: '' });
    expect(result.status).toBe('hold');
    expect(result.riskScore).toBe(100);
  });
  it('produces a coherent fictional demo with clear claims and multiple exception types', () => {
    const demo = generateDemo();
    expect(demo.claims).toHaveLength(36);
    expect(new Set(demo.employees.map(employee => employee.department)).size).toBe(5);
    const results = auditClaims(demo.claims, demo.employees, DEFAULT_POLICY);
    expect(results.some(claim => claim.status === 'clear')).toBe(true);
    expect(results.some(claim => claim.status === 'hold')).toBe(true);
    expect(results.some(claim => claim.status === 'fix')).toBe(true);
    expect(new Set(results.flatMap(claim => claim.findings.map(finding => finding.code))).size).toBeGreaterThan(8);
  });
  it('handles a 10,000-row repeated batch with bounded evidence lists', () => {
    const batch = Array.from({ length: 10000 }, (_, index) => ({ ...base, id: `C-${index}` }));
    const result = auditClaims(batch, roster, DEFAULT_POLICY, [], NOW);
    expect(result).toHaveLength(10000);
    expect(result.every(claim => claim.findings[0].relatedIds!.length <= 5)).toBe(true);
  });
});

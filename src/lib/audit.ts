import type { AuditedClaim, Claim, Employee, Finding, Policy } from '../types';

/** These are editable example company-policy limits, not statutory rates. */
export const DEFAULT_POLICY: Policy = {
  baseCurrency: 'USD', receiptThreshold: 25, mealLimit: 75, hotelLimit: 250,
  mileageRate: 0.7, submissionWindow: 30, maxClaimAmount: 2500,
  weekendReview: false, blockedMerchants: [], requiredDescription: true,
};

const DAY = 86_400_000;
const normalize = (value: string) => String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
const identifier = (value: string) => String(value ?? '').trim().toLowerCase();
const money = (value: number, currency: string) => `${currency || 'currency'} ${value.toFixed(2)}`;
const dateNumber = (value: string): number => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return NaN;
  const date = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(date) && new Date(date).toISOString().slice(0, 10) === value ? date : NaN;
};
const fingerprint = (claim: Claim) => [identifier(claim.employeeId), normalize(claim.merchant), claim.date, claim.currency.toUpperCase(), Math.round(claim.amount * 100)].join('|');
const nearKey = (claim: Claim) => [identifier(claim.employeeId), normalize(claim.merchant), claim.currency.toUpperCase(), Math.round(claim.amount * 100)].join('|');

function addToMap<T>(map: Map<string, T[]>, key: string, item: T) {
  const items = map.get(key);
  if (items) items.push(item);
  else map.set(key, [item]);
}

/** Deterministic review signals. They never approve, reject, or accuse a claimant. */
export function auditClaims(claims: Claim[], employees: Employee[], policy: Policy, history: Claim[] = [], now = new Date()): AuditedClaim[] {
  const exact = new Map<string, Claim[]>();
  const historical = new Map<string, Claim[]>();
  const roster = new Map(employees.map(employee => [identifier(employee.id), employee]));
  const near = new Map<string, Claim[]>();
  const historyNear = new Map<string, Map<string, string[]>>();
  const nearMatches = new Map<Claim, string[]>();
  const ids = new Map<string, number>();
  // Compare calendar dates in the reviewer's timezone, then use UTC day arithmetic
  // so daylight-saving changes cannot turn a day into 23 or 25 hours.
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  for (const claim of claims) {
    addToMap(exact, fingerprint(claim), claim);
    addToMap(near, nearKey(claim), claim);
    ids.set(identifier(claim.id), (ids.get(identifier(claim.id)) ?? 0) + 1);
  }
  for (const claim of history) {
    const key = fingerprint(claim);
    const matches = historical.get(key) ?? [];
    if (matches.length < 6 && !matches.some(match => match.id === claim.id)) historical.set(key, [...matches, claim]);
    if (Number.isFinite(dateNumber(claim.date))) {
      const historyDays = historyNear.get(nearKey(claim)) ?? new Map<string, string[]>();
      const dayIds = historyDays.get(claim.date) ?? [];
      if (dayIds.length < 6 && !dayIds.includes(claim.id)) historyDays.set(claim.date, [...dayIds, claim.id]);
      historyNear.set(nearKey(claim), historyDays);
    }
  }
  // Only adjacent distinct dates are needed to detect the closest potential duplicate.
  // This keeps large files bounded instead of comparing every pair of claims.
  for (const group of near.values()) {
    const byDate = new Map<string, Claim[]>();
    for (const claim of group) if (Number.isFinite(dateNumber(claim.date))) addToMap(byDate, claim.date, claim);
    const days = [...byDate.keys()].sort();
    for (let i = 0; i < days.length; i++) {
      const candidates = [days[i - 1], days[i + 1]].filter(day => day && Math.abs(dateNumber(day) - dateNumber(days[i])) <= 3 * DAY);
      if (!candidates.length) continue;
      const related = candidates.flatMap(day => (byDate.get(day) ?? []).slice(0, 3).map(claim => claim.id)).slice(0, 5);
      for (const claim of byDate.get(days[i]) ?? []) nearMatches.set(claim, related);
    }
  }
  return claims.map(claim => {
    const findings: Finding[] = [];
    const add = (code: string, title: string, description: string, severity: Finding['severity'], relatedIds?: string[]) => findings.push({ code, title, description, severity, ...(relatedIds ? { relatedIds } : {}) });
    const currency = claim.currency.toUpperCase();
    const sameCurrency = currency === policy.baseCurrency.toUpperCase();
    const employee = roster.get(identifier(claim.employeeId));
    const expenseDate = dateNumber(claim.date);
    const submittedDate = dateNumber(claim.submittedDate);
    const sameBatch = (exact.get(fingerprint(claim)) ?? []).slice(0, 6).filter(other => other !== claim);
    const pastBatch = (historical.get(fingerprint(claim)) ?? []).filter(other => identifier(other.id) !== identifier(claim.id));
    const nearbyHistory: string[] = [];
    if (Number.isFinite(expenseDate)) {
      const historyDays = historyNear.get(nearKey(claim));
      for (let offset = -3; offset <= 3; offset++) {
        if (offset === 0) continue;
        const day = new Date(expenseDate + offset * DAY).toISOString().slice(0, 10);
        nearbyHistory.push(...(historyDays?.get(day) ?? []).filter(id => identifier(id) !== identifier(claim.id)));
      }
    }
    if ((ids.get(identifier(claim.id)) ?? 0) > 1) add('duplicate-id', 'Repeated claim ID', 'More than one row uses this ID. Correct the source file before recording a decision.', 'high');
    if (sameBatch.length) add('duplicate', 'Possible duplicate', 'Another claim has the same employee, merchant, date, currency, and amount. Check the original receipts.', 'high', sameBatch.slice(0, 5).map(other => other.id));
    if (pastBatch.length) add('history-duplicate', 'Matches a previous run', 'A different claim ID in the loaded history has the same employee, merchant, date, currency, and amount.', 'high', [...new Set(pastBatch.map(other => other.id))].slice(0, 5));
    if (!sameBatch.length && nearMatches.has(claim)) add('near-duplicate', 'Similar nearby expense', 'The same employee submitted the same amount at this merchant within three days. Confirm that these were separate purchases.', 'medium', nearMatches.get(claim));
    if (!pastBatch.length && nearbyHistory.length) add('history-near-duplicate', 'Similar expense in history', 'The same employee has the same merchant, amount, and currency within three days in loaded history. Confirm these were separate purchases.', 'medium', [...new Set(nearbyHistory)].slice(0, 5));
    if (!employees.length) add('missing-roster', 'Employee list needed', 'Load an employee list to verify the claimant and department.', 'medium');
    else if (!employee) add('unknown-employee', 'Employee not found', 'This employee ID does not appear in the loaded employee list.', 'high');
    else {
      if (employee.status === 'inactive') add('inactive-employee', 'Inactive employee', 'The employee is marked inactive in the loaded roster. Confirm eligibility before payment.', 'high');
      if (claim.department && employee.department && normalize(claim.department) !== normalize(employee.department)) add('department-mismatch', 'Department differs', `The claim department differs from the roster department (${employee.department}). Verify the cost allocation.`, 'medium');
      if (claim.employeeName && employee.name && normalize(claim.employeeName) !== normalize(employee.name)) add('name-mismatch', 'Employee name differs', 'The claim name does not match the employee ID in the roster. Check the identity mapping.', 'medium');
    }
    if (!Number.isFinite(claim.amount) || claim.amount <= 0) add('invalid-amount', 'Invalid expense amount', 'The amount must be a finite, positive number. Credits should be reconciled separately.', 'high');
    if (!sameCurrency) add('currency', 'Currency conversion needed', `This claim is in ${currency || 'an unspecified currency'}; the policy is in ${policy.baseCurrency}. Currency-based limits are not applied and totals must be reviewed separately.`, 'medium');
    if (!claim.receipt && (!sameCurrency || claim.amount >= policy.receiptThreshold)) add('missing-receipt', 'Receipt needed', sameCurrency ? `No receipt is recorded for an expense at or above the ${money(policy.receiptThreshold, policy.baseCurrency)} threshold.` : 'A receipt is not recorded. Verify the receipt requirement after currency conversion.', 'medium');
    const category = normalize(claim.category);
    if (sameCurrency && /meal|food|dining|restaurant/.test(category) && claim.amount > policy.mealLimit) add('meal-limit', 'Meal over policy', `${money(claim.amount, currency)} exceeds the per-claim meal limit of ${money(policy.mealLimit, currency)}. Confirm whether this covers multiple attendees.`, 'medium');
    if (sameCurrency && /hotel|lodging|accommodation/.test(category) && claim.amount > policy.hotelLimit) add('hotel-limit', 'Lodging over policy', `${money(claim.amount, currency)} exceeds the per-claim lodging limit of ${money(policy.hotelLimit, currency)}. Check the number of nights before deciding.`, 'medium');
    if (sameCurrency && claim.amount > policy.maxClaimAmount) add('high-value', 'High-value expense', `The amount exceeds the ${money(policy.maxClaimAmount, currency)} review threshold. Supporting approval is required.`, 'high');
    if (!Number.isFinite(expenseDate)) add('invalid-date', 'Expense date needed', 'Supply a valid expense date in YYYY-MM-DD format.', 'medium');
    else {
      if (expenseDate > today) add('future-date', 'Future expense date', 'The expense date is later than today. Check for a data-entry mistake or a prepaid purchase.', 'medium');
      if (policy.weekendReview && [0, 6].includes(new Date(expenseDate).getUTCDay())) add('weekend', 'Weekend expense', 'The expense falls on a weekend and the optional weekend-review rule is enabled.', 'low');
    }
    if (!Number.isFinite(submittedDate)) add('submission-date', 'Submission date needed', 'The submission date is missing or invalid, so the submission window could not be checked.', 'medium');
    else {
      if (submittedDate > today) add('future-submission', 'Future submission date', 'The submission date is later than today. Check the source export.', 'medium');
      if (Number.isFinite(expenseDate) && submittedDate < expenseDate) add('date-order', 'Dates out of order', 'The submission date precedes the expense date. Confirm whether this is a prepaid purchase or a data-entry issue.', 'medium');
      if (Number.isFinite(expenseDate) && submittedDate - expenseDate > policy.submissionWindow * DAY) add('late-submission', 'Submitted outside window', `Submitted ${Math.floor((submittedDate - expenseDate) / DAY)} days after the expense. Policy allows ${policy.submissionWindow} days.`, 'medium');
    }
    if (policy.requiredDescription && !claim.description.trim()) add('missing-purpose', 'Business purpose needed', 'Add a brief explanation of the business purpose before the claim is approved.', 'medium');
    if (!claim.merchant.trim()) add('missing-merchant', 'Merchant needed', 'The merchant is missing. Add it to support duplicate checks and the review trail.', 'medium');
    if (!claim.category.trim()) add('missing-category', 'Category needed', 'Add an expense category so the appropriate policy limits can be checked.', 'medium');
    if (claim.mileage !== undefined && (!Number.isFinite(claim.mileage) || claim.mileage <= 0)) add('invalid-mileage', 'Mileage needs correction', 'Mileage must be a positive number when supplied.', 'medium');
    else if (sameCurrency && /mileage|miles/.test(category) && claim.mileage === undefined) add('missing-mileage', 'Distance needed', 'Enter the distance in miles to check the mileage reimbursement rate.', 'medium');
    else if (sameCurrency && /mileage|miles/.test(category) && claim.mileage !== undefined && Math.round(claim.amount * 100) > Math.round(claim.mileage * policy.mileageRate * 100)) add('mileage-limit', 'Mileage over policy', `The amount exceeds ${claim.mileage} miles × ${money(policy.mileageRate, currency)} per mile. This rate is your editable company policy.`, 'medium');
    if (policy.blockedMerchants.some(merchant => normalize(merchant) && normalize(claim.merchant).includes(normalize(merchant)))) add('blocked-merchant', 'Restricted merchant', 'The merchant matches your restricted-merchant list. Confirm the restriction and any documented exception.', 'high');
    const severityPoints = { high: 65, medium: 25, low: 10 };
    const riskScore = Math.min(100, findings.reduce((sum, finding) => sum + severityPoints[finding.severity], 0));
    const status = findings.some(finding => finding.severity === 'high') ? 'hold' : findings.length ? 'fix' : 'clear';
    return { ...claim, employeeName: claim.employeeName || employee?.name || claim.employeeId, department: claim.department || employee?.department || 'Unassigned', findings, riskScore, status };
  });
}

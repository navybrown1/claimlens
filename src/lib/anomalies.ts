import type { AuditedClaim, Policy } from "../types";

/**
 * Explainable, local-first behavioral screening.
 * All claims are examined. No model is trained, no fraud probability is calculated,
 * and no records are sent to a provider by this function.
 */
export type AnomalySeverity = "high" | "medium" | "low";
export interface AnomalySignal {
  code: string;
  title: string;
  explanation: string;
  severity: AnomalySeverity;
  relatedIds: string[];
}
export interface AnomalyItem {
  claimId: string;
  score: number;
  priority: AnomalySeverity;
  signals: AnomalySignal[];
}
export interface AnomalyReport {
  scanned: number;
  flagged: number;
  high: number;
  medium: number;
  signalCount: number;
  patterns: { code: string; title: string; count: number }[];
  items: AnomalyItem[];
}

type Member = AuditedClaim & { day: number };
type Stats = { size: number; median: number; mad: number };
const DAY = 86_400_000;
const MAX_NEIGHBORS = 30;
const weights: Record<string, number> = {
  "category-outlier": 28,
  "employee-outlier": 26,
  "merchant-outlier": 24,
  "near-duplicate": 43,
  "split-charges": 30,
  "rapid-repeat": 24,
  "merchant-concentration": 18,
};
const normalize = (value: string) =>
  String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const dayNumber = (iso: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || "")) return NaN;
  const value = Date.parse(iso + "T00:00:00Z");
  return Number.isFinite(value) && new Date(value).toISOString().slice(0, 10) === iso
    ? value / DAY : NaN;
};
const median = (nums: number[]) => {
  if (!nums.length) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const statistics = (nums: number[]): Stats => {
  const center = median(nums);
  return { size: nums.length, median: center, mad: median(nums.map((x) => Math.abs(x - center))) * 1.4826 };
};
const key = (...parts: string[]) => parts.map((p) => p.toLowerCase().trim()).join("|");
const asMoney = (amount: number, currency: string) => currency + " " + amount.toFixed(2);
const isPositive = (claim: AuditedClaim) => Number.isFinite(claim.amount) && claim.amount > 0;
const append = <T>(map: Map<string, T[]>, group: string, value: T) => {
  const list = map.get(group);
  if (list) list.push(value);
  else map.set(group, [value]);
};

// Compare vendor spelling variations only for the same employee and currency.
// A close spelling is a lead to investigate, never a definitive match.
function vendorSimilar(a: string, b: string): boolean {
  const left = normalize(a);
  const right = normalize(b);
  if (left === right && left.length >= 3) return true;
  if (left.length < 6 || right.length < 6) return false;
  if (left.includes(right) || right.includes(left)) {
    return Math.min(left.length, right.length) / Math.max(left.length, right.length) >= 0.77;
  }
  const maxDistance = Math.floor(Math.max(left.length, right.length) * 0.18);
  if (Math.abs(left.length - right.length) > maxDistance) return false;
  let previous = Array.from({ length: right.length + 1 }, (_, n) => n);
  for (let i = 1; i <= left.length; i++) {
    const current = [i];
    for (let j = 1; j <= right.length; j++) {
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1));
    }
    if (Math.min(...current) > maxDistance) return false;
    previous = current;
  }
  return previous[right.length] <= maxDistance;
}

export function detectAnomalies(claims: AuditedClaim[], policy: Policy): AnomalyReport {
  if (!claims.length) return { scanned: 0, flagged: 0, high: 0, medium: 0, signalCount: 0, patterns: [], items: [] };
  const signalById = new Map<string, AnomalySignal[]>();
  const add = (claim: AuditedClaim, code: string, title: string, explanation: string, severity: AnomalySeverity, relatedIds: string[] = []) => {
    const signals = signalById.get(claim.id) || [];
    if (signals.some((signal) => signal.code === code)) {
      const earlier = signals.find((signal) => signal.code === code)!;
      earlier.relatedIds = [...new Set([...earlier.relatedIds, ...relatedIds])].slice(0, 8);
      return;
    }
    signals.push({ code, title, explanation, severity, relatedIds: [...new Set(relatedIds)].filter((id) => id !== claim.id).slice(0, 8) });
    signalById.set(claim.id, signals);
  };

  const categories = new Map<string, number[]>();
  const employees = new Map<string, AuditedClaim[]>();
  const employeeAmounts = new Map<string, number[]>();
  const merchants = new Map<string, number[]>();
  const vendorsByEmployee = new Map<string, AuditedClaim[]>();
  const valid: Member[] = [];

  for (const claim of claims) {
    const employeeKey = key(claim.employeeId, claim.currency);
    append(employees, employeeKey, claim);
    if (!isPositive(claim)) continue; // credits are reconciled separately
    append(categories, key(claim.category, claim.currency), claim.amount);
    append(employeeAmounts, employeeKey, claim.amount);
    if (claim.merchant.trim()) {
      append(merchants, key(normalize(claim.merchant), claim.category, claim.currency), claim.amount);
      append(vendorsByEmployee, employeeKey, claim);
    }
    const day = dayNumber(claim.date);
    if (Number.isFinite(day)) valid.push({ ...claim, day });
  }

  const categoryStats = new Map([...categories].map(([id, amounts]) => [id, statistics(amounts)]));
  const employeeStats = new Map([...employeeAmounts].map(([id, amounts]) => [id, statistics(amounts)]));
  const merchantStats = new Map([...merchants].map(([id, amounts]) => [id, statistics(amounts)]));
  // Cohort minimums avoid strong findings from one or two records.
  for (const claim of claims) {
    if (!isPositive(claim)) continue;
    const cohort = categoryStats.get(key(claim.category, claim.currency));
    if (cohort && cohort.size >= 10 && cohort.median >= 1 &&
      claim.amount >= Math.max(cohort.median * 3, cohort.median + cohort.mad * 4.5, cohort.median + 40)) {
      add(claim, "category-outlier", "Unusual amount for category",
        asMoney(claim.amount, claim.currency) + " is unusually high against " + cohort.size +
        " " + claim.category + " claims (median " + asMoney(cohort.median, claim.currency) +
        "). Compare the underlying purpose and receipts.", "medium");
    }
    const staff = employeeStats.get(key(claim.employeeId, claim.currency));
    if (staff && staff.size >= 8 && staff.median >= 1 &&
      claim.amount >= Math.max(staff.median * 4, staff.median + staff.mad * 5, staff.median + 60)) {
      add(claim, "employee-outlier", "Unusual amount for this employee",
        asMoney(claim.amount, claim.currency) + " exceeds this employee's typical positive claim amount (" +
        asMoney(staff.median, claim.currency) + " median across " + staff.size +
        " claims). Categories may legitimately differ.", "medium");
    }
    const merchant = merchantStats.get(key(normalize(claim.merchant), claim.category, claim.currency));
    if (merchant && merchant.size >= 6 && merchant.median >= 1 &&
      claim.amount >= Math.max(merchant.median * 2.7, merchant.median + merchant.mad * 4.5, merchant.median + 35)) {
      add(claim, "merchant-outlier", "Unusual amount at this merchant",
        asMoney(claim.amount, claim.currency) + " is high relative to " + merchant.size +
        " same-category expenses at this merchant (median " + asMoney(merchant.median, claim.currency) + ").",
        "medium");
    }
  }

  // Sliding-window search is bounded even for 10,000-record imports.
  const datesByEmployee = new Map<string, Member[]>();
  for (const claim of valid) append(datesByEmployee, key(claim.employeeId, claim.currency), claim);
  for (const group of datesByEmployee.values()) {
    group.sort((a, b) => a.day - b.day || a.id.localeCompare(b.id));
    for (let i = 0; i < group.length; i++) {
      const left = group[i];
      for (let j = i + 1; j < group.length && j <= i + MAX_NEIGHBORS; j++) {
        const right = group[j];
        if (right.day - left.day > 7) break;
        if (!vendorSimilar(left.merchant, right.merchant)) continue;
        if (Math.abs(left.amount - right.amount) <= Math.max(2, Math.max(left.amount, right.amount) * 0.02)) {
          if (left.day === right.day && normalize(left.merchant) === normalize(right.merchant) && left.amount === right.amount) continue; // already in rule engine
          const description = "Another claim for a similarly named merchant, close amount and within seven days. Compare source receipts before treating them as duplicates.";
          add(left, "near-duplicate", "Possible near-duplicate", description, "high", [right.id]);
          add(right, "near-duplicate", "Possible near-duplicate", description, "high", [left.id]);
        }
        if (right.day - left.day > 2 || left.category.toLowerCase() !== right.category.toLowerCase()) continue;
        const name = normalize(left.category);
        const threshold = /meal|food|dining|restaurant/.test(name) ? policy.mealLimit :
          /hotel|lodging|accommodation/.test(name) ? policy.hotelLimit : 0;
        if (threshold > 0 && left.amount < threshold && right.amount < threshold &&
          left.amount + right.amount > threshold) {
          const msg = "Two nearby claims at the same merchant each fall below the configured " +
            asMoney(threshold, left.currency) + " category limit, but total " +
            asMoney(left.amount + right.amount, left.currency) +
            ". Separate purchases and multiple attendees are possible; verify context.";
          add(left, "split-charges", "Grouped charges above review limit", msg, "medium", [right.id]);
          add(right, "split-charges", "Grouped charges above review limit", msg, "medium", [left.id]);
        }
      }
    }
  }

  const vendorWindows = new Map<string, Member[]>();
  for (const claim of valid) append(vendorWindows, key(claim.employeeId, normalize(claim.merchant), claim.currency), claim);
  for (const group of vendorWindows.values()) {
    if (group.length < 4) continue;
    group.sort((a, b) => a.day - b.day);
    let start = 0;
    for (let end = 0; end < group.length; end++) {
      while (group[end].day - group[start].day > 1) start++;
      if (end - start + 1 < 4) continue;
      const matched = group.slice(start, end + 1);
      const ids = matched.map((claim) => claim.id);
      for (const claim of matched) {
        add(claim, "rapid-repeat", "Cluster of same-merchant claims",
          matched.length + " claims for this employee at the merchant fall within 24 hours. Verify that each is a distinct business expense.",
          "medium", ids.filter((id) => id !== claim.id));
      }
    }
  }

  for (const group of employees.values()) {
    const positive = group.filter(isPositive);
    if (positive.length < 8) continue;
    const sum = positive.reduce((total, c) => total + c.amount, 0);
    if (sum < 300) continue;
    const byVendor = new Map<string, AuditedClaim[]>();
    for (const claim of positive) if (claim.merchant.trim()) append(byVendor, normalize(claim.merchant), claim);
    for (const vendor of byVendor.values()) {
      if (vendor.length < 5) continue;
      const vendorSum = vendor.reduce((total, c) => total + c.amount, 0);
      if (vendorSum / sum < 0.8) continue;
      for (const claim of vendor) {
        add(claim, "merchant-concentration", "Concentrated merchant spending",
          vendor.length + " of " + positive.length + " claims and " +
          Math.round(vendorSum / sum * 100) + "% of this employee's positive claim value are with this merchant. This can be legitimate recurring work.",
          "low");
      }
    }
  }

  const items: AnomalyItem[] = claims
    .filter((c) => signalById.has(c.id))
    .map((c) => {
      const signals = signalById.get(c.id)!;
      const score = Math.min(100, signals.reduce((n, signal) => n + (weights[signal.code] || 10), 0));
      return { claimId: c.id, score, priority: score >= 60 ? "high" as const : score >= 25 ? "medium" as const : "low" as const, signals };
    })
    .sort((a, b) => b.score - a.score || a.claimId.localeCompare(b.claimId));
  const codes = new Map<string, { code: string; title: string; count: number }>();
  for (const item of items) for (const signal of item.signals) {
    const row = codes.get(signal.code);
    if (row) row.count++;
    else codes.set(signal.code, { code: signal.code, title: signal.title, count: 1 });
  }
  const patterns = [...codes.values()].sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
  return {
    scanned: claims.length,
    flagged: items.length,
    high: items.filter((item) => item.priority === "high").length,
    medium: items.filter((item) => item.priority === "medium").length,
    signalCount: items.reduce((n, item) => n + item.signals.length, 0),
    patterns,
    items,
  };
}

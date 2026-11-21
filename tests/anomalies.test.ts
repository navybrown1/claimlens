import { describe, expect, it } from "vitest";
import { detectAnomalies, anomaliesToCSV } from "../src/lib/anomalies";
import { buildAIContext } from "../src/lib/ai";
import { sanitizeContext } from "../api/ai";
import { DEFAULT_POLICY } from "../src/lib/audit";
import type { AuditedClaim, Policy } from "../src/types";

const policy: Policy = { ...DEFAULT_POLICY };
const claim = (id: string, amount: number, options: Partial<AuditedClaim> = {}): AuditedClaim => ({
  id,
  employeeId: "EMP-1",
  employeeName: "Do Not Share Name",
  department: "Operations",
  date: "2026-09-12",
  submittedDate: "2026-09-13",
  merchant: "Example Vendor",
  category: "Meals",
  amount,
  currency: "USD",
  receipt: true,
  description: "Sensitive detail that must not leave this browser",
  findings: [],
  riskScore: 0,
  status: "clear",
  ...options,
});
describe("local behavioral anomaly analysis", () => {
  it("screens every claim and leaves an empty workspace safe", () => {
    expect(detectAnomalies([], policy)).toMatchObject({ scanned: 0, flagged: 0, high: 0 });
    const all = Array.from({ length: 675 }, (_, i) =>
      claim("TEST-" + i, 20 + (i % 17), {
        employeeId: "EMP-" + (i % 90),
        merchant: "Vendor " + (i % 40),
        category: i % 3 ? "Meals" : "Travel",
        date: "2026-09-" + String((i % 28) + 1).padStart(2, "0"),
      }),
    );
    const report = detectAnomalies(all, policy);
    expect(report.scanned).toBe(675);
    expect(report.flagged).toBeLessThanOrEqual(675);
    expect(new Set(report.items.map((item) => item.claimId)).size).toBe(report.items.length);
  });
  it("detects robust category and employee outliers with sufficient comparison records", () => {
    const claims = Array.from({ length: 12 }, (_, i) =>
      claim("BASE-" + i, 20 + i * 0.1, { employeeId: "EMP-" + i, merchant: "Vendor " + i }),
    );
    claims.push(claim("OUTLIER", 280, { employeeId: "EMP-X", merchant: "New merchant" }));
    const result = detectAnomalies(claims, policy);
    const target = result.items.find((item) => item.claimId === "OUTLIER");
    expect(target?.signals.some((signal) => signal.code === "category-outlier")).toBe(true);
    expect(target?.signals.find((signal) => signal.code === "category-outlier")?.explanation).toContain("median");
  });
  it("does not make unreliable statistical claims from tiny comparison groups or credits", () => {
    const result = detectAnomalies([
      claim("A", 10), claim("B", 2000, { employeeId: "OTHER", merchant: "Other" }),
      claim("REFUND", -50, { date: "2026-09-05" }),
    ], policy);
    expect(result.items.flatMap((item) => item.signals).some((signal) => /outlier/.test(signal.code))).toBe(false);
    expect(result.items.find((item) => item.claimId === "REFUND")).toBeUndefined();
  });
  it("finds similar merchants and near amounts, but does not label exact same-day duplicates twice", () => {
    const report = detectAnomalies([
      claim("A", 120, { merchant: "The Hotel Example", category: "Hotel", date: "2026-09-10" }),
      claim("B", 121, { merchant: "The-Hotel-Example", category: "Hotel", date: "2026-09-13" }),
      claim("UNRELATED", 120, { merchant: "The Hotel Example", employeeId: "OTHER", category: "Hotel", date: "2026-09-12" }),
    ], policy);
    expect(report.items.find((item) => item.claimId === "A")?.signals.find((s) => s.code === "near-duplicate")?.relatedIds).toContain("B");
    expect(report.items.find((item) => item.claimId === "A")?.priority).toBe("high");
    expect(report.items.find((item) => item.claimId === "UNRELATED")).toBeUndefined();
    const exact = detectAnomalies([
      claim("ONE", 15), claim("TWO", 15),
    ], policy);
    expect(exact.items.some((item) => item.signals.some((s) => s.code === "near-duplicate"))).toBe(false);
  });
  it("detects grouped charges that cross a configured meal threshold", () => {
    const report = detectAnomalies([
      claim("MEAL-A", 40, { date: "2026-09-11" }),
      claim("MEAL-B", 45, { date: "2026-09-12" }),
    ], policy);
    expect(report.items.find((item) => item.claimId === "MEAL-A")?.signals.some((s) => s.code === "split-charges")).toBe(true);
    const differentCurrency = detectAnomalies([
      claim("USD-1", 40), claim("EUR-1", 45, { currency: "EUR" }),
    ], policy);
    expect(differentCurrency.items.some((item) => item.signals.some((s) => s.code === "split-charges"))).toBe(false);
  });
  it("detects unusual one-day repeated merchant activity", () => {
    const report = detectAnomalies([
      claim("A", 20), claim("B", 29), claim("C", 38), claim("D", 47),
    ], policy);
    expect(report.flagged).toBe(4);
    expect(report.items.every((item) => item.signals.some((s) => s.code === "rapid-repeat"))).toBe(true);
  });
  it("detects spending concentration only with adequate observations", () => {
    const claims = Array.from({ length: 7 }, (_, i) =>
      claim("CON-" + i, 50, { date: "2026-09-" + String(i + 1).padStart(2, "0") }),
    );
    claims.push(claim("OTHER", 20, { merchant: "Another Vendor", date: "2026-09-19" }));
    const report = detectAnomalies(claims, policy);
    expect(report.items.find((item) => item.claimId === "CON-0")?.signals.some((s) => s.code === "merchant-concentration")).toBe(true);
  });
  it("keeps formula-like names inert in exported evidence CSV", () => {
    const claims = [
      claim("C-1", 40, { merchant: "=HYPERLINK('https://bad.example')", date: "2026-09-10" }),
      claim("C-2", 45, { merchant: "=HYPERLINK('https://bad.example')", date: "2026-09-11" }),
    ];
    const report = detectAnomalies(claims, policy);
    const csv = anomaliesToCSV(report, claims);
    expect(csv).toContain("split-charges");
    expect(csv).toContain("'=HYPERLINK");
  });
  it("sends only 60 prioritized claim excerpts and anonymized screening context to AI", () => {
    const claims = Array.from({ length: 80 }, (_, i) =>
      claim("BULK-" + i, i === 79 ? 990 : 30, {
        employeeId: "SENSITIVE-EMP-" + (i % 6),
        employeeName: "Private Name " + i,
        merchant: "Cafe " + i,
        date: "2026-09-" + String((i % 28) + 1).padStart(2, "0"),
      }),
    );
    const report = detectAnomalies(claims, policy);
    const client = buildAIContext(claims, policy, undefined, report);
    const server = sanitizeContext({ ...client, secret: "NEVER-SEND-THIS", claims: client.claims.map((c) => ({ ...c, employeeName: "Private Name", reviewNotes: "Review secrets", apiKey: "NEVER-SEND-THIS" })) });
    const text = JSON.stringify(server);
    expect(client.totalClaims).toBe(80);
    expect(client.includedClaims).toBe(60);
    expect(server?.anomalySummary).toBeDefined();
    expect(text).not.toContain("Private Name");
    expect(text).not.toContain("SENSITIVE-EMP");
    expect(text).not.toContain("Sensitive detail");
    expect(text).not.toContain("NEVER-SEND-THIS");
    expect(text).not.toContain("Review secrets");
  });
});
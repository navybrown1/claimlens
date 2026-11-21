import { describe, expect, it } from "vitest";
import {
  parseAmount,
  parseClaimsFile,
  parseClaimsText,
  parseDate,
  parseEmployeesFile,
} from "../src/lib/imports";
import {
  claimsTemplate,
  claimsToCSV,
  employeesTemplate,
  parseHistoryFile,
  saveRunJSON,
} from "../src/lib/exports";
import { auditClaims, DEFAULT_POLICY } from "../src/lib/audit";
import { generateDemo } from "../src/lib/demo";
import type { SavedRun } from "../src/types";

const header =
  "Claim ID,Employee ID,Employee Name,Department,Expense Date,Submitted Date,Merchant,Category,Amount,Currency,Receipt,Business Purpose";
const good =
  "C-1,E-1,Jamie Smith,Sales,2026-11-18,2026-11-19,Cafe,Meals,24.50,USD,yes,Client meeting";
const file = (contents: string, name: string) => new File([contents], name);

describe("claim imports", () => {
  it("maps friendly headers and receipt values without losing identity", () => {
    const result = parseClaimsText(`${header}\n${good}`);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.data[0]).toMatchObject({
      id: "C-1",
      employeeId: "E-1",
      receipt: true,
      amount: 24.5,
    });
  });
  it("supports quoted comma fields and common numeric formats", () => {
    const result = parseClaimsText(
      `${header}\n${good.replace("Cafe,Meals,24.50", '"Cafe, Inc.",Meals,"$1,234.50"')}`,
    );
    expect(result.data[0].merchant).toBe("Cafe, Inc.");
    expect(result.data[0].amount).toBe(1234.5);
    expect(parseAmount("1.234,56")).toBe(1234.56);
    expect(parseAmount("24,50")).toBe(24.5);
    expect(parseAmount("1,2,3")).toBeNaN();
    expect(parseAmount(1e300)).toBeNaN();
    expect(parseAmount(24.501)).toBeNaN();
  });
  it("rejects impossible dates and reads American and Excel dates", () => {
    expect(parseDate("02/30/2026")).toBe("");
    expect(parseDate("2026-02-30")).toBe("");
    expect(parseDate("11/20/2026")).toBe("2026-11-20");
    expect(parseDate(25569 + 20000)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it("blocks a complete file when duplicate IDs would overwrite review decisions", () => {
    const result = parseClaimsText(
      `${header}\n${good}\n${good.replace("C-1", "c-1")}`,
    );
    expect(result.data).toEqual([]);
    expect(result.errors[0]).toContain("Duplicate claim ID");
  });
  it("imports valid rows while making skipped malformed rows visible", () => {
    const result = parseClaimsText(
      `${header}\n${good}\n${good.replace("C-1", "C-2").replace("24.50", "not money")}`,
    );
    expect(result.data).toHaveLength(1);
    expect(result.warnings[0]).toContain("Row 3");
    expect(result.warnings[0]).toContain("skipped");
  });
  it("rejects ambiguous headers and malformed CSV instead of guessing", () => {
    expect(parseClaimsText(`${header},Total\n${good},12`).errors[0]).toContain(
      "same field",
    );
    expect(parseClaimsText(`${header}\n${good},unexpected`).data).toHaveLength(
      0,
    );
    expect(parseClaimsText(`${header}\n"unterminated`).errors).not.toHaveLength(
      0,
    );
  });
  it("explains missing currency and receipt assumptions and preserves unknown submission dates", () => {
    const result = parseClaimsText(
      "id,employeeId,date,amount\nA-1,E-1,2026-11-20,24.50",
    );
    expect(result.data[0]).toMatchObject({
      currency: "USD",
      receipt: false,
      submittedDate: "",
    });
    expect(result.warnings).toHaveLength(3);
  });
  it("reads both JSON arrays and saved-run-shaped claims collections", () => {
    const demo = generateDemo();
    expect(parseClaimsText(JSON.stringify(demo.claims)).data).toHaveLength(36);
    expect(
      parseClaimsText(JSON.stringify({ claims: demo.claims })).data,
    ).toHaveLength(36);
    expect(parseClaimsText("{broken").errors).not.toHaveLength(0);
  });
  it("rejects conflicting JSON aliases instead of letting the last property overwrite a value", async () => {
    const demo = generateDemo();
    const result = parseClaimsText(
      JSON.stringify([demo.claims[0], { ...demo.claims[1], total: 1 }]),
    );
    expect(result.data).toHaveLength(0);
    expect(result.errors[0]).toContain("Row 2");
    expect(result.errors[0]).toContain("same field");
    const employees = await parseEmployeesFile(
      file(
        JSON.stringify([
          {
            id: "E-1",
            name: "Jamie",
            employeeName: "Someone else",
            status: "active",
          },
        ]),
        "employees.json",
      ),
    );
    expect(employees.data).toHaveLength(0);
    expect(employees.errors[0]).toContain("same field");
  });
  it("enforces file type, size and row limits", async () => {
    expect(
      (await parseClaimsFile(file("whatever", "claims.exe"))).errors[0],
    ).toContain(".csv");
    expect(
      (
        await parseClaimsFile(
          file("x".repeat(10 * 1024 * 1024 + 1), "large.csv"),
        )
      ).errors[0],
    ).toContain("10 MB");
    expect(
      parseClaimsText(
        `id,employeeId,date,amount\n${Array.from({ length: 10001 }, (_, i) => `A-${i},E-1,2026-11-20,1`).join("\n")}`,
      ).errors[0],
    ).toContain("10,000");
  });
  it("round-trips both downloadable templates", async () => {
    expect(parseClaimsText(claimsTemplate()).data).toHaveLength(2);
    expect(
      (await parseEmployeesFile(file(employeesTemplate(), "employees.csv")))
        .data,
    ).toHaveLength(2);
  });
  it("preserves roster IDs when status is unknown and rejects duplicate roster IDs", async () => {
    const missing = await parseEmployeesFile(
      file("id,name,department\nE-1,Jamie,Sales", "staff.csv"),
    );
    expect(missing.data).toHaveLength(1);
    expect(missing.data[0].status).toBe("unknown");
    const repeated = await parseEmployeesFile(
      file("id,name,status\nE-1,Jamie,active\nE-1,Alex,inactive", "staff.csv"),
    );
    expect(repeated.errors[0]).toContain("Duplicate employee ID");
  });
  it("reads a real XLSX workbook using the first worksheet and reports cached formulas", async () => {
    const { Workbook } = await import("exceljs");
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet("Claims");
    sheet.addRow([
      "id",
      "employeeId",
      "date",
      "submittedDate",
      "amount",
      "currency",
      "receipt",
    ]);
    sheet.addRow([
      "X-1",
      "E-1",
      new Date("2026-11-18T00:00:00Z"),
      "2026-11-19",
      { formula: "12+12.5", result: 24.5 },
      "USD",
      true,
    ]);
    workbook.addWorksheet("Ignored");
    const bytes = await workbook.xlsx.writeBuffer();
    const result = await parseClaimsFile(
      new File([new Uint8Array(bytes)], "claims.xlsx"),
    );
    expect(result.errors).toEqual([]);
    expect(result.data[0]).toMatchObject({
      id: "X-1",
      amount: 24.5,
      date: "2026-11-18",
    });
    expect(result.warnings).toHaveLength(2);
  });
});

describe("review exports and history", () => {
  it("neutralizes spreadsheet formulas in untrusted text", () => {
    const demo = generateDemo();
    const claim = {
      ...demo.claims[0],
      merchant: '=HYPERLINK("https://example.com")',
      description: "\t+SUM(1,2)",
    };
    const output = claimsToCSV(
      auditClaims([claim], demo.employees, DEFAULT_POLICY),
      {},
    );
    expect(output).toContain("'=HYPERLINK");
    expect(output).toContain("'\t+SUM");
  });
  it("saves and reloads a complete review without serializing unrelated API keys", async () => {
    const demo = generateDemo();
    const run: SavedRun = {
      id: "run-1",
      name: "November review",
      createdAt: new Date().toISOString(),
      ...demo,
      policy: DEFAULT_POLICY,
      decisions: {
        [demo.claims[0].id]: {
          decision: "follow-up",
          note: "Verify manager approval",
          updatedAt: new Date().toISOString(),
        },
      },
      events: [],
    };
    const output = saveRunJSON({ ...run, apiKey: "DO-NOT-SAVE" } as SavedRun);
    expect(output).not.toContain("DO-NOT-SAVE");
    expect(await parseHistoryFile(file(output, "run.json"))).toEqual({
      ...run,
      comparisonClaims: [],
      isDemo: false,
    });
  });
  it("preserves an intentionally missing submission date across a saved-run round trip", async () => {
    const demo = generateDemo();
    demo.claims[0].submittedDate = "";
    const run: SavedRun = {
      id: "run-1",
      name: "Review",
      createdAt: new Date().toISOString(),
      ...demo,
      policy: DEFAULT_POLICY,
      decisions: {},
      events: [],
    };
    const restored = await parseHistoryFile(file(saveRunJSON(run), "run.json"));
    expect(restored.claims[0].submittedDate).toBe("");
  });
  it("rejects corrupt history instead of partially restoring it", async () => {
    const demo = generateDemo();
    const run = {
      id: "run-1",
      name: "Review",
      createdAt: new Date().toISOString(),
      ...demo,
      policy: { ...DEFAULT_POLICY, mealLimit: -5 },
      decisions: {},
      events: [],
    };
    await expect(
      parseHistoryFile(file(JSON.stringify(run), "bad.json")),
    ).rejects.toThrow("mealLimit");
    await expect(parseHistoryFile(file("{}", "empty.json"))).rejects.toThrow(
      "run details",
    );
  });
  it("preserves historical evidence and an explicit demo flag", async () => {
    const demo = generateDemo();
    const comparisonClaims = [{ ...demo.claims[0], id: "PREVIOUS-1" }];
    const run: SavedRun = {
      id: "run-1",
      name: "Demo audit",
      createdAt: new Date().toISOString(),
      ...demo,
      policy: DEFAULT_POLICY,
      decisions: {},
      events: [],
      comparisonClaims,
      isDemo: true,
    };
    const restored = await parseHistoryFile(file(saveRunJSON(run), "run.json"));
    expect(restored.comparisonClaims).toEqual(comparisonClaims);
    expect(restored.isDemo).toBe(true);
    const legacy = { ...run, isDemo: undefined, comparisonClaims: undefined };
    const old = await parseHistoryFile(
      file(JSON.stringify(legacy), "legacy.json"),
    );
    expect(old.isDemo).toBe(false);
    expect(old.comparisonClaims).toEqual([]);
  });
  it("rejects malformed comparison data and duplicate comparison IDs", async () => {
    const demo = generateDemo();
    const run = {
      id: "run-1",
      name: "Review",
      createdAt: new Date().toISOString(),
      ...demo,
      policy: DEFAULT_POLICY,
      decisions: {},
      events: [],
      comparisonClaims: [demo.claims[0], demo.claims[0]],
    };
    await expect(
      parseHistoryFile(file(JSON.stringify(run), "bad.json")),
    ).rejects.toThrow("duplicate claim IDs");
    await expect(
      parseHistoryFile(
        file(JSON.stringify({ ...run, comparisonClaims: [null] }), "bad.json"),
      ),
    ).rejects.toThrow("invalid claim");
  });
});

describe("September-style source export compatibility", () => {
  it("retains all supported columns, does not guess employment status, and flags impossible dates", async () => {
    const employeeFile = file(
      "employee_id,department,office,level,cost_center\nE-101,Operations,East,Manager,CC-12",
      "roster.csv",
    );
    const roster = await parseEmployeesFile(employeeFile);
    expect(roster.errors).toEqual([]);
    expect(roster.data).toHaveLength(1);
    expect(roster.data[0]).toMatchObject({
      id: "E-101", name: "E-101", department: "Operations",
      office: "East", level: "Manager", costCenter: "CC-12", status: "unknown",
    });
    expect(roster.warnings.join(" ")).toContain("no confirmed active/inactive status");

    const claimsFile = [
      "claim_id,employee_id,expense_date,submit_date,category,merchant,amount_usd,receipt_attached,nights,fare_class,preapproval_id,attendees,description",
      "TEST-1,E-101,2026-09-15,2026-09-16,Hotel,Example Hotel,425.50,Y,2,,AP-1,,Work visit",
      "TEST-2,E-999,2026-09-31,2026-10-01,Meals,Example Cafe,24.50,, ,,,3,Staff meal",
      "TEST-3,E-101,2026-09-10,2026-09-11,Airfare,Example Airlines,-42.50,N,,,,Refund posted",
    ].join("\n");
    const result = parseClaimsText(claimsFile);
    expect(result.errors).toEqual([]);
    expect(result.data).toHaveLength(3);
    expect(result.data[0]).toMatchObject({
      id: "TEST-1", employeeId: "E-101", amount: 425.5,
      submittedDate: "2026-09-16", nights: 2, preapprovalId: "AP-1",
    });
    expect(result.data[1]).toMatchObject({ date: "2026-09-31", attendees: 3, receipt: false });
    expect(result.data[2].amount).toBe(-42.50);
    expect(result.warnings.join(" ")).toContain("invalid expense dates");
    const audited = auditClaims(result.data, roster.data, DEFAULT_POLICY, [], new Date("2026-11-20T12:00:00Z"));
    expect(audited[0].findings.some((finding) => finding.code === "unverified-employee-status")).toBe(true);
    expect(audited[1].findings.some((finding) => finding.code === "unknown-employee")).toBe(true);
    expect(audited[1].findings.some((finding) => finding.code === "invalid-date")).toBe(true);
    expect(audited[2].findings.some((finding) => finding.code === "credit-adjustment")).toBe(true);
  });
});

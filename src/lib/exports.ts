import type {
  AuditedClaim,
  Claim,
  ClaimDecision,
  Employee,
  Policy,
  SavedRun,
} from "../types";
import { MAX_FILE_BYTES, MAX_ROWS, parseAmount, parseDate } from "./imports";

export function downloadFile(
  name: string,
  content: string,
  mime = "text/plain;charset=utf-8",
): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvCell(value: string | number | boolean | undefined): string {
  let text = value === undefined ? "" : String(value);
  // Keep untrusted text from becoming a spreadsheet formula when the CSV is opened.
  if (typeof value === "string" && /^[\s\u0000-\u001f]*[=+@-]/.test(text))
    text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
const csv = (rows: (string | number | boolean | undefined)[][]) =>
  `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;

export function claimsToCSV(
  claims: AuditedClaim[],
  decisions: Record<string, ClaimDecision>,
): string {
  return csv([
    [
      "id",
      "employeeId",
      "employeeName",
      "department",
      "date",
      "submittedDate",
      "merchant",
      "category",
      "amount",
      "currency",
      "receipt",
      "description",
      "mileage",
      "nights",
      "fareClass",
      "preapprovalId",
      "attendees",
      "reviewStatus",
      "riskScore",
      "findings",
      "decision",
      "reviewNote",
      "decisionUpdatedAt",
    ],
    ...claims.map((claim) => [
      claim.id,
      claim.employeeId,
      claim.employeeName,
      claim.department,
      claim.date,
      claim.submittedDate,
      claim.merchant,
      claim.category,
      claim.amount.toFixed(2),
      claim.currency,
      claim.receipt,
      claim.description,
      claim.mileage,
      claim.nights,
      claim.fareClass,
      claim.preapprovalId,
      claim.attendees,
      claim.status,
      claim.riskScore,
      claim.findings
        .map((finding) => `${finding.title}: ${finding.description}`)
        .join(" | "),
      decisions[claim.id]?.decision ?? "pending",
      decisions[claim.id]?.note ?? "",
      decisions[claim.id]?.updatedAt ?? "",
    ]),
  ]);
}

export function claimsTemplate(): string {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return csv([
    [
      "id",
      "employeeId",
      "employeeName",
      "department",
      "date",
      "submittedDate",
      "merchant",
      "category",
      "amount",
      "currency",
      "receipt",
      "description",
      "mileage",
    ],
    [
      "EXP-001",
      "EMP-001",
      "Jamie Smith",
      "Sales",
      today,
      today,
      "Example Cafe",
      "Meals",
      24.5,
      "USD",
      true,
      "Client meeting lunch",
      "",
    ],
    [
      "EXP-002",
      "EMP-001",
      "Jamie Smith",
      "Sales",
      today,
      today,
      "Personal vehicle",
      "Mileage",
      28,
      "USD",
      true,
      "40-mile round trip to customer office",
      40,
    ],
  ]);
}

export function employeesTemplate(): string {
  return csv([
    ["employeeId", "name", "department", "status", "manager"],
    ["EMP-001", "Jamie Smith", "Sales", "active", "Taylor Lee"],
    ["EMP-002", "Alex Garcia", "Engineering", "inactive", "Morgan Chen"],
  ]);
}

export function saveRunJSON(run: SavedRun): string {
  // Explicit fields prevent any unrelated application configuration or API key
  // from being accidentally serialized if the caller passes a larger object.
  const safe = validateSavedRun(run);
  return JSON.stringify(
    { schemaVersion: 1, application: "ClaimLens", ...safe },
    null,
    2,
  );
}

function validatePolicy(input: unknown): Policy {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("The history file is missing its policy settings.");
  const policy = input as Record<string, unknown>;
  if (
    typeof policy.baseCurrency !== "string" ||
    !/^[A-Z]{3}$/.test(policy.baseCurrency)
  )
    throw new Error("The history policy currency is invalid.");
  for (const key of [
    "receiptThreshold",
    "mealLimit",
    "hotelLimit",
    "mileageRate",
    "submissionWindow",
    "maxClaimAmount",
  ]) {
    if (
      typeof policy[key] !== "number" ||
      !Number.isFinite(policy[key]) ||
      (policy[key] as number) < 0 ||
      (policy[key] as number) > 1_000_000_000
    )
      throw new Error(`The history policy field ${key} is invalid.`);
  }
  if (
    typeof policy.weekendReview !== "boolean" ||
    typeof policy.requiredDescription !== "boolean" ||
    !Array.isArray(policy.blockedMerchants) ||
    policy.blockedMerchants.length > 100 ||
    !policy.blockedMerchants.every(
      (value) => typeof value === "string" && value.length <= 200,
    )
  )
    throw new Error("The history policy rules are invalid.");
  return {
    baseCurrency: policy.baseCurrency,
    receiptThreshold: policy.receiptThreshold as number,
    mealLimit: policy.mealLimit as number,
    hotelLimit: policy.hotelLimit as number,
    mileageRate: policy.mileageRate as number,
    submissionWindow: policy.submissionWindow as number,
    maxClaimAmount: policy.maxClaimAmount as number,
    weekendReview: policy.weekendReview,
    requiredDescription: policy.requiredDescription,
    blockedMerchants: policy.blockedMerchants as string[],
  };
}

function validateClaimList(input: unknown, label: string): Claim[] {
  if (!Array.isArray(input) || input.length > MAX_ROWS)
    throw new Error(
      `The ${label} contains an invalid claims list (maximum ${MAX_ROWS.toLocaleString()} claims).`,
    );
  const seen = new Set<string>();
  return input.map((claim: unknown) => {
    if (!claim || typeof claim !== "object" || Array.isArray(claim))
      throw new Error(`The ${label} contains an invalid claim.`);
    const item = claim as Record<string, unknown>;
    const fields = {
      id: 120,
      employeeId: 120,
      employeeName: 200,
      department: 200,
      date: 10,
      submittedDate: 10,
      merchant: 200,
      category: 100,
      currency: 3,
      description: 5000,
    };
    for (const [key, maxLength] of Object.entries(fields))
      if (
        typeof item[key] !== "string" ||
        (item[key] as string).length > maxLength
      )
        throw new Error(`The ${label} contains an invalid ${key} field.`);
    const c = item as unknown as Claim;
    if (
      !c.id.trim() ||
      c.id.trim() !== c.id ||
      !c.employeeId.trim() ||
      c.employeeId.trim() !== c.employeeId ||
      seen.has(c.id.toLowerCase())
    )
      throw new Error(
        `The ${label} contains empty or duplicate claim IDs or an invalid employee ID.`,
      );
    seen.add(c.id.toLowerCase());
    if (
      typeof c.receipt !== "boolean" ||
      typeof c.amount !== "number" ||
      !Number.isFinite(parseAmount(c.amount)) ||
      c.amount === 0
    )
      throw new Error(
        `The ${label} contains an invalid receipt flag or amount.`,
      );
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(c.date) ||
      !c.date ||
      (c.submittedDate && parseDate(c.submittedDate) !== c.submittedDate) ||
      !/^[A-Z]{3}$/.test(c.currency)
    )
      throw new Error(`The ${label} contains an invalid date or currency.`);
    if (
      c.mileage !== undefined &&
      (typeof c.mileage !== "number" ||
        !Number.isFinite(c.mileage) ||
        c.mileage <= 0 ||
        c.mileage > 1_000_000_000)
    )
      throw new Error(`The ${label} contains invalid mileage.`);
    return {
      id: c.id,
      employeeId: c.employeeId,
      employeeName: c.employeeName,
      department: c.department,
      date: c.date,
      submittedDate: c.submittedDate,
      merchant: c.merchant,
      category: c.category,
      amount: c.amount,
      currency: c.currency,
      receipt: c.receipt,
      description: c.description,
      ...(c.mileage !== undefined ? { mileage: c.mileage } : {}),
      ...(Number.isSafeInteger(c.nights) && (c.nights ?? 0) > 0 && (c.nights ?? 0) < 10000 ? { nights: c.nights } : {}),
      ...(Number.isSafeInteger(c.attendees) && (c.attendees ?? 0) > 0 && (c.attendees ?? 0) < 10000 ? { attendees: c.attendees } : {}),
      ...(typeof c.fareClass === "string" ? { fareClass: c.fareClass.slice(0,100) } : {}),
      ...(typeof c.preapprovalId === "string" ? { preapprovalId: c.preapprovalId.slice(0,120) } : {}),
    };
  });
}

/** Validate both backups and browser storage, rebuilding only known application fields. */
export function validateSavedRun(raw: unknown): SavedRun {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error(
      "Choose a saved ClaimLens run with claims, employees, and policy settings.",
    );
  const run = raw as Record<string, unknown>;
  if (run.schemaVersion !== undefined && run.schemaVersion !== 1)
    throw new Error("This history file uses an unsupported format version.");
  if (
    typeof run.id !== "string" ||
    !run.id ||
    run.id.length > 200 ||
    typeof run.name !== "string" ||
    run.name.length > 200 ||
    typeof run.createdAt !== "string" ||
    !Number.isFinite(Date.parse(run.createdAt))
  )
    throw new Error("The history file has invalid run details.");
  const claims = validateClaimList(run.claims, "history");
  const comparisonClaims = validateClaimList(
    run.comparisonClaims ?? [],
    "historical comparison",
  );
  if (run.isDemo !== undefined && typeof run.isDemo !== "boolean")
    throw new Error("The saved demo indicator is invalid.");
  if (!Array.isArray(run.employees) || run.employees.length > MAX_ROWS)
    throw new Error("The history file contains an invalid employee list.");
  const employeeIds = new Set<string>();
  const employees: Employee[] = run.employees.map((employee: unknown) => {
    if (!employee || typeof employee !== "object" || Array.isArray(employee))
      throw new Error("The history employee list is malformed.");
    const item = employee as Record<string, unknown>;
    if (
      typeof item.id !== "string" ||
      !item.id ||
      item.id.length > 120 ||
      item.id.trim() !== item.id ||
      typeof item.name !== "string" ||
      item.name.length > 200 ||
      typeof item.department !== "string" ||
      item.department.length > 200 ||
      !["active", "inactive", "unknown"].includes(String(item.status)) ||
      (item.manager !== undefined &&
        (typeof item.manager !== "string" || item.manager.length > 200))
    )
      throw new Error("The history employee list has invalid fields.");
    if (employeeIds.has(item.id.toLowerCase()))
      throw new Error("The history employee list has duplicate IDs.");
    employeeIds.add(item.id.toLowerCase());
    return {
      id: item.id,
      name: item.name,
      department: item.department,
      status: item.status as Employee["status"],
      ...(typeof item.manager === "string" ? { manager: item.manager } : {}),
      ...(typeof item.office === "string" ? { office: item.office.slice(0,120) } : {}),
      ...(typeof item.level === "string" ? { level: item.level.slice(0,80) } : {}),
      ...(typeof item.costCenter === "string" ? { costCenter: item.costCenter.slice(0,120) } : {}),
    };
  });
  const policy = validatePolicy(run.policy);
  const decisions: Record<string, ClaimDecision> = Object.create(null);
  if (
    run.decisions !== undefined &&
    (!run.decisions ||
      typeof run.decisions !== "object" ||
      Array.isArray(run.decisions))
  )
    throw new Error("The saved review decisions are invalid.");
  if (
    run.decisions &&
    typeof run.decisions === "object" &&
    !Array.isArray(run.decisions)
  ) {
    const claimIds = new Set(claims.map((claim) => claim.id));
    for (const [id, value] of Object.entries(run.decisions)) {
      if (!claimIds.has(id)) continue;
      if (
        !value ||
        typeof value !== "object" ||
        !["pending", "approved", "rejected", "follow-up"].includes(
          String(value.decision),
        ) ||
        typeof value.note !== "string" ||
        typeof value.updatedAt !== "string" ||
        !Number.isFinite(Date.parse(value.updatedAt))
      )
        throw new Error(`The saved decision for ${id} is invalid.`);
      decisions[id] = {
        decision: value.decision,
        note: value.note.slice(0, 10000),
        updatedAt: value.updatedAt,
      };
    }
  }
  const events: SavedRun["events"] = [];
  if (run.events !== undefined && !Array.isArray(run.events))
    throw new Error("The saved audit trail is invalid.");
  if (Array.isArray(run.events)) {
    if (run.events.length > 20_000)
      throw new Error("The history file contains too many audit events.");
    for (const event of run.events) {
      if (
        !event ||
        typeof event !== "object" ||
        typeof event.id !== "string" ||
        typeof event.timestamp !== "string" ||
        !Number.isFinite(Date.parse(event.timestamp)) ||
        typeof event.action !== "string" ||
        typeof event.detail !== "string"
      )
        throw new Error("The saved audit trail contains invalid events.");
      events.push({
        id: event.id,
        timestamp: event.timestamp,
        action: event.action,
        detail: event.detail,
        ...(typeof event.claimId === "string"
          ? { claimId: event.claimId }
          : {}),
      });
    }
  }
  return {
    id: run.id,
    name: run.name,
    createdAt: run.createdAt,
    claims,
    employees,
    policy,
    decisions,
    events,
    comparisonClaims,
    isDemo: run.isDemo === true,
  };
}

export async function parseHistoryFile(file: File): Promise<SavedRun> {
  if (file.size > MAX_FILE_BYTES)
    throw new Error("History files must be no larger than 10 MB.");
  let raw: unknown;
  try {
    raw = JSON.parse(await file.text());
  } catch {
    throw new Error(
      "This is not a valid JSON history file. Choose a saved ClaimLens run.",
    );
  }
  return validateSavedRun(raw);
}

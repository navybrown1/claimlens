import Papa from "papaparse";
import type { Claim, Employee, ImportResult } from "../types";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_ROWS = 10_000;
type Row = Record<string, unknown>;
const normalizeHeader = (value: unknown) =>
  String(value ?? "")
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
const aliases: Record<string, string[]> = {
  id: [
    "id",
    "claimid",
    "claimnumber",
    "expenseid",
    "reportid",
    "reference",
    "referencenumber",
  ],
  employeeId: [
    "employeeid",
    "employeenumber",
    "staffid",
    "staffnumber",
    "claimantid",
    "empid",
  ],
  employeeName: [
    "employeename",
    "claimant",
    "claimantname",
    "employee",
    "name",
    "staffname",
  ],
  department: ["department", "dept", "team"],
  costCenter: ["costcentre", "costcenter"],
  office: ["office"],
  level: ["level"],
  nights: ["nights"],
  fareClass: ["fareclass"],
  preapprovalId: ["preapprovalid"],
  attendees: ["attendees"],
  date: ["date", "expensedate", "transactiondate", "purchasedate", "claimdate"],
  submittedDate: [
    "submitteddate",
    "submissiondate",
    "submitdate",
    "datesubmitted",
    "submittedon",
    "submitted",
  ],
  merchant: [
    "merchant",
    "vendor",
    "supplier",
    "payee",
    "merchantname",
    "vendorname",
  ],
  category: ["category", "expensecategory", "expensetype", "type"],
  amount: [
    "amount",
    "total",
    "expenseamount",
    "claimamount",
    "totalamount",
    "amountusd",
    "grossamount",
  ],
  currency: ["currency", "currencycode", "ccy"],
  receipt: [
    "receipt",
    "hasreceipt",
    "receiptattached",
    "receipted",
    "receiptprovided",
    "receiptavailable",
  ],
  description: [
    "description",
    "purpose",
    "businesspurpose",
    "notes",
    "details",
    "reason",
  ],
  mileage: ["mileage", "miles", "distance", "distancemiles"],
  status: ["status", "employeestatus", "employmentstatus", "active"],
  manager: ["manager", "managername", "supervisor", "approver"],
};
const aliasMap = new Map(
  Object.entries(aliases).flatMap(([field, headers]) =>
    headers.map((header) => [header, field] as const),
  ),
);
const stringValue = (value: unknown) =>
  value instanceof Date
    ? value.toISOString().slice(0, 10)
    : String(value ?? "").trim();

function remap(row: Row): Row {
  const mapped: Row = Object.create(null);
  for (const [header, value] of Object.entries(row)) {
    const field = aliasMap.get(normalizeHeader(header));
    if (field) mapped[field] = value;
  }
  return mapped;
}

export function parseAmount(value: unknown): number {
  if (typeof value === "number")
    return Number.isFinite(value) &&
      Math.abs(value) <= 1_000_000_000 &&
      Math.abs(value * 100 - Math.round(value * 100)) < 0.00001
      ? Math.round(value * 100) / 100
      : NaN;
  let text = stringValue(value)
    .replace(/[\s\u00a0]/g, "")
    .replace(/^(USD|EUR|GBP|CAD|AUD|JPY)\s*/i, "")
    .replace(/\s*(USD|EUR|GBP|CAD|AUD|JPY)$/i, "")
    .replace(/[$€£¥]/g, "");
  if (/^\(.*\)$/.test(text)) text = `-${text.slice(1, -1)}`;
  if (/^-?\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(text))
    text = text.replace(/,/g, "");
  else if (/^-?\d{1,3}(\.\d{3})+,\d{1,2}$/.test(text))
    text = text.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d+,\d{1,2}$/.test(text)) text = text.replace(",", ".");
  if (!/^-?\d+(\.\d{1,2})?$/.test(text)) return NaN;
  const amount = Number(text);
  return Number.isFinite(amount) && Math.abs(amount) <= 1_000_000_000
    ? amount
    : NaN;
}

export function parseDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime()))
    return value.toISOString().slice(0, 10);
  if (typeof value === "number" && value >= 20_000 && value <= 100_000)
    return new Date(Math.round(value - 25569) * 86_400_000)
      .toISOString()
      .slice(0, 10);
  let date = stringValue(value);
  const us = date.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (us) date = `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  const iso = date.match(/^(\d{4}-\d{2}-\d{2})(?:T\d{2}:\d{2}.*)?$/);
  if (!iso) return "";
  const parsed = Date.parse(`${iso[1]}T00:00:00Z`);
  return Number.isFinite(parsed) &&
    new Date(parsed).toISOString().slice(0, 10) === iso[1]
    ? iso[1]
    : "";
}

function sourceRows(
  text: string,
  kind: "claims" | "employees",
): { rows: Row[]; warnings: string[]; errors: string[] } {
  const clean = text.replace(/^\uFEFF/, "").trim();
  if (!clean) return { rows: [], warnings: [], errors: ["The file is empty."] };
  if (new TextEncoder().encode(clean).length > MAX_FILE_BYTES)
    return {
      rows: [],
      warnings: [],
      errors: ["The file is larger than 10 MB. Split it into smaller files."],
    };
  if (clean.startsWith("[") || clean.startsWith("{")) {
    try {
      const json: unknown = JSON.parse(clean);
      const rows: unknown = Array.isArray(json)
        ? json
        : json && typeof json === "object"
          ? (json as Row)[kind]
          : undefined;
      if (!Array.isArray(rows))
        throw new Error(`Expected an array or an object with a ${kind} array.`);
      if (rows.length > MAX_ROWS)
        throw new Error(
          `A file may contain no more than ${MAX_ROWS.toLocaleString()} rows.`,
        );
      if (
        !rows.every(
          (row) => row && typeof row === "object" && !Array.isArray(row),
        )
      )
        throw new Error("Every row must be a JSON object.");
      for (let index = 0; index < rows.length; index++) {
        const fields = Object.keys(rows[index])
          .map((header) => aliasMap.get(normalizeHeader(header)))
          .filter(Boolean);
        if (new Set(fields).size !== fields.length)
          throw new Error(
            `Row ${index + 1} has two properties mapping to the same field (for example, amount and total). Keep one property for each field.`,
          );
      }
      return { rows: rows as Row[], warnings: [], errors: [] };
    } catch (error) {
      return {
        rows: [],
        warnings: [],
        errors: [
          `Invalid JSON: ${error instanceof Error ? error.message : "Unable to read this file."}`,
        ],
      };
    }
  }
  const parsed = Papa.parse<string[]>(clean, { skipEmptyLines: "greedy" });
  if (
    parsed.errors.some(
      (error) => error.code === "MissingQuotes" || error.type === "Quotes",
    )
  )
    return {
      rows: [],
      warnings: [],
      errors: [
        "The CSV contains an unclosed or malformed quoted field. Correct the source file and try again.",
      ],
    };
  const [headers, ...values] = parsed.data;
  if (!headers?.length || !values.length)
    return {
      rows: [],
      warnings: [],
      errors: ["Include a header row and at least one data row."],
    };
  if (values.length > MAX_ROWS)
    return {
      rows: [],
      warnings: [],
      errors: [
        `A file may contain no more than ${MAX_ROWS.toLocaleString()} rows.`,
      ],
    };
  const normalized = headers.map(normalizeHeader);
  if (new Set(normalized).size !== normalized.length)
    return {
      rows: [],
      warnings: [],
      errors: [
        "The file contains duplicate column headers. Each column needs a unique name.",
      ],
    };
  const canonical = normalized
    .map((header) => aliasMap.get(header))
    .filter(Boolean);
  if (new Set(canonical).size !== canonical.length)
    return {
      rows: [],
      warnings: [],
      errors: [
        "Two columns map to the same field (for example, Amount and Total). Keep one column for each field.",
      ],
    };
  const warnings: string[] = [];
  const rows: Row[] = [];
  values.forEach((values, index) => {
    if (values.length !== headers.length) {
      warnings.push(
        `Row ${index + 2} skipped: column count differs from the header. Quote fields that contain commas.`,
      );
      return;
    }
    rows.push({
      ...Object.fromEntries(
        headers.map((header, column) => [header, values[column] ?? ""]),
      ),
      __sourceRow: index + 2,
    });
  });
  return { rows, warnings, errors: [] };
}

function readClaims(rows: Row[], warnings: string[] = []): ImportResult<Claim> {
  const data: Claim[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  let missingCurrency = 0;
  let missingSubmitted = 0;
  let missingReceipt = 0;
  let invalidExpenseDate = 0;
  let credits = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = remap(rows[i]);
    const rowNumber = Number(rows[i].__sourceRow) || i + 2;
    const id = stringValue(row.id);
    const employeeId = stringValue(row.employeeId);
    const date = parseDate(row.date) || stringValue(row.date).slice(0, 10);
    if (date && !parseDate(date)) invalidExpenseDate++;
    const amount = parseAmount(row.amount);
    if (id && seen.has(id.toLowerCase()))
      errors.push(
        `Duplicate claim ID "${id}" at row ${rowNumber}. Use unique IDs before importing.`,
      );
    if (id) seen.add(id.toLowerCase());
    const failures: string[] = [];
    if (!id || id.length > 120) failures.push("a claim ID of 1–120 characters");
    if (!employeeId || employeeId.length > 120)
      failures.push("an employee ID of 1–120 characters");
    if (!date) failures.push("an expense date");
    if (!Number.isFinite(amount) || amount === 0)
      failures.push("a nonzero amount with at most two decimal places");
    if (Number.isFinite(amount) && amount < 0) credits++;
    if (failures.length) {
      warnings.push(
        `Row ${rowNumber} (${id || "no ID"}) skipped: needs ${failures.join(", ")}.`,
      );
      continue;
    }
    const rawCurrency = stringValue(row.currency).toUpperCase();
    const currency = rawCurrency || "USD";
    if (!rawCurrency) missingCurrency++;
    if (!/^[A-Z]{3}$/.test(currency)) {
      warnings.push(
        `Row ${rowNumber} (${id}) skipped: currency must be a three-letter code such as USD.`,
      );
      continue;
    }
    const submittedDate = parseDate(row.submittedDate);
    if (!submittedDate) missingSubmitted++;
    const receiptValue = stringValue(row.receipt).toLowerCase();
    const receipt = [
      "true",
      "yes",
      "y",
      "1",
      "attached",
      "provided",
      "available",
    ].includes(receiptValue);
    if (!receiptValue) missingReceipt++;
    else if (
      !receipt &&
      ![
        "false",
        "no",
        "n",
        "0",
        "missing",
        "none",
        "not provided",
        "not attached",
      ].includes(receiptValue)
    )
      warnings.push(
        `Row ${rowNumber} (${id}): unrecognized receipt value "${receiptValue.slice(0, 30)}" treated as no receipt.`,
      );
    const mileage = stringValue(row.mileage)
      ? parseAmount(row.mileage)
      : undefined;
    if (mileage !== undefined && (!Number.isFinite(mileage) || mileage <= 0)) {
      warnings.push(
        `Row ${rowNumber} (${id}) skipped: mileage must be a positive number.`,
      );
      continue;
    }
    const parseCount = (v: unknown) => { const raw = stringValue(v); if (!raw) return undefined; const n = Number(raw); if (Number.isSafeInteger(n) && n > 0 && n < 10000) return n; warnings.push(`Row ${rowNumber} (${id}): invalid supplementary count ignored.`); return undefined; };
    const nights = parseCount(row.nights);
    const attendees = parseCount(row.attendees);
    data.push({
      id,
      employeeId,
      employeeName: stringValue(row.employeeName).slice(0, 200),
      department: stringValue(row.department).slice(0, 200),
      date,
      submittedDate,
      merchant: stringValue(row.merchant).slice(0, 200),
      category: stringValue(row.category).slice(0, 100),
      amount,
      currency,
      receipt,
      description: stringValue(row.description).slice(0, 5000),
      ...(mileage !== undefined ? { mileage } : {}),
      ...(nights !== undefined ? { nights } : {}),
      ...(attendees !== undefined ? { attendees } : {}),
      ...(stringValue(row.fareClass) ? { fareClass: stringValue(row.fareClass).slice(0,100) } : {}),
      ...(stringValue(row.preapprovalId) ? { preapprovalId: stringValue(row.preapprovalId).slice(0,120) } : {}),
    });
  }
  if (invalidExpenseDate) warnings.push(`${invalidExpenseDate} claim(s) have invalid expense dates. Original values retained and flagged for review.`);
  if (credits) warnings.push(`${credits} negative amount(s) were retained as credits or adjustments. Reconcile them against the original transactions.`);
  if (missingCurrency)
    warnings.push(
      `${missingCurrency} row(s) had no currency; USD was used. Confirm this before reviewing totals.`,
    );
  if (missingSubmitted)
    warnings.push(
      `${missingSubmitted} row(s) had no valid submission date. Those dates remain blank and will be flagged for review.`,
    );
  if (missingReceipt)
    warnings.push(
      `${missingReceipt} row(s) had no receipt value; no receipt was assumed.`,
    );
  if (!data.length && !errors.length)
    errors.push(
      "No valid claims were found. Required columns: id, employeeId, date, amount. Download the template for all supported columns.",
    );
  return {
    data: errors.length ? [] : data,
    warnings: warnings
      .slice(0, 200)
      .concat(
        warnings.length > 200
          ? [
              `${warnings.length - 200} additional warnings omitted. Fix the source file before a complete review.`,
            ]
          : [],
      ),
    errors: errors.slice(0, 100),
  };
}

function readEmployees(
  rows: Row[],
  warnings: string[] = [],
): ImportResult<Employee> {
  const data: Employee[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  let missingNames = 0;
  let unknownStatuses = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = remap(rows[i]);
    const rowNumber = Number(rows[i].__sourceRow) || i + 2;
    const id = stringValue(row.employeeId || row.id);
    const name = stringValue(row.employeeName);
    const department = stringValue(row.department);
    const statusValue = stringValue(row.status).toLowerCase();
    if (id && seen.has(id.toLowerCase()))
      errors.push(
        `Duplicate employee ID "${id}" at row ${rowNumber}. Resolve duplicates before importing.`,
      );
    seen.add(id.toLowerCase());
    if (!id || id.length > 120) {
      warnings.push(`Row ${rowNumber} skipped: an employee ID is required.`);
      continue;
    }
    const active = ["active", "true", "yes", "1", "employed"].includes(
      statusValue,
    );
    const inactive = [
      "inactive",
      "false",
      "no",
      "0",
      "terminated",
      "left",
      "former",
    ].includes(statusValue);
    if (!name) missingNames++;
    if (!active && !inactive) unknownStatuses++;
    data.push({
      id,
      name: (name || id).slice(0, 200),
      department: department.slice(0, 200),
      status: active ? "active" : inactive ? "inactive" : "unknown",
      ...(row.office ? { office: stringValue(row.office).slice(0,120) } : {}),
      ...(row.level ? { level: stringValue(row.level).slice(0,80) } : {}),
      ...(row.costCenter ? { costCenter: stringValue(row.costCenter).slice(0,120) } : {}),
      ...(row.manager
        ? { manager: stringValue(row.manager).slice(0, 200) }
        : {}),
    });
  }
  if (missingNames) warnings.push(`${missingNames} employees have no names. Their IDs are shown as labels.`);
  if (unknownStatuses) warnings.push(`${unknownStatuses} employees have no confirmed active/inactive status. Eligibility is flagged for review.`);
  if (!data.length && !errors.length)
    errors.push("No valid employees were found. Employee ID is required.");
  return {
    data: errors.length ? [] : data,
    warnings: warnings.slice(0, 200),
    errors: errors.slice(0, 100),
  };
}

export function parseClaimsText(text: string): ImportResult<Claim> {
  const source = sourceRows(text, "claims");
  return source.errors.length
    ? { data: [], warnings: source.warnings, errors: source.errors }
    : readClaims(source.rows, source.warnings);
}

async function workbookRows(
  file: File,
): Promise<{ rows: Row[]; warnings: string[] }> {
  const ExcelJS = await import("exceljs");
  const Workbook = ExcelJS.Workbook ?? ExcelJS.default.Workbook;
  const workbook = new Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const sheet = workbook.worksheets[0];
  if (!sheet || sheet.rowCount < 2)
    throw new Error(
      "The first worksheet must contain headers and at least one data row.",
    );
  if (sheet.rowCount - 1 > MAX_ROWS)
    throw new Error(
      `A worksheet may contain no more than ${MAX_ROWS.toLocaleString()} data rows.`,
    );
  if (sheet.columnCount > 100)
    throw new Error("A worksheet may contain no more than 100 columns.");
  const headers = Array.from({ length: sheet.columnCount }, (_, i) =>
    stringValue(sheet.getRow(1).getCell(i + 1).value),
  );
  const present = headers.map(normalizeHeader).filter(Boolean);
  if (new Set(present).size !== present.length)
    throw new Error("The worksheet contains duplicate column headers.");
  const canonical = present
    .map((header) => aliasMap.get(header))
    .filter(Boolean);
  if (new Set(canonical).size !== canonical.length)
    throw new Error(
      "Two worksheet columns map to the same field. Keep one column for each field.",
    );
  const rows: Row[] = [];
  let formulaCount = 0;
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const values: Row = {};
    headers.forEach((header, i) => {
      if (!header) return;
      const cell = row.getCell(i + 1);
      const value = cell.value;
      if (value && typeof value === "object" && "formula" in value) {
        formulaCount++;
        values[header] = value.result ?? "";
      } else if (value && typeof value === "object" && "richText" in value)
        values[header] = value.richText.map((part) => part.text).join("");
      else if (value && typeof value === "object" && "text" in value)
        values[header] = value.text;
      else values[header] = value;
    });
    rows.push(values);
  });
  return {
    rows,
    warnings: [
      ...(workbook.worksheets.length > 1
        ? ["Only the first worksheet was imported."]
        : []),
      ...(formulaCount
        ? [
            `${formulaCount} formula cell(s) used their saved values. Formulas were not executed; verify that the workbook was recalculated before export.`,
          ]
        : []),
    ],
  };
}

async function parseFile<T>(
  file: File,
  kind: "claims" | "employees",
  convert: (rows: Row[], warnings?: string[]) => ImportResult<T>,
): Promise<ImportResult<T>> {
  if (file.size > MAX_FILE_BYTES)
    return {
      data: [],
      warnings: [],
      errors: ["The file is larger than 10 MB. Split it into smaller files."],
    };
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (!["csv", "json", "xlsx"].includes(extension ?? ""))
    return {
      data: [],
      warnings: [],
      errors: [
        "Choose a .csv, .json, or .xlsx file. Older .xls files must be saved as .xlsx or CSV first.",
      ],
    };
  try {
    if (extension === "xlsx") {
      const { rows, warnings } = await workbookRows(file);
      return convert(rows, warnings);
    }
    const source = sourceRows(await file.text(), kind);
    return source.errors.length
      ? { data: [], warnings: source.warnings, errors: source.errors }
      : convert(source.rows, source.warnings);
  } catch (error) {
    return {
      data: [],
      warnings: [],
      errors: [
        error instanceof Error ? error.message : "The file could not be read.",
      ],
    };
  }
}

export const parseClaimsFile = (file: File): Promise<ImportResult<Claim>> =>
  parseFile(file, "claims", readClaims);
export const parseEmployeesFile = (
  file: File,
): Promise<ImportResult<Employee>> =>
  parseFile(file, "employees", readEmployees);

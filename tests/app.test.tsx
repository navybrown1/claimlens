// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../src/App";
import { DEFAULT_POLICY } from "../src/lib/audit";
import type { Claim, SavedRun } from "../src/types";

const day = (offset: number) =>
  new Date(Date.now() - offset * 86400000).toISOString().slice(0, 10);
const expense = (): Claim => ({
  id: "REAL-1",
  employeeId: "EMP-001",
  employeeName: "Casey Review",
  department: "Research",
  date: day(3),
  submittedDate: day(1),
  merchant: "Research Paper Shop",
  category: "Office supplies",
  amount: 20,
  currency: "USD",
  receipt: true,
  description: "Workshop supplies",
});
const employees = [
  {
    id: "EMP-001",
    name: "Casey Review",
    department: "Research",
    status: "active" as const,
    manager: "Pat Supervisor",
  },
];
const claimsCSV = () =>
  [
    "id,employeeId,employeeName,department,date,submittedDate,merchant,category,amount,currency,receipt,description",
    Object.values(expense()).join(","),
  ].join("\n");
const employeesCSV =
  "id,name,department,status,manager\nEMP-001,Casey Review,Research,active,Pat Supervisor";

/** jsdom omits Blob.text; the real parser still reads the selected file contents. */
function file(name: string, text: string, type = "text/csv") {
  const result = new File([text], name, { type });
  Object.defineProperty(result, "text", { value: async () => text });
  return result;
}
const navigation = (name: RegExp | string) =>
  screen.getAllByRole("button", { name })[0];
type User = ReturnType<typeof userEvent.setup>;
async function openImport(user: User) {
  await user.click(navigation(/^Import data$/));
  return screen.getByRole("dialog", { name: "Bring your audit into focus" });
}
async function importRealWorkspace(user: User) {
  const dialog = await openImport(user);
  await user.upload(
    within(dialog).getByTestId("claims-file"),
    file("claims.csv", claimsCSV()),
  );
  await within(dialog).findByText("claims.csv");
  await user.upload(
    within(dialog).getByTestId("employees-file"),
    file("employees.csv", employeesCSV),
  );
  await within(dialog).findByText("employees.csv");
  await user.click(within(dialog).getByRole("button", { name: "View claims" }));
}
async function review(user: User, id = "REAL-1") {
  await user.click(screen.getByRole("button", { name: `Review ${id}` }));
  return screen.getByRole("dialog", { name: `Review ${id}` });
}
async function closeDialog(user: User) {
  await user.click(screen.getByRole("button", { name: "Close dialog" }));
}
async function approveRealClaim(
  user: User,
  note = "Matched the invoice to the workshop.",
) {
  const dialog = await review(user);
  await user.type(within(dialog).getByLabelText("Review note"), note);
  await user.click(within(dialog).getByRole("button", { name: /^Approve$/ }));
  expect(within(dialog).getByText("Approved")).toBeTruthy();
  await closeDialog(user);
}

beforeEach(() => {
  localStorage.clear();
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.reject(new Error("Unexpected network request in local workflow")),
    ),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ClaimLens user workflows", () => {
  it("starts without fictional records, then validates the imported employee roster", async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.queryByText("DEMO")).toBeNull();
    const dialog = await openImport(user);
    await user.upload(
      within(dialog).getByTestId("claims-file"),
      file("claims.csv", claimsCSV()),
    );
    await within(dialog).findByText("claims.csv");
    await closeDialog(user);
    expect(screen.queryByText("DEMO")).toBeNull();
    await user.click(navigation(/^Departments$/));
    expect(
      screen.getByRole("heading", { name: "Add your employee list" }),
    ).toBeTruthy();
    expect(screen.queryByText("Olivia Chen")).toBeNull();
    await user.click(navigation(/^Review claims/));
    let detail = await review(user);
    expect(within(detail).getByText("Employee list needed")).toBeTruthy();
    await closeDialog(user);
    const rosterDialog = await openImport(user);
    await user.upload(
      within(rosterDialog).getByTestId("employees-file"),
      file("employees.csv", employeesCSV),
    );
    await within(rosterDialog).findByText("employees.csv");
    await user.click(
      within(rosterDialog).getByRole("button", { name: "View claims" }),
    );
    detail = await review(user);
    expect(within(detail).queryByText("Employee list needed")).toBeNull();
    expect(
      within(detail).getByRole("heading", {
        name: "No policy exceptions detected",
      }),
    ).toBeTruthy();
    await closeDialog(user);
    await user.click(navigation(/^Departments$/));
    const roster = screen
      .getByRole("heading", { name: "Employee roster" })
      .closest("section")!;
    expect(within(roster).getByText("Casey Review")).toBeTruthy();
    expect(within(roster).queryByText("Olivia Chen")).toBeNull();
    expect(within(roster).getAllByRole("row")).toHaveLength(2);
  });

  it("rejects a duplicate manual claim ID and adds a corrected claim to the searchable queue", async () => {
    const user = userEvent.setup();
    render(<App />);
    await importRealWorkspace(user);
    const existingId = "REAL-1";
    await user.click(navigation(/^Add claim$/));
    const dialog = screen.getByRole("dialog", { name: "Add an expense claim" });
    const id = within(dialog).getByLabelText("Claim ID");
    await user.clear(id);
    await user.type(id, existingId);
    await user.type(
      within(dialog).getByLabelText("Merchant"),
      "New Workshop Supplies",
    );
    await user.type(within(dialog).getByLabelText("Amount"), "12.50");
    await user.type(
      within(dialog).getByLabelText("Business purpose"),
      "Approved workshop supplies.",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Add & check claim" }),
    );
    expect(within(dialog).getByRole("alert").textContent).toContain(
      "That claim ID already exists",
    );
    await user.clear(id);
    await user.type(id, "MANUAL-1");
    await user.click(
      within(dialog).getByRole("button", { name: "Add & check claim" }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.type(screen.getByLabelText("Search claims"), "MANUAL-1");
    expect(
      screen.getByRole("button", { name: "Review MANUAL-1" }),
    ).toBeTruthy();
    expect(screen.getByText("New Workshop Supplies")).toBeTruthy();
    expect(screen.getByText("$12.50")).toBeTruthy();
    expect(screen.getAllByRole("row")).toHaveLength(2);
  });

  it("preserves a human review note and approval when a saved audit is restored after a reload", async () => {
    const user = userEvent.setup();
    const app = render(<App />);
    await importRealWorkspace(user);
    await approveRealClaim(
      user,
      "Matched invoice 42 with the workshop attendance record.",
    );
    await user.click(navigation(/^Save audit$/));
    await screen.findByText(
      "Audit saved in this browser. Download a backup from Audit history.",
    );
    app.unmount();
    render(<App />);
    await user.click(navigation(/^Audit history$/));
    expect(screen.getByText(/1 claims · 1 reviewed/)).toBeTruthy();
    await user.click(navigation(/^Restore$/));
    await user.click(navigation(/^Review claims/));
    const detail = await review(user);
    expect(within(detail).getByText("Approved")).toBeTruthy();
    expect(
      (within(detail).getByLabelText("Review note") as HTMLTextAreaElement)
        .value,
    ).toBe("Matched invoice 42 with the workshop attendance record.");
    expect(screen.queryByText("DEMO")).toBeNull();
  });

  it("reopens a previous approval when historical evidence introduces a duplicate and preserves that evidence in a saved run", async () => {
    const user = userEvent.setup();
    render(<App />);
    await importRealWorkspace(user);
    await approveRealClaim(user);
    const history: SavedRun = {
      id: "prior-run",
      name: "Prior audit",
      createdAt: new Date().toISOString(),
      claims: [{ ...expense(), id: "OLD-1" }],
      employees,
      policy: { ...DEFAULT_POLICY },
      decisions: {},
      events: [],
    };
    const dialog = await openImport(user);
    await user.upload(
      within(dialog).getByTestId("history-file"),
      file("prior-audit.json", JSON.stringify(history), "application/json"),
    );
    await within(dialog).findByText("prior-audit.json");
    await user.click(
      within(dialog).getByRole("button", { name: "View claims" }),
    );
    const detail = await review(user);
    expect(within(detail).getByText("Matches a previous run")).toBeTruthy();
    expect(within(detail).getByText("Pending review")).toBeTruthy();
    expect(within(detail).getByRole("button", { name: "OLD-1" })).toBeTruthy();
    await closeDialog(user);
    await user.click(navigation(/^Save audit$/));
    await user.click(navigation(/^Audit history$/));
    await user.click(navigation(/^Restore$/));
    await user.click(navigation(/^Review claims/));
    expect(
      within(await review(user)).getByText("Matches a previous run"),
    ).toBeTruthy();
  });

  it("restores a complete local audit including a credit, unknown status and invalid expense date", async () => {
    const user = userEvent.setup();
    render(<App />);
    const run: SavedRun = {
      id: "private-backup-test",
      name: "Private review",
      createdAt: new Date().toISOString(),
      claims: [
        expense(),
        { ...expense(), id: "CREDIT-1", date: "2026-09-31", amount: -22.50, description: "Refund adjustment" },
      ],
      employees: [{ ...employees[0], status: "unknown" }],
      policy: { ...DEFAULT_POLICY },
      decisions: {},
      events: [],
    };
    const dialog = await openImport(user);
    await user.upload(
      within(dialog).getByTestId("restore-audit-file"),
      file("private-audit.json", JSON.stringify(run), "application/json"),
    );
    await screen.findByRole("heading", { name: "Every expense, in focus." });
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(navigation(/^Review claims/));
    expect(screen.getByRole("button", { name: "Review CREDIT-1" })).toBeTruthy();
    const credit = await review(user, "CREDIT-1");
    expect(within(credit).getByText("Credit or refund adjustment")).toBeTruthy();
    expect(within(credit).getByText("Expense date needed")).toBeTruthy();
    expect(within(credit).getByText("Employment status unverified")).toBeTruthy();
  });

  it("shows the Intelligence workspace with explainable patterns, and opens the claim review", async () => {
    const user = userEvent.setup();
    render(<App />);
    const day1 = day(4);
    const day2 = day(3);
    const run: SavedRun = {
      id: "intelligence-run",
      name: "Synthetic review",
      createdAt: new Date().toISOString(),
      claims: [
        { ...expense(), id: "INT-1", amount: 40, category: "Meals", merchant: "Team Cafe", date: day1 },
        { ...expense(), id: "INT-2", amount: 45, category: "Meals", merchant: "Team Cafe", date: day2 },
      ],
      employees,
      policy: { ...DEFAULT_POLICY },
      decisions: {},
      events: [],
    };
    const dialog = await openImport(user);
    await user.upload(within(dialog).getByTestId("restore-audit-file"), file("synthetic.json", JSON.stringify(run), "application/json"));
    await screen.findByRole("heading", { name: "Every expense, in focus." });
    await user.click(navigation(/^Intelligence/));
    expect(screen.getByRole("heading", { name: "Find the unusual." })).toBeTruthy();
    expect(screen.getAllByText("2", { selector: ".intelligence-metrics strong" }).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Grouped charges above review limit").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Connect AI to investigate/ })).toBeTruthy();
    await user.click(within(screen.getByRole("table")).getAllByRole("button", { name: /^Review/ })[0]);
    const review = screen.getByRole("dialog", { name: /^Review INT-/ });
    expect(within(review).getByText(/Behavioral screening/)).toBeTruthy();
    expect(within(review).getByText("Grouped charges above review limit")).toBeTruthy();
    expect(within(review).getByText(/not a fraud score/)).toBeTruthy();
  });

  it("keeps API keys out of saved audits, clears them when providers change, and forgets them on reload", async () => {
    const user = userEvent.setup();
    const app = render(<App />);
    await importRealWorkspace(user);
    await user.click(navigation(/^AI copilot/));
    const first = "sk-ui-test-only-first-secret";
    const second = "sk-ant-ui-test-only-second-secret";
    await user.type(screen.getByLabelText("API key"), first);
    await user.click(navigation(/^Anthropic$/));
    expect((screen.getByLabelText("API key") as HTMLInputElement).value).toBe(
      "",
    );
    await user.type(screen.getByLabelText("API key"), second);
    await user.click(navigation(/^Review claims/));
    await user.click(navigation(/^Save audit$/));
    await screen.findByText(
      "Audit saved in this browser. Download a backup from Audit history.",
    );
    const saved = Object.keys(localStorage)
      .map((key) => localStorage.getItem(key))
      .join("");
    expect(saved.length).toBeGreaterThan(0);
    expect(saved).not.toContain(first);
    expect(saved).not.toContain(second);
    expect(saved).not.toContain("apiKey");
    expect(fetch).not.toHaveBeenCalled();
    app.unmount();
    render(<App />);
    await user.click(navigation(/^AI copilot/));
    expect((screen.getByLabelText("API key") as HTMLInputElement).value).toBe(
      "",
    );
  });
});

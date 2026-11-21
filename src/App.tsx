import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, DragEvent, FormEvent, ReactNode } from "react";
import {
  Activity,
  ArrowDownLeft,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Bell,
  Building2,
  CalendarDays,
  Camera,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  Download,
  FileCheck2,
  FilePlus2,
  FileSpreadsheet,
  FileText,
  Filter,
  FolderClock,
  LayoutDashboard,
  ListFilter,
  Loader2,
  LockKeyhole,
  Menu,
  MessageSquareText,
  MoreHorizontal,
  Plus,
  ReceiptText,
  RefreshCw,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  ShieldQuestion,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload,
  Users,
  Wallet,
  X,
  XCircle,
  AlertTriangle,
  Eye,
  EyeOff,
  Zap,
} from "lucide-react";
import type {
  AIConfig,
  AuditedClaim,
  Claim,
  ClaimDecision,
  Decision,
  Employee,
  Policy,
  SavedRun,
  Workspace,
} from "./types";
import { auditClaims, DEFAULT_POLICY } from "./lib/audit";
import { parseClaimsFile, parseEmployeesFile } from "./lib/imports";
import {
  claimsToCSV,
  downloadFile,
  claimsTemplate,
  employeesTemplate,
  saveRunJSON,
  parseHistoryFile,
} from "./lib/exports";
import { PROVIDERS, buildAIContext, requestAI } from "./lib/ai";
import { getSavedRuns, putSavedRuns } from "./lib/storage";

type Page =
  "overview" | "claims" | "departments" | "copilot" | "history" | "settings";
type Modal = "import" | "add" | "receipt" | "help" | "reset" | null;
interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  error?: boolean;
}
const uid = () => crypto.randomUUID();
const localISODate = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const dateText = (value: string) => {
  const d = new Date(value.length === 10 ? value + "T12:00:00" : value);
  return Number.isNaN(d.valueOf())
    ? value
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};
const currencyText = (value: number, currency = "USD") => {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
};
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0])
    .join("")
    .toUpperCase() || "?";
const statusLabel = {
  hold: "On hold",
  fix: "Needs a fix",
  clear: "Ready to review",
};
const decisionLabel = {
  pending: "Pending review",
  approved: "Approved",
  rejected: "Rejected",
  "follow-up": "Follow-up",
};
const statusColor = { hold: "red", fix: "amber", clear: "green" };
const categories = [
  "Meals",
  "Travel",
  "Accommodation",
  "Office supplies",
  "Software",
  "Mileage",
  "Entertainment",
  "Other",
];
const nav = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "claims", label: "Review claims", icon: ReceiptText },
  { id: "departments", label: "Departments", icon: Building2 },
  { id: "copilot", label: "AI copilot", icon: Sparkles },
  { id: "history", label: "Audit history", icon: FolderClock },
  { id: "settings", label: "Policy settings", icon: SlidersHorizontal },
] as const;
function freshWorkspace(): Workspace {
  return { claims: [], employees: [], policy: { ...DEFAULT_POLICY }, decisions: {}, events: [], isDemo: false, name: "Expense audit" };
}
function IconBadge({
  children,
  color = "green",
}: {
  children: ReactNode;
  color?: string;
}) {
  return <span className={`metric-icon ${color}`}>{children}</span>;
}
function Empty({
  icon: Icon = FileSpreadsheet,
  title,
  text,
  children,
}: {
  icon?: typeof FileSpreadsheet;
  title: string;
  text: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <Icon size={36} />
      <h3>{title}</h3>
      <p>{text}</p>
      {children}
    </div>
  );
}
function ModalShell({
  title,
  subtitle,
  children,
  onClose,
  footer,
  className = "",
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  className?: string;
}) {
  const node = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const prior = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    node.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
      if (e.key === "Tab") {
        const els = node.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]',
        );
        if (!els?.length) return;
        if (
          e.shiftKey &&
          (document.activeElement === els[0] ||
            document.activeElement === node.current)
        ) {
          e.preventDefault();
          els[els.length - 1].focus();
        } else if (
          !e.shiftKey &&
          document.activeElement === els[els.length - 1]
        ) {
          e.preventDefault();
          els[0].focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      prior?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`modal ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={node}
        tabIndex={-1}
      >
        <div className="modal-header">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button
            className="icon-button"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}
function UploadZone({
  title,
  text,
  accept,
  icon: Icon,
  onFile,
  busy,
  fileText,
  testId,
}: {
  title: string;
  text: string;
  accept: string;
  icon: typeof FileSpreadsheet;
  onFile: (file: File) => void;
  busy?: boolean;
  fileText?: string;
  testId?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  function drop(e: DragEvent) {
    e.preventDefault();
    setOver(false);
    if (!busy && e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]);
  }
  return (
    <div
      className={`upload-zone ${over ? "dragging" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
    >
      <span className="upload-icon">
        <Icon size={25} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
      <button
        className="button secondary small"
        disabled={busy}
        onClick={() => input.current?.click()}
      >
        {busy ? (
          <Loader2 className="spinner" size={16} />
        ) : (
          <Upload size={15} />
        )}
        Choose file
      </button>
      <input
        data-testid={testId}
        ref={input}
        type="file"
        accept={accept}
        hidden
        onChange={(e) => {
          if (e.target.files?.[0]) onFile(e.target.files[0]);
          e.target.value = "";
        }}
      />
      {fileText && (
        <span className="file-status">
          <CheckCircle2 size={14} />
          {fileText}
        </span>
      )}
    </div>
  );
}

export default function App() {
  const [workspace, setWorkspace] = useState<Workspace>(freshWorkspace);
  useEffect(() => { putSavedRuns(getSavedRuns().filter((run) => !run.isDemo)); }, []);
  const [runs, setRuns] = useState<SavedRun[]>(() => getSavedRuns().filter((run) => !run.isDemo));
  const [historyClaims, setHistoryClaims] = useState<Claim[]>([]);
  const [page, setPage] = useState<Page>("overview");
  const [modal, setModal] = useState<Modal>(null);
  const [menu, setMenu] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [department, setDepartment] = useState("all");
  const [sort, setSort] = useState("risk");
  const [pagination, setPagination] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [busyImport, setBusyImport] = useState<string | null>(null);
  const [importNotes, setImportNotes] = useState<string[]>([]);
  const [fileNames, setFileNames] = useState<Record<string, string>>({});
  const [toasts, setToasts] = useState<
    { id: string; text: string; type: string }[]
  >([]);
  const [config, setConfig] = useState<AIConfig>({
    provider: "openrouter",
    model: "",
    apiKey: "",
    useServerKey: false,
    accessToken: "",
  });
  const [keyVisible, setKeyVisible] = useState(false);
  const [connection, setConnection] = useState<
    "idle" | "testing" | "connected" | "error"
  >("idle");
  const [aiBusy, setAiBusy] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [prompt, setPrompt] = useState("");
  const [policyDraft, setPolicyDraft] = useState<Policy>({ ...DEFAULT_POLICY });
  const [receiptImage, setReceiptImage] = useState<{
    data: string;
    mimeType: string;
    preview: string;
    name: string;
  } | null>(null);
  const [draftClaim, setDraftClaim] = useState<Partial<Claim>>({});
  const [receiptBusy, setReceiptBusy] = useState(false);
  const [isReceiptDraft, setIsReceiptDraft] = useState(false);
  const auditRevision = useRef(0);
  const configRevision = useRef(0);
  const aiRequestNumber = useRef(0);
  const messagesEnd = useRef<HTMLDivElement>(null);
  const toast = (text: string, type = "success") => {
    const id = uid();
    setToasts((t) => [...t.slice(-3), { id, text, type }]);
    window.setTimeout(
      () => setToasts((t) => t.filter((x) => x.id !== id)),
      6500,
    );
  };
  const provider =
    PROVIDERS.find((p) => p.id === config.provider) || PROVIDERS[0];
  const activeConfig = {
    ...config,
    model: config.model || provider.defaultModel,
  };
  const canUseAI = Boolean(config.apiKey.trim() || (config.provider === "openrouter" && config.useServerKey && config.accessToken?.trim()));
  const audited = useMemo(
    () =>
      auditClaims(
        workspace.claims,
        workspace.employees,
        workspace.policy,
        historyClaims,
      ),
    [workspace.claims, workspace.employees, workspace.policy, historyClaims],
  );
  const base = workspace.policy.baseCurrency;
  const baseClaims = audited.filter((c) => c.currency === base);
  const total = baseClaims.reduce((n, c) => n + c.amount, 0);
  const hold = audited.filter((c) => c.status === "hold");
  const fixes = audited.filter((c) => c.status === "fix");
  const clear = audited.filter((c) => c.status === "clear");
  const reviewed = audited.filter(
    (c) =>
      workspace.decisions[c.id]?.decision &&
      workspace.decisions[c.id].decision !== "pending",
  );
  const pending = audited.filter(
    (c) =>
      !workspace.decisions[c.id] ||
      workspace.decisions[c.id].decision === "pending",
  );
  const exceptionAmount = baseClaims
    .filter((c) => c.status !== "clear")
    .reduce((n, c) => n + c.amount, 0);
  const departments = [
    ...new Set(audited.map((c) => c.department || "Unassigned")),
  ].sort();
  const current = audited.find((c) => c.id === detail);
  const filtered = useMemo(() => {
    const query = search.toLowerCase().trim();
    return audited
      .filter(
        (c) =>
          (!query ||
            [
              c.id,
              c.employeeName,
              c.employeeId,
              c.merchant,
              c.department,
              c.category,
            ]
              .join(" ")
              .toLowerCase()
              .includes(query)) &&
          (department === "all" ||
            (c.department || "Unassigned") === department) &&
          (filter === "all" ||
            (["hold", "fix", "clear"].includes(filter)
              ? c.status === filter
              : filter === "pending"
                ? !workspace.decisions[c.id] ||
                  workspace.decisions[c.id].decision === "pending"
                : workspace.decisions[c.id]?.decision === filter)),
      )
      .sort((a, b) =>
        sort === "amount"
          ? b.amount - a.amount
          : sort === "date"
            ? b.date.localeCompare(a.date)
            : b.riskScore - a.riskScore || b.amount - a.amount,
      );
  }, [audited, search, filter, department, sort, workspace.decisions]);
  const pages = Math.max(1, Math.ceil(filtered.length / 10));
  const visible = filtered.slice(
    (Math.min(pagination, pages) - 1) * 10,
    Math.min(pagination, pages) * 10,
  );
  const deptStats = useMemo(() => {
    const groups = new Map<
      string,
      {
        name: string;
        claims: AuditedClaim[];
        amount: number;
        exceptions: number;
      }
    >();
    for (const c of audited) {
      const name = c.department || "Unassigned";
      const group = groups.get(name) || {
        name,
        claims: [],
        amount: 0,
        exceptions: 0,
      };
      group.claims.push(c);
      if (c.currency === base) group.amount += c.amount;
      if (c.status !== "clear") group.exceptions++;
      groups.set(name, group);
    }
    return [...groups.values()].sort((a, b) => b.amount - a.amount);
  }, [audited, base]);
  const findings = audited.flatMap((c) => c.findings);
  const findingGroups = Object.entries(
    findings.reduce<Record<string, number>>((a, f) => {
      a[f.title] = (a[f.title] || 0) + 1;
      return a;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);
  useEffect(() => {
    setPagination(1);
    setSelected(new Set());
  }, [search, filter, department, sort]);
  useEffect(() => {
    auditRevision.current += 1;
    aiRequestNumber.current += 1;
    setMessages([]);
    setPrompt("");
    setAiBusy(false);
  }, [workspace.claims, workspace.employees, workspace.policy, historyClaims]);
  useEffect(() => {
    configRevision.current += 1;
    setConnection("idle");
  }, [config.provider, config.model, config.apiKey, config.useServerKey, config.accessToken]);
  useEffect(() => {
    setReviewNote(detail ? workspace.decisions[detail]?.note || "" : "");
  }, [detail]);
  useEffect(() => {
    messagesEnd.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
  }, [messages, aiBusy]);
  function go(next: Page) {
    setPage(next);
    setMenu(false);
  }
  function log(action: string, detailText: string, claimId?: string) {
    setWorkspace((w) => ({
      ...w,
      events: [
        {
          id: uid(),
          timestamp: new Date().toISOString(),
          action,
          detail: detailText,
          claimId,
        },
        ...w.events,
      ].slice(0, 500),
    }));
  }
  function openClaims(nextFilter = "all") {
    setFilter(nextFilter);
    setSearch("");
    setDepartment("all");
    go("claims");
  }
  function decide(ids: string[], decision: Decision, note = "") {
    if (!ids.length) return;
    setWorkspace((w) => {
      const decisions: Record<string, ClaimDecision> = Object.assign(
        Object.create(null),
        w.decisions,
      );
      for (const id of ids)
        decisions[id] = { decision, note, updatedAt: new Date().toISOString() };
      return {
        ...w,
        decisions,
        events: [
          {
            id: uid(),
            timestamp: new Date().toISOString(),
            claimId: ids.length === 1 ? ids[0] : undefined,
            action: decisionLabel[decision],
            detail: `${ids.length} claim${ids.length === 1 ? "" : "s"}${note ? `: ${note}` : ""}`,
          },
          ...w.events,
        ].slice(0, 500),
      };
    });
    toast(
      `${ids.length} claim${ids.length === 1 ? "" : "s"} marked ${decisionLabel[decision].toLowerCase()}.`,
    );
    setSelected(new Set());
  }
  function saveRun() {
    if (!workspace.claims.length) {
      toast("Import claims before saving an audit.", "error");
      return;
    }
    const run: SavedRun = {
      id: uid(),
      name: `${workspace.isDemo ? "Demo audit" : workspace.name} · ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}`.slice(
        0,
        200,
      ),
      createdAt: new Date().toISOString(),
      claims: workspace.claims,
      employees: workspace.employees,
      policy: workspace.policy,
      decisions: workspace.decisions,
      events: workspace.events,
      comparisonClaims: historyClaims,
      isDemo: workspace.isDemo,
    };
    const next = [run, ...runs].slice(0, 12);
    try {
      putSavedRuns(next);
      setRuns(next);
      toast(
        "Audit saved in this browser. Download a backup from Audit history.",
      );
      log("Audit saved", run.name);
    } catch {
      downloadFile(
        `claimlens-audit-${run.id.slice(0, 8)}.json`,
        saveRunJSON(run),
        "application/json",
      );
      toast("Browser storage is full. Your audit was downloaded instead.");
    }
  }
  function exportCSV() {
    if (!filtered.length) {
      toast("There are no claims to export.", "error");
      return;
    }
    downloadFile(
      `claimlens-review-${localISODate()}.csv`,
      claimsToCSV(filtered, workspace.decisions),
      "text/csv;charset=utf-8;",
    );
    log("Review exported", `${filtered.length} claims exported to CSV`);
    toast(`Exported ${filtered.length} claims with findings and decisions.`);
  }
  async function importFile(
    file: File,
    kind: "claims" | "employees" | "history",
  ) {
    if (busyImport) return;
    setBusyImport(kind);
    setImportNotes([]);
    try {
      if (kind === "history") {
        const run = await parseHistoryFile(file);
        setHistoryClaims(run.claims);
        setWorkspace((w) => ({ ...w, decisions: {} }));
        setFileNames((f) => ({ ...f, history: file.name }));
        toast(
          `Comparing against ${run.claims.length} claims in the history file.`,
        );
        log("History loaded", `${run.claims.length} historical claims`);
      } else if (kind === "claims") {
        const result = await parseClaimsFile(file);
        setImportNotes([...result.errors, ...result.warnings]);
        if (result.errors.length || !result.data.length)
          throw new Error(
            result.errors[0] ||
              "No valid claims found. Download the template for the required columns.",
          );
        setWorkspace((w) => ({
          ...w,
          claims: result.data,
          employees: w.isDemo ? [] : w.employees,
          decisions: {},
          events: [
            {
              id: uid(),
              timestamp: new Date().toISOString(),
              action: "Claims imported",
              detail: `${result.data.length} claims from ${file.name}`,
            },
          ],
          isDemo: false,
          name: file.name.replace(/\.[^.]+$/, ""),
        }));
        setHistoryClaims([]);
        setFileNames((f) => ({
          ...(workspace.isDemo ? {} : f),
          claims: file.name,
          history: "",
        }));
        setSelected(new Set());
        setDetail(null);
        toast(
          `${result.data.length} claims imported. ${workspace.isDemo ? "Add your employee roster to validate employees." : "Policy checks refreshed."}`,
        );
      } else {
        const result = await parseEmployeesFile(file);
        setImportNotes([...result.errors, ...result.warnings]);
        if (result.errors.length || !result.data.length)
          throw new Error(result.errors[0] || "No valid employees found.");
        setWorkspace((w) => ({
          ...w,
          employees: result.data,
          claims: w.isDemo ? [] : w.claims,
          decisions: {},
          isDemo: false,
          name: w.isDemo ? "New audit" : w.name,
        }));
        if (workspace.isDemo) {
          setHistoryClaims([]);
          setFileNames({ employees: file.name });
        } else setFileNames((f) => ({ ...f, employees: file.name }));
        log(
          "Employee roster imported",
          `${result.data.length} employees from ${file.name}`,
        );
        toast(`${result.data.length} employees loaded.`);
      }
    } catch (error) {
      toast(
        error instanceof Error ? error.message : "Could not read this file.",
        "error",
      );
    } finally {
      setBusyImport(null);
    }
  }
  function restoreRun(run: SavedRun) {
    setWorkspace({
      claims: run.claims,
      employees: run.employees,
      policy: run.policy,
      decisions: run.decisions,
      events: run.events,
      name: run.name,
      isDemo: run.isDemo === true,
    });
    setPolicyDraft(run.policy);
    setHistoryClaims(run.comparisonClaims || []);
    setFileNames({});
    setDetail(null);
    setSelected(new Set());
    go("overview");
    toast(
      "Saved audit restored. Checks recalculated against its saved policy.",
    );
  }
  async function sendAI(
    text: string,
    action: "chat" | "summary" | "explain" | "draft" = "chat",
    claimId?: string,
  ) {
    go("copilot");
    setDetail(null);
    if (!canUseAI) {
      setPrompt(text);
      toast("Add your API key in the connection panel to use AI.", "error");
      return;
    }
    if (aiBusy) return;
    const requestNumber = ++aiRequestNumber.current;
    const revision = auditRevision.current;
    const conversation =
      action === "chat"
        ? messages
            .filter((m) => !m.error)
            .slice(-6)
            .map((m) => ({ role: m.role, text: m.text.slice(0, 1500) }))
        : [];
    setPrompt("");
    setMessages((m) => [...m, { id: uid(), role: "user", text }]);
    setAiBusy(true);
    try {
      const result = await requestAI(activeConfig, {
        action,
        prompt: text,
        context: buildAIContext(audited, workspace.policy, claimId),
        conversation,
      });
      if (
        requestNumber !== aiRequestNumber.current ||
        revision !== auditRevision.current
      )
        return;
      setMessages((m) => [
        ...m,
        { id: uid(), role: "assistant", text: result.text },
      ]);
    } catch (error) {
      if (
        requestNumber !== aiRequestNumber.current ||
        revision !== auditRevision.current
      )
        return;
      setMessages((m) => [
        ...m,
        {
          id: uid(),
          role: "assistant",
          error: true,
          text:
            error instanceof Error
              ? error.message
              : "AI request failed. Please try again.",
        },
      ]);
    } finally {
      if (requestNumber === aiRequestNumber.current) setAiBusy(false);
    }
  }
  async function testConnection() {
    if (!canUseAI) {
      toast("Enter your API key first.", "error");
      return;
    }
    const revision = configRevision.current;
    setConnection("testing");
    try {
      await requestAI(activeConfig, { action: "test" });
      if (revision !== configRevision.current) return;
      setConnection("connected");
      toast("Connection verified. Your AI copilot is ready.");
    } catch (error) {
      if (revision !== configRevision.current) return;
      setConnection("error");
      toast(
        error instanceof Error ? error.message : "Connection failed.",
        "error",
      );
    }
  }
  async function loadReceipt(file: File) {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      toast("Choose a JPG, PNG, or WebP receipt.", "error");
      return;
    }
    if (file.size > 2.5 * 1024 * 1024) {
      toast("Receipt images must be smaller than 2.5 MB.", "error");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const preview = String(reader.result);
      setReceiptImage({
        preview,
        data: preview.split(",")[1],
        mimeType: file.type,
        name: file.name,
      });
    };
    reader.readAsDataURL(file);
  }
  async function extractReceipt() {
    if (!receiptImage || receiptBusy) return;
    if (!canUseAI) {
      toast("Connect an AI provider in AI copilot first.", "error");
      return;
    }
    setReceiptBusy(true);
    try {
      const result = await requestAI(activeConfig, {
        action: "receipt",
        image: { data: receiptImage.data, mimeType: receiptImage.mimeType },
      });
      if (!result.receipt)
        throw new Error(
          "No receipt details returned. Try a clearer image or add the claim manually.",
        );
      setIsReceiptDraft(true);
      setDraftClaim({ ...result.receipt, receipt: true });
      setReceiptImage(null);
      setModal("add");
      toast("Receipt draft created. Check every field before adding it.");
    } catch (error) {
      toast(
        error instanceof Error ? error.message : "Receipt extraction failed.",
        "error",
      );
    } finally {
      setReceiptBusy(false);
    }
  }
  function startEmpty() {
    setWorkspace({
      claims: [],
      employees: [],
      decisions: {},
      events: [],
      policy: { ...DEFAULT_POLICY },
      isDemo: false,
      name: "New audit",
    });
    setPolicyDraft({ ...DEFAULT_POLICY });
    setHistoryClaims([]);
    setFileNames({});
    setDetail(null);
    setSelected(new Set());
    setModal("import");
    go("overview");
  }
  function savePolicy(e: FormEvent) {
    e.preventDefault();
    const merchants = policyDraft.blockedMerchants
      .map((m) => m.trim())
      .filter(Boolean);
    if (merchants.length > 100 || merchants.some((m) => m.length > 200)) {
      toast(
        "Use no more than 100 merchants, with each name under 200 characters.",
        "error",
      );
      return;
    }
    const numbers = [
      "receiptThreshold",
      "mealLimit",
      "hotelLimit",
      "mileageRate",
      "submissionWindow",
      "maxClaimAmount",
    ] as const;
    if (
      numbers.some(
        (k) => !Number.isFinite(policyDraft[k]) || policyDraft[k] < 0,
      )
    ) {
      toast("Policy limits must be valid, non-negative numbers.", "error");
      return;
    }
    setWorkspace((w) => ({
      ...w,
      policy: { ...policyDraft, blockedMerchants: merchants },
      decisions: {},
      events: [
        {
          id: uid(),
          timestamp: new Date().toISOString(),
          action: "Policy updated",
          detail:
            "Checks rerun; previous review decisions reset for fresh review.",
        },
        ...w.events,
      ],
    }));
    toast(
      "Policy saved. Checks recalculated and decisions reset for fresh review.",
    );
  }
  const today = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const pendingHigh = hold.filter(
    (c) =>
      !workspace.decisions[c.id] ||
      workspace.decisions[c.id].decision === "pending",
  ).length;
  const reviewPct = audited.length
    ? Math.round((reviewed.length / audited.length) * 100)
    : 0;
  const badgeStatus = (claim: AuditedClaim) => (
    <span className={`badge ${statusColor[claim.status]}`}>
      <span className="status-dot" />
      {statusLabel[claim.status]}
    </span>
  );
  const ClaimTable = ({
    rows,
    compact = false,
  }: {
    rows: AuditedClaim[];
    compact?: boolean;
  }) => (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            {!compact && (
              <th className="check-cell">
                <input
                  aria-label="Select all visible claims"
                  type="checkbox"
                  checked={
                    rows.length > 0 && rows.every((c) => selected.has(c.id))
                  }
                  onChange={(e) =>
                    setSelected((s) => {
                      const n = new Set(s);
                      rows.forEach((c) =>
                        e.target.checked ? n.add(c.id) : n.delete(c.id),
                      );
                      return n;
                    })
                  }
                />
              </th>
            )}
            <th>Claim / employee</th>
            <th>Merchant</th>
            <th>Amount</th>
            <th>Review status</th>
            {!compact && (
              <>
                <th>Decision</th>
                <th>Date</th>
              </>
            )}
            <th>
              <span className="sr-only">Open claim</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} className={selected.has(c.id) ? "selected-row" : ""}>
              {!compact && (
                <td>
                  <input
                    aria-label={`Select ${c.id}`}
                    type="checkbox"
                    checked={selected.has(c.id)}
                    onChange={() =>
                      setSelected((s) => {
                        const n = new Set(s);
                        n.has(c.id) ? n.delete(c.id) : n.add(c.id);
                        return n;
                      })
                    }
                  />
                </td>
              )}
              <td>
                <button
                  className="employee-cell row-link"
                  onClick={() => setDetail(c.id)}
                >
                  <span className={`avatar tone-${c.employeeId.length % 4}`}>
                    {initials(c.employeeName || c.employeeId)}
                  </span>
                  <span className="employee-info">
                    <strong>{c.employeeName || c.employeeId}</strong>
                    <small>{c.id}</small>
                  </span>
                </button>
              </td>
              <td>
                <strong className="merchant-name">{c.merchant}</strong>
                <small className="cell-subtitle">{c.category}</small>
              </td>
              <td className="amount">{currencyText(c.amount, c.currency)}</td>
              <td>{badgeStatus(c)}</td>
              {!compact && (
                <>
                  <td>
                    <span
                      className={`decision-text ${workspace.decisions[c.id]?.decision || "pending"}`}
                    >
                      {
                        decisionLabel[
                          workspace.decisions[c.id]?.decision || "pending"
                        ]
                      }
                    </span>
                  </td>
                  <td className="muted nowrap">{dateText(c.date)}</td>
                </>
              )}
              <td>
                <button
                  className="icon-button"
                  aria-label={`Review ${c.id}`}
                  onClick={() => setDetail(c.id)}
                >
                  <ChevronRight size={17} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="app-shell">
      {menu && (
        <button
          className="menu-overlay"
          aria-label="Close navigation"
          onClick={() => setMenu(false)}
        />
      )}
      <aside className={`sidebar ${menu ? "open" : ""}`}>
        <button
          className="brand"
          onClick={() => go("overview")}
          aria-label="ClaimLens home"
        >
          <span className="brand-mark">
            <FileCheck2 size={24} />
          </span>
          <span>
            <span className="brand-name">
              ClaimLens<span className="brand-dot">.</span>
            </span>
            <span className="brand-tag">EXPENSE INTELLIGENCE</span>
          </span>
        </button>
        <button className="workspace-switch" onClick={() => setModal("import")}>
          <span className="workspace-icon">
            <Building2 size={18} />
          </span>
          <span>
            <strong>
              {workspace.isDemo ? "Harborline Logistics" : workspace.name}
            </strong>
            <small>
              {workspace.isDemo ? "Demo workspace" : "Local workspace"}
            </small>
          </span>
          <ChevronDown size={15} />
        </button>
        <span className="sidebar-section">WORKSPACE</span>
        <nav aria-label="Main navigation">
          {nav.slice(0, 4).map((n) => (
            <button
              key={n.id}
              className={`nav-item ${page === n.id ? "active" : ""}`}
              onClick={() => go(n.id)}
            >
              <n.icon className="nav-icon" size={19} />
              <span>{n.label}</span>
              {n.id === "claims" && pending.length > 0 && (
                <span className="nav-count">{pending.length}</span>
              )}
              {n.id === "copilot" && <span className="nav-ai">AI</span>}
            </button>
          ))}
        </nav>
        <span className="sidebar-section">MANAGE</span>
        <nav aria-label="Audit management">
          {nav.slice(4).map((n) => (
            <button
              key={n.id}
              className={`nav-item ${page === n.id ? "active" : ""}`}
              onClick={() => go(n.id)}
            >
              <n.icon className="nav-icon" size={19} />
              <span>{n.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="ai-sidebar-card">
            <span className="ai-sidebar-icon">
              <Sparkles size={19} />
            </span>
            <h3>A second set of eyes.</h3>
            <p>Turn exceptions into answers with your AI copilot.</p>
            <button onClick={() => go("copilot")}>
              Connect your AI <ArrowUpRight size={15} />
            </button>
          </div>
          <button
            className="nav-item help-nav"
            onClick={() => setModal("help")}
          >
            <CircleHelp size={19} />
            Help & templates
          </button>
          <div className="user-profile">
            <span className="avatar user-avatar">EB</span>
            <span>
              <strong>Edwin Brown</strong>
              <small>Workspace owner</small>
            </span>
            <span className="profile-status" title="Local workspace" />
          </div>
        </div>
      </aside>
      <div className="app-main">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMenu(true)}
            >
              <Menu size={21} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong>{nav.find((n) => n.id === page)?.label}</strong>
          </div>
          <div className="topbar-actions">
            <span className="local-status">
              <span />
              Local-first workspace
            </span>
            <button
              className="icon-button"
              title="Help and templates"
              aria-label="Help and templates"
              onClick={() => setModal("help")}
            >
              <CircleHelp size={19} />
            </button>
            <span className="topbar-divider" />
            <button
              className="topbar-avatar"
              onClick={() => go("settings")}
              aria-label="Open workspace settings"
            >
              EB
            </button>
          </div>
        </header>
        <main className="page-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {page === "overview"
                  ? "YOUR REVIEW, AT A GLANCE"
                  : page === "copilot"
                    ? "A LITTLE CLARITY GOES A LONG WAY"
                    : "EXPENSE INTELLIGENCE"}
              </div>
              <h1 className="page-title">
                {
                  {
                    overview: "Every expense, in focus.",
                    claims: "The review queue.",
                    departments: "See the bigger picture.",
                    copilot: "Meet your second set of eyes.",
                    history: "A record of every review.",
                    settings: "Your policy. Your rules.",
                  }[page]
                }
              </h1>
              <p className="page-subtitle">
                {
                  {
                    overview: `Good to see you, Edwin. Here’s where your expenses stand.`,
                    claims:
                      "Investigate exceptions, document decisions, and move your audit forward.",
                    departments:
                      "Understand where expenses go and where attention is needed.",
                    copilot:
                      "Ask better questions. Get answers grounded in your expense data.",
                    history:
                      "Save a snapshot, compare earlier claims, and pick up where you left off.",
                    settings:
                      "Set the guardrails that make sense for your organization.",
                  }[page]
                }
              </p>
            </div>
            <div className="page-actions">
              {page === "overview" && (
                <span className="date-label">
                  <CalendarDays size={16} />
                  {today}
                </span>
              )}
              {!["copilot", "settings"].includes(page) && (
                <button
                  className="button primary"
                  onClick={() => setModal("import")}
                >
                  <Plus size={17} />
                  Import data
                </button>
              )}
            </div>
          </div>
          {workspace.isDemo && (
            <div className="demo-banner">
              <span>
                <span className="demo-pill">DEMO</span>You’re exploring
                fictional data. Import your files to start a real audit.
              </span>
              <button onClick={() => setModal("import")}>
                Use your own data <ArrowRight size={15} />
              </button>
            </div>
          )}
          {page === "overview" && (
            <>
              <div className="hero-layout">
                <section className="dashboard-hero">
                  <div className="hero-copy">
                    <span className="hero-eyebrow">
                      <span />
                      CLARITY BEFORE APPROVAL
                    </span>
                    <h2 className="hero-title">
                      Small details.
                      <br />A clearer financial picture.
                    </h2>
                    <p className="hero-description">
                      {audited.length ? (
                        <>
                          <strong>{hold.length + fixes.length} claims</strong>{" "}
                          need a closer look. Find the why,
                          <br className="desktop-break" /> make the call, and
                          keep things moving.
                        </>
                      ) : (
                        "Bring your expense files together and turn scattered records into a focused review."
                      )}
                    </p>
                    <div className="hero-actions">
                      <button
                        className="button hero-button"
                        onClick={() =>
                          audited.length
                            ? openClaims("hold")
                            : setModal("import")
                        }
                      >
                        {audited.length
                          ? "Review exceptions"
                          : "Start your first audit"}
                        <ArrowRight size={17} />
                      </button>
                      <button
                        className="hero-text-button"
                        onClick={() =>
                          sendAI(
                            "Summarize the most important exceptions in this audit and suggest what to review first.",
                            "summary",
                          )
                        }
                      >
                        <Sparkles size={16} />
                        Ask copilot
                      </button>
                    </div>
                  </div>
                  <div className="hero-orbit" aria-hidden="true">
                    <div className="orbit-ring ring-one" />
                    <div className="orbit-ring ring-two" />
                    <div className="orbit-core">
                      <ShieldCheck size={53} strokeWidth={1.2} />
                    </div>
                    <div className="orbit-label">
                      <CheckCircle2 size={13} />
                      Details make the difference
                    </div>
                    <span className="orbit-dot dot-one" />
                    <span className="orbit-dot dot-two" />
                  </div>
                </section>
                <section className="readiness-card">
                  <div className="readiness-heading">
                    <span className="metric-label">REVIEW PROGRESS</span>
                    <span className="badge neutral">This audit</span>
                  </div>
                  <div className="readiness-score">
                    {reviewPct}
                    <span>%</span>
                    <CheckCheck size={27} />
                  </div>
                  <p>
                    {reviewed.length} of {audited.length} claims reviewed
                  </p>
                  <div
                    className="progress-bar"
                    role="progressbar"
                    aria-label="Claims reviewed"
                    aria-valuenow={reviewPct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <span style={{ width: `${reviewPct}%` }} />
                  </div>
                  <div className="readiness-detail">
                    <span>
                      <span className="status-dot amber" />
                      {pending.length} awaiting a decision
                    </span>
                    <span>{pendingHigh} high priority</span>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => openClaims("pending")}
                  >
                    Continue reviewing
                    <ArrowRight size={15} />
                  </button>
                </section>
              </div>
              <div className="metric-grid">
                <Metric
                  title="Total claimed"
                  value={currencyText(total, base)}
                  note={`${baseClaims.length} claims in ${base}${baseClaims.length !== audited.length ? ` · ${audited.length - baseClaims.length} other currency` : ""}`}
                  icon={<Wallet size={20} />}
                  color="green"
                />
                <Metric
                  title="On hold"
                  value={String(hold.length)}
                  note="Resolve high-priority exceptions"
                  icon={<ShieldQuestion size={20} />}
                  color="red"
                  onClick={() => openClaims("hold")}
                />
                <Metric
                  title="Needs a fix"
                  value={String(fixes.length)}
                  note="A little more detail needed"
                  icon={<FileText size={20} />}
                  color="amber"
                  onClick={() => openClaims("fix")}
                />
                <Metric
                  title="Ready to review"
                  value={String(clear.length)}
                  note="No policy exceptions detected"
                  icon={<CheckCircle2 size={20} />}
                  color="green"
                  onClick={() => openClaims("clear")}
                />
              </div>
              <div className="dashboard-grid">
                <div className="dashboard-primary">
                  <section className="panel">
                    <div className="panel-header">
                      <div>
                        <h2 className="panel-title">
                          Your attention starts here{" "}
                          <span className="count-label">
                            {hold.length + fixes.length}
                          </span>
                        </h2>
                        <p className="panel-subtitle">
                          Exceptions with the highest risk scores
                        </p>
                      </div>
                      <button
                        className="text-button"
                        onClick={() => openClaims()}
                      >
                        View all claims
                        <ArrowUpRight size={15} />
                      </button>
                    </div>
                    {audited.length ? (
                      <ClaimTable
                        compact
                        rows={[...audited]
                          .sort((a, b) => b.riskScore - a.riskScore)
                          .filter((c) => c.status !== "clear")
                          .slice(0, 5)}
                      />
                    ) : (
                      <Empty
                        title="Your first audit starts here"
                        text="Import a claims export and employee list. ClaimLens checks the details for you."
                      >
                        <button
                          className="button primary"
                          onClick={() => setModal("import")}
                        >
                          Import data
                        </button>
                      </Empty>
                    )}
                    {audited.length > 0 && !findings.length && (
                      <Empty
                        icon={CheckCircle2}
                        title="No exceptions detected"
                        text="Your claims passed the configured checks. Review the evidence before approving."
                      />
                    )}
                    <div className="table-footer">
                      <span>
                        <ShieldCheck size={14} />
                        Rules-based checks. Human decisions.
                      </span>
                      <span>{workspace.policy.baseCurrency} workspace</span>
                    </div>
                  </section>
                  <section className="panel spend-panel">
                    <div className="panel-header">
                      <div>
                        <h2 className="panel-title">
                          Where the spend is going
                        </h2>
                        <p className="panel-subtitle">
                          Claimed amount by department · {base}
                        </p>
                      </div>
                      <button
                        className="icon-button"
                        aria-label="Open department analytics"
                        onClick={() => go("departments")}
                      >
                        <ArrowUpRight size={18} />
                      </button>
                    </div>
                    <div className="panel-body department-bars">
                      {deptStats.slice(0, 5).map((d, i) => (
                        <button
                          className="department-row"
                          key={d.name}
                          onClick={() => {
                            setDepartment(d.name);
                            setFilter("all");
                            go("claims");
                          }}
                        >
                          <span className={`dept-icon tone-${i % 4}`}>
                            <Building2 size={16} />
                          </span>
                          <span className="dept-bar-content">
                            <span className="dept-bar-label">
                              <strong>{d.name}</strong>
                              <span>{currencyText(d.amount, base)}</span>
                            </span>
                            <span className="risk-track">
                              <span
                                className={`risk-fill fill-${i % 4}`}
                                style={{
                                  width: `${Math.max(2, (d.amount / (deptStats[0]?.amount || 1)) * 100)}%`,
                                }}
                              />
                            </span>
                          </span>
                          <span className="dept-count">
                            {d.claims.length} claims
                          </span>
                        </button>
                      ))}
                      {!deptStats.length && (
                        <p className="muted">
                          Department insights appear after importing claims.
                        </p>
                      )}
                    </div>
                  </section>
                </div>
                <div className="dashboard-secondary">
                  <section className="panel exception-panel">
                    <div className="panel-header">
                      <div>
                        <h2 className="panel-title">Behind the exceptions</h2>
                        <p className="panel-subtitle">
                          The signals worth a second look
                        </p>
                      </div>
                      <ListFilter size={18} />
                    </div>
                    <div className="panel-body">
                      <div className="exception-total">
                        <span>{currencyText(exceptionAmount, base)}</span>
                        <small>in claims with exceptions · {base}</small>
                      </div>
                      <div className="risk-bars">
                        {findingGroups.slice(0, 4).map(([title, count], i) => (
                          <div className="risk-row" key={title}>
                            <div>
                              <span>
                                <span className={`legend-dot color-${i}`} />
                                {title}
                              </span>
                              <strong>{count}</strong>
                            </div>
                            <div className="risk-track">
                              <span
                                className={`risk-fill fill-${i}`}
                                style={{
                                  width: `${(count / Math.max(1, findingGroups[0]?.[1] || 1)) * 100}%`,
                                }}
                              />
                            </div>
                          </div>
                        ))}
                        {!findings.length && (
                          <p className="muted">
                            Exception types appear here when checks find
                            something to review.
                          </p>
                        )}
                      </div>
                      <div className="footnote">
                        One claim can have more than one exception.
                      </div>
                    </div>
                  </section>
                  <section className="insight-card">
                    <div className="insight-icon">
                      <Sparkles size={20} />
                      <span>CLAIMLENS COPILOT</span>
                    </div>
                    <h3 className="insight-title">
                      Find the story
                      <br />
                      behind the numbers.
                    </h3>
                    <p className="insight-description">
                      Get a plain-language summary, investigate a claim, or
                      draft a follow-up.
                    </p>
                    <button
                      className="button ai"
                      onClick={() =>
                        sendAI(
                          "Give me an executive summary of this audit, with claim IDs and a prioritized action list.",
                          "summary",
                        )
                      }
                    >
                      Explore with AI
                      <ArrowUpRight size={16} />
                    </button>
                    <small>Your key. Your choice of provider.</small>
                  </section>
                </div>
              </div>
            </>
          )}
          {page === "claims" && (
            <>
              <div
                className="view-tabs"
                role="group"
                aria-label="Claim filters"
              >
                {[
                  ["all", "All claims", audited.length],
                  ["hold", "On hold", hold.length],
                  ["fix", "Needs a fix", fixes.length],
                  ["clear", "Ready to review", clear.length],
                  [
                    "approved",
                    "Approved",
                    audited.filter(
                      (c) => workspace.decisions[c.id]?.decision === "approved",
                    ).length,
                  ],
                  [
                    "follow-up",
                    "Follow-up",
                    audited.filter(
                      (c) =>
                        workspace.decisions[c.id]?.decision === "follow-up",
                    ).length,
                  ],
                  [
                    "rejected",
                    "Rejected",
                    audited.filter(
                      (c) => workspace.decisions[c.id]?.decision === "rejected",
                    ).length,
                  ],
                ].map(([id, label, count]) => (
                  <button
                    key={id}
                    className={`view-tab ${filter === id ? "active" : ""}`}
                    onClick={() => setFilter(String(id))}
                  >
                    {label}
                    <span>{count}</span>
                  </button>
                ))}
              </div>
              <section className="panel">
                <div className="toolbar">
                  <div className="search-wrap">
                    <Search size={17} />
                    <input
                      className="search-input"
                      aria-label="Search claims"
                      placeholder="Search employee, merchant, or claim ID…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                  <div className="filter-group">
                    <select
                      className="select compact"
                      aria-label="Filter by department"
                      value={department}
                      onChange={(e) => setDepartment(e.target.value)}
                    >
                      <option value="all">All departments</option>
                      {departments.map((d) => (
                        <option key={d}>{d}</option>
                      ))}
                    </select>
                    <select
                      className="select compact"
                      aria-label="Sort claims"
                      value={sort}
                      onChange={(e) => setSort(e.target.value)}
                    >
                      <option value="risk">Highest risk</option>
                      <option value="amount">Highest amount</option>
                      <option value="date">Newest first</option>
                    </select>
                    <button
                      className="button secondary small"
                      onClick={() => {
                        setIsReceiptDraft(false);
                        setDraftClaim({});
                        setModal("add");
                      }}
                    >
                      <Plus size={15} />
                      Add claim
                    </button>
                    <button
                      className="button secondary small"
                      onClick={exportCSV}
                    >
                      <Download size={15} />
                      Export
                    </button>
                  </div>
                </div>
                {selected.size > 0 && (
                  <div className="selection-bar">
                    <strong>{selected.size} selected</strong>
                    <button
                      className="button small secondary"
                      onClick={() =>
                        decide(
                          [...selected],
                          "approved",
                          "Approved in bulk review",
                        )
                      }
                    >
                      Approve selected
                    </button>
                    <button
                      className="button small secondary"
                      onClick={() =>
                        decide(
                          [...selected],
                          "follow-up",
                          "Follow-up requested in bulk review",
                        )
                      }
                    >
                      Request follow-up
                    </button>
                    <button
                      className="button small ghost"
                      onClick={() => setSelected(new Set())}
                    >
                      Clear selection
                    </button>
                  </div>
                )}
                {visible.length ? (
                  <ClaimTable rows={visible} />
                ) : (
                  <Empty
                    icon={Search}
                    title={
                      audited.length ? "No matching claims" : "No claims yet"
                    }
                    text={
                      audited.length
                        ? "Try a different search or filter."
                        : "Import a CSV or Excel export, or add your first claim manually."
                    }
                  >
                    <button
                      className="button secondary"
                      onClick={() =>
                        audited.length
                          ? (setSearch(""),
                            setFilter("all"),
                            setDepartment("all"))
                          : setModal("import")
                      }
                    >
                      {audited.length ? "Reset filters" : "Import data"}
                    </button>
                  </Empty>
                )}
                <div className="table-footer">
                  <span>
                    {filtered.length
                      ? `${(Math.min(pagination, pages) - 1) * 10 + 1}–${Math.min(Math.min(pagination, pages) * 10, filtered.length)} of ${filtered.length} claims`
                      : "0 claims"}
                  </span>
                  <div className="pagination">
                    <button
                      className="icon-button"
                      aria-label="Previous page"
                      disabled={pagination <= 1}
                      onClick={() => setPagination((p) => p - 1)}
                    >
                      <ChevronLeft size={17} />
                    </button>
                    <span>
                      Page {Math.min(pagination, pages)} of {pages}
                    </span>
                    <button
                      className="icon-button"
                      aria-label="Next page"
                      disabled={pagination >= pages}
                      onClick={() => setPagination((p) => p + 1)}
                    >
                      <ChevronRight size={17} />
                    </button>
                  </div>
                </div>
              </section>
              <div className="footer-actions">
                <span className="footer-note">
                  <LockKeyhole size={14} />
                  Your decisions stay in this session until you save an audit.
                </span>
                <button className="button primary" onClick={saveRun}>
                  <FolderClock size={17} />
                  Save audit
                </button>
              </div>
            </>
          )}
          {page === "departments" && (
            <>
              <div className="metric-grid">
                <Metric
                  title="Departments"
                  value={String(departments.length)}
                  note="Represented in this audit"
                  icon={<Building2 size={20} />}
                />
                <Metric
                  title="Employees"
                  value={String(new Set(audited.map((c) => c.employeeId)).size)}
                  note={`${workspace.employees.length} in the employee roster`}
                  icon={<Users size={20} />}
                />
                <Metric
                  title="Total claimed"
                  value={currencyText(total, base)}
                  note={`Amounts in ${base} only`}
                  icon={<Wallet size={20} />}
                />
                <Metric
                  title="Exception rate"
                  value={`${audited.length ? Math.round(((hold.length + fixes.length) / audited.length) * 100) : 0}%`}
                  note="Claims with at least one finding"
                  icon={<Activity size={20} />}
                  color="amber"
                />
              </div>
              <div className="analytics-grid">
                <section className="panel">
                  <div className="panel-header">
                    <div>
                      <h2 className="panel-title">Department breakdown</h2>
                      <p className="panel-subtitle">
                        Compare spend and the quality of submissions
                      </p>
                    </div>
                    <Building2 size={20} />
                  </div>
                  <div className="table-scroll">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Department</th>
                          <th>Claims</th>
                          <th>Total · {base}</th>
                          <th>Exceptions</th>
                          <th>Exception rate</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {deptStats.map((d, i) => (
                          <tr key={d.name}>
                            <td>
                              <span className="employee-cell">
                                <span className={`dept-icon tone-${i % 4}`}>
                                  <Building2 size={17} />
                                </span>
                                <strong>{d.name}</strong>
                              </span>
                            </td>
                            <td>{d.claims.length}</td>
                            <td className="amount">
                              {currencyText(d.amount, base)}
                            </td>
                            <td>{d.exceptions}</td>
                            <td>
                              <span
                                className={`badge ${d.exceptions / d.claims.length > 0.5 ? "amber" : "green"}`}
                              >
                                {Math.round(
                                  (d.exceptions / d.claims.length) * 100,
                                )}
                                %
                              </span>
                            </td>
                            <td>
                              <button
                                className="icon-button"
                                aria-label={`Review ${d.name} claims`}
                                onClick={() => {
                                  setDepartment(d.name);
                                  setFilter("all");
                                  go("claims");
                                }}
                              >
                                <ArrowUpRight size={17} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {!deptStats.length && (
                    <Empty
                      title="No department data yet"
                      text="Import claims and an employee list to build your department view."
                    />
                  )}
                </section>
                <section className="panel">
                  <div className="panel-header">
                    <div>
                      <h2 className="panel-title">Spend by category</h2>
                      <p className="panel-subtitle">
                        Share of claimed amount · {base}
                      </p>
                    </div>
                  </div>
                  <div className="panel-body category-bars">
                    {Object.entries(
                      baseClaims.reduce<Record<string, number>>((a, c) => {
                        a[c.category] = (a[c.category] || 0) + c.amount;
                        return a;
                      }, Object.create(null)),
                    )
                      .sort((a, b) => b[1] - a[1])
                      .map(([cat, amount], i) => (
                        <div className="risk-row" key={cat}>
                          <div>
                            <span>
                              <span className={`legend-dot color-${i % 4}`} />
                              {cat}
                            </span>
                            <strong>{currencyText(amount, base)}</strong>
                          </div>
                          <div className="risk-track">
                            <span
                              className={`risk-fill fill-${i % 4}`}
                              style={{
                                width: `${total ? (amount / total) * 100 : 0}%`,
                              }}
                            />
                          </div>
                          <small>
                            {total ? Math.round((amount / total) * 100) : 0}% of
                            total
                          </small>
                        </div>
                      ))}
                  </div>
                </section>
              </div>
              <section className="panel employee-panel">
                <div className="panel-header">
                  <div>
                    <h2 className="panel-title">Employee roster</h2>
                    <p className="panel-subtitle">
                      The reference used to validate each claim
                      {workspace.employees.length > 100
                        ? " · Showing the first 100 employees; all are checked."
                        : ""}
                    </p>
                  </div>
                  <button
                    className="button secondary small"
                    onClick={() => setModal("import")}
                  >
                    <Upload size={15} />
                    Update roster
                  </button>
                </div>
                {workspace.employees.length ? (
                  <div className="table-scroll">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Employee</th>
                          <th>ID</th>
                          <th>Department</th>
                          <th>Status</th>
                          <th>Manager</th>
                        </tr>
                      </thead>
                      <tbody>
                        {workspace.employees.slice(0, 100).map((e) => (
                          <tr key={e.id}>
                            <td>
                              <span className="employee-cell">
                                <span className="avatar">
                                  {initials(e.name)}
                                </span>
                                <strong>{e.name}</strong>
                              </span>
                            </td>
                            <td>{e.id}</td>
                            <td>{e.department}</td>
                            <td>
                              <span
                                className={`badge ${e.status === "active" ? "green" : "red"}`}
                              >
                                {e.status}
                              </span>
                            </td>
                            <td>{e.manager || "Not provided"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty
                    icon={Users}
                    title="Add your employee list"
                    text="Employee eligibility checks need a roster. Download the template to get started."
                  />
                )}
              </section>
            </>
          )}
          {page === "copilot" && (
            <div className="ai-page">
              <section className="chat-area panel">
                <div className="panel-header">
                  <div className="chat-brand">
                    <span className="ai-chat-icon">
                      <Sparkles size={20} />
                    </span>
                    <div>
                      <h2 className="panel-title">ClaimLens copilot</h2>
                      <p className="panel-subtitle">
                        {Math.min(60, audited.length)} of {audited.length}{" "}
                        claims per request · Names excluded
                      </p>
                    </div>
                  </div>
                  <button
                    className="icon-button"
                    aria-label="Clear conversation"
                    onClick={() => setMessages([])}
                    disabled={aiBusy || !messages.length}
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
                <div className="chat-messages" aria-live="polite">
                  {!messages.length ? (
                    <div className="copilot-welcome">
                      <span className="copilot-emblem">
                        <Sparkles size={32} />
                      </span>
                      <h2>
                        What would you like
                        <br />
                        to understand?
                      </h2>
                      <p>
                        Bring a question. Your copilot brings your audit into
                        focus.
                      </p>
                      <div className="prompt-grid">
                        {[
                          [
                            "Summarize my audit",
                            "Give me a concise summary of this audit and the three most important actions.",
                          ],
                          [
                            "Find duplicate patterns",
                            "Explain the duplicate expense findings and list the claim IDs I should compare.",
                          ],
                          [
                            "Prioritize my review",
                            "Which claims need my attention first, and what evidence should I request?",
                          ],
                          [
                            "Draft a follow-up",
                            "Draft a professional follow-up asking for missing receipt documentation. Use placeholders for employee names.",
                          ],
                        ].map(([title, text]) => (
                          <button
                            key={title}
                            className="prompt-card"
                            onClick={() => sendAI(text)}
                          >
                            <MessageSquareText size={17} />
                            <span>{title}</span>
                            <ArrowUpRight size={15} />
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    messages.map((m) => (
                      <div
                        className={`chat-message ${m.role} ${m.error ? "message-error" : ""}`}
                        key={m.id}
                      >
                        <span className="avatar">
                          {m.role === "user" ? "EB" : <Sparkles size={16} />}
                        </span>
                        <div>
                          <small>
                            {m.role === "user" ? "You" : "ClaimLens copilot"}
                          </small>
                          <div className="chat-bubble">{m.text}</div>
                        </div>
                      </div>
                    ))
                  )}
                  {aiBusy && (
                    <div className="chat-message assistant">
                      <span className="avatar">
                        <Sparkles size={16} />
                      </span>
                      <div className="chat-bubble thinking">
                        <Loader2 size={16} className="spinner" />
                        Reviewing the evidence…
                      </div>
                    </div>
                  )}
                  <div ref={messagesEnd} />
                </div>
                <form
                  className="chat-composer"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (prompt.trim()) void sendAI(prompt.trim());
                  }}
                >
                  <textarea
                    className="textarea"
                    aria-label="Ask the AI copilot"
                    placeholder="Ask about your claims, policy, or next steps…"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    rows={2}
                    maxLength={4000}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        if (prompt.trim()) void sendAI(prompt.trim());
                      }
                    }}
                  />
                  <button
                    className="button primary send-button"
                    type="submit"
                    aria-label="Send question"
                    disabled={aiBusy || !prompt.trim()}
                  >
                    {aiBusy ? (
                      <Loader2 size={18} className="spinner" />
                    ) : (
                      <ArrowUpRight size={20} />
                    )}
                  </button>
                </form>
                <p className="ai-disclaimer">
                  AI suggestions can be wrong. Verify the source records before
                  making a decision.
                </p>
              </section>
              <aside className="ai-config-card panel">
                <div className="panel-header">
                  <div>
                    <h2 className="panel-title">Your AI connection</h2>
                    <p className="panel-subtitle">
                      Bring the provider you trust.
                    </p>
                  </div>
                  <LockKeyhole size={19} />
                </div>
                <div className="panel-body">
                  <label className="field-label">Provider</label>
                  <div className="provider-grid">
                    {PROVIDERS.map((p) => (
                      <button
                        key={p.id}
                        className={`provider-option ${config.provider === p.id ? "active" : ""}`}
                        onClick={() => {
                          setConfig({
                            provider: p.id,
                            model: p.defaultModel,
                            apiKey: "",
                            useServerKey: false,
                            accessToken: "",
                          });
                          setConnection("idle");
                          setKeyVisible(false);
                        }}
                      >
                        <span>{p.name}</span>
                        {config.provider === p.id && <Check size={15} />}
                      </button>
                    ))}
                  </div>
                  <div className="field">
                    <label className="field-label" htmlFor="ai-model">
                      Model
                    </label>
                    <input
                      className="input"
                      id="ai-model"
                      value={activeConfig.model}
                      onChange={(e) => {
                        setConfig((c) => ({ ...c, model: e.target.value }));
                        setConnection("idle");
                      }}
                      maxLength={120}
                    />
                    <small className="helper-text">
                      Editable. Use a model available to your API account.
                    </small>
                  </div>
                  {config.provider === "openrouter" && (
                    <label className="field" style={{display:"flex",gap:8,alignItems:"center"}}>
                      <input type="checkbox" checked={!!config.useServerKey} onChange={(e) => setConfig((c) => ({ ...c, useServerKey: e.target.checked, apiKey: "", accessToken: "" }))} />
                      Use OpenRouter key stored in Vercel (requires workspace access code)
                    </label>
                  )}
                  <div className="field">
                    <label className="field-label" htmlFor="ai-key">
                      {config.provider === "openrouter" && config.useServerKey ? "Workspace access code" : "API key"}
                    </label>
                    <div className="key-input-wrap">
                      <input
                        className="input"
                        id="ai-key"
                        type={keyVisible ? "text" : "password"}
                        value={config.provider === "openrouter" && config.useServerKey ? config.accessToken || "" : config.apiKey}
                        placeholder={config.provider === "openrouter" && config.useServerKey ? "Enter private access code" : provider.keyPlaceholder}
                        autoComplete="off"
                        spellCheck={false}
                        onChange={(e) => {
                          setConfig((c) => c.provider === "openrouter" && c.useServerKey ? { ...c, accessToken: e.target.value } : { ...c, apiKey: e.target.value });
                          setConnection("idle");
                        }}
                        maxLength={4096}
                      />
                      <button
                        className="icon-button"
                        aria-label={
                          keyVisible ? "Hide API key" : "Show API key"
                        }
                        onClick={() => setKeyVisible((v) => !v)}
                      >
                        {keyVisible ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                    <small className="helper-text">
                      Kept only in this tab’s memory. Refreshing clears it.
                    </small>
                  </div>
                  <button
                    className="button primary full-width"
                    onClick={testConnection}
                    disabled={connection === "testing" || !canUseAI}
                  >
                    {connection === "testing" ? (
                      <Loader2 className="spinner" size={16} />
                    ) : connection === "connected" ? (
                      <CheckCircle2 size={16} />
                    ) : (
                      <Zap size={16} />
                    )}{" "}
                    {connection === "testing"
                      ? "Testing connection…"
                      : connection === "connected"
                        ? "Connection verified"
                        : "Test connection"}
                  </button>
                  <small className="helper-text connection-cost">
                    Testing sends a small, billable request to your provider.
                  </small>
                  {canUseAI && (
                    <button
                      className="button ghost small full-width"
                      onClick={() => {
                        setConfig((c) => ({ ...c, apiKey: "", accessToken: "", useServerKey: false }));
                        setConnection("idle");
                        setKeyVisible(false);
                        toast("API key removed from this session.");
                      }}
                    >
                      Disconnect and clear key
                    </button>
                  )}
                  <div className="privacy-note">
                    <ShieldCheck size={19} />
                    <div>
                      <strong>You control what leaves this tab.</strong>
                      <p>
                        Your question and up to six recent chat messages are
                        sent when you ask AI. Those messages may include details
                        you typed. Audit context omits employee names and
                        descriptions; claim IDs, merchants, amounts, and
                        findings go to your chosen provider through the app’s
                        server.
                      </p>
                      <p>
                        Provider API charges apply. Keys are never saved to
                        audit files or browser storage.
                      </p>
                    </div>
                  </div>
                  <button
                    className="button secondary full-width"
                    onClick={() => setModal("receipt")}
                  >
                    <Camera size={17} />
                    Extract a receipt
                  </button>
                  <p className="helper-text">
                    Turn a receipt image into a draft claim, then check the
                    details yourself.
                  </p>
                </div>
              </aside>
            </div>
          )}
          {page === "history" && (
            <>
              <div className="history-intro panel">
                <div>
                  <span className="history-intro-icon">
                    <FolderClock size={25} />
                  </span>
                  <h2>Keep the evidence. Keep the context.</h2>
                  <p>
                    Save up to 12 audit snapshots in this browser. Download a
                    JSON backup to move an audit to another device or compare it
                    next month.
                  </p>
                </div>
                <button className="button primary" onClick={saveRun}>
                  <Plus size={17} />
                  Save current audit
                </button>
              </div>
              <div className="saved-runs">
                {runs.map((run) => (
                  <section className="saved-run-card" key={run.id}>
                    <span className="saved-run-icon">
                      <FileCheck2 size={24} />
                    </span>
                    <div className="saved-run-info">
                      <h3>{run.name}</h3>
                      <p>
                        {new Date(run.createdAt).toLocaleString()} ·{" "}
                        {run.claims.length} claims ·{" "}
                        {
                          Object.values(run.decisions).filter(
                            (d) => d.decision !== "pending",
                          ).length
                        }{" "}
                        reviewed
                      </p>
                    </div>
                    <div className="saved-run-actions">
                      <button
                        className="button secondary small"
                        onClick={() => restoreRun(run)}
                      >
                        Restore
                      </button>
                      <button
                        className="button secondary small"
                        onClick={() => {
                          setHistoryClaims(run.claims);
                          setWorkspace((w) => ({ ...w, decisions: {} }));
                          log(
                            "Historical comparison changed",
                            "Checks refreshed and review decisions reset.",
                          );
                          setFileNames((f) => ({ ...f, history: run.name }));
                          toast(
                            `Comparing the current audit against ${run.claims.length} historical claims.`,
                          );
                          go("claims");
                        }}
                      >
                        Compare
                      </button>
                      <button
                        className="icon-button"
                        aria-label={`Download ${run.name}`}
                        onClick={() =>
                          downloadFile(
                            `claimlens-audit-${run.id.slice(0, 8)}.json`,
                            saveRunJSON(run),
                            "application/json",
                          )
                        }
                      >
                        <Download size={18} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label={`Delete saved audit ${run.name}`}
                        onClick={() => {
                          const next = runs.filter((r) => r.id !== run.id);
                          try {
                            putSavedRuns(next);
                            setRuns(next);
                            toast(
                              "Saved snapshot removed. The current audit is unchanged.",
                            );
                          } catch {
                            toast("Could not update browser storage.", "error");
                          }
                        }}
                      >
                        <Trash2 size={17} />
                      </button>
                    </div>
                  </section>
                ))}
                {!runs.length && (
                  <section className="panel">
                    <Empty
                      icon={FolderClock}
                      title="Your audit trail starts with a save"
                      text="Save this audit to preserve the claims, policy, decisions, and activity together."
                    />
                  </section>
                )}
              </div>
              <section className="panel activity-panel">
                <div className="panel-header">
                  <div>
                    <h2 className="panel-title">Session activity</h2>
                    <p className="panel-subtitle">
                      A clear record of your work in this audit
                    </p>
                  </div>
                  <Activity size={19} />
                </div>
                <div className="panel-body activity-list">
                  {workspace.events.length ? (
                    workspace.events.slice(0, 30).map((e) => (
                      <div className="activity-item" key={e.id}>
                        <span className="activity-dot" />
                        <div>
                          <strong>{e.action}</strong>
                          <p>
                            {e.claimId ? `${e.claimId} · ` : ""}
                            {e.detail}
                          </p>
                        </div>
                        <time className="activity-time">
                          {new Date(e.timestamp).toLocaleTimeString("en-US", {
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </time>
                      </div>
                    ))
                  ) : (
                    <p className="muted">
                      Imports, decisions, policy updates, and exports will
                      appear here.
                    </p>
                  )}
                </div>
              </section>
            </>
          )}
          {page === "settings" && (
            <form onSubmit={savePolicy}>
              <div className="settings-grid">
                <div>
                  <section className="panel settings-section">
                    <div className="panel-header">
                      <div>
                        <h2 className="panel-title">Expense limits</h2>
                        <p className="panel-subtitle">
                          Example policy defaults. Adjust them to your actual
                          organization’s rules.
                        </p>
                      </div>
                      <Wallet size={20} />
                    </div>
                    <div className="panel-body form-grid">
                      <div className="field">
                        <label className="field-label" htmlFor="base-currency">
                          Base currency
                        </label>
                        <select
                          id="base-currency"
                          className="select"
                          value={policyDraft.baseCurrency}
                          onChange={(e) =>
                            setPolicyDraft((p) => ({
                              ...p,
                              baseCurrency: e.target.value,
                            }))
                          }
                        >
                          {[
                            "USD",
                            "EUR",
                            "GBP",
                            "CAD",
                            "AUD",
                            "INR",
                            "JPY",
                            "MXN",
                          ].map((c) => (
                            <option key={c}>{c}</option>
                          ))}
                        </select>
                        <small className="helper-text">
                          Other currencies are flagged. No exchange-rate
                          conversion is applied.
                        </small>
                      </div>
                      {(
                        [
                          [
                            "receiptThreshold",
                            "Receipt required above",
                            "Claims above this amount need a receipt.",
                          ],
                          [
                            "mealLimit",
                            "Meal limit",
                            "Maximum amount per meal claim.",
                          ],
                          [
                            "hotelLimit",
                            "Accommodation limit",
                            "Maximum amount per accommodation claim, not per night.",
                          ],
                          [
                            "maxClaimAmount",
                            "High-value claim limit",
                            "Flag amounts above this limit for review.",
                          ],
                          [
                            "mileageRate",
                            "Mileage rate per mile",
                            "Maximum reimbursable rate when miles are supplied.",
                          ],
                          [
                            "submissionWindow",
                            "Submission window (days)",
                            "Maximum days between expense and submission.",
                          ],
                        ] as const
                      ).map(([key, label, note]) => (
                        <div className="field" key={key}>
                          <label className="field-label" htmlFor={key}>
                            {label}
                            {key !== "submissionWindow"
                              ? ` (${policyDraft.baseCurrency})`
                              : ""}
                          </label>
                          <input
                            required
                            className="input"
                            id={key}
                            type="number"
                            min="0"
                            max={key === "submissionWindow" ? 3650 : 10000000}
                            step={key === "submissionWindow" ? "1" : "0.01"}
                            value={policyDraft[key]}
                            onChange={(e) =>
                              setPolicyDraft((p) => ({
                                ...p,
                                [key]:
                                  e.target.value === ""
                                    ? NaN
                                    : Number(e.target.value),
                              }))
                            }
                          />
                          <small className="helper-text">{note}</small>
                        </div>
                      ))}
                    </div>
                  </section>
                  <section className="panel settings-section">
                    <div className="panel-header">
                      <div>
                        <h2 className="panel-title">Review requirements</h2>
                        <p className="panel-subtitle">
                          Extra signals for your review team
                        </p>
                      </div>
                      <ShieldCheck size={20} />
                    </div>
                    <div className="panel-body">
                      <label className="toggle-row">
                        <span>
                          <strong>Review weekend expenses</strong>
                          <small>
                            Flag Saturday and Sunday expenses for context.
                          </small>
                        </span>
                        <input
                          type="checkbox"
                          className="switch"
                          checked={policyDraft.weekendReview}
                          onChange={(e) =>
                            setPolicyDraft((p) => ({
                              ...p,
                              weekendReview: e.target.checked,
                            }))
                          }
                        />
                      </label>
                      <label className="toggle-row">
                        <span>
                          <strong>Require a business purpose</strong>
                          <small>Flag claims with an empty description.</small>
                        </span>
                        <input
                          type="checkbox"
                          className="switch"
                          checked={policyDraft.requiredDescription}
                          onChange={(e) =>
                            setPolicyDraft((p) => ({
                              ...p,
                              requiredDescription: e.target.checked,
                            }))
                          }
                        />
                      </label>
                      <div className="field">
                        <label
                          className="field-label"
                          htmlFor="blocked-merchants"
                        >
                          Merchants requiring review
                        </label>
                        <textarea
                          className="textarea"
                          id="blocked-merchants"
                          rows={3}
                          value={policyDraft.blockedMerchants.join("\n")}
                          onChange={(e) =>
                            setPolicyDraft((p) => ({
                              ...p,
                              blockedMerchants: e.target.value.split("\n"),
                            }))
                          }
                          placeholder="One merchant name per line"
                        />
                        <small className="helper-text">
                          Case-insensitive matching. These are your
                          organization’s choices, not a fraud determination.
                        </small>
                      </div>
                    </div>
                  </section>
                </div>
                <aside>
                  <section className="panel settings-section">
                    <div className="panel-body">
                      <span className="settings-side-icon">
                        <ShieldCheck size={28} />
                      </span>
                      <h3>Transparent by design.</h3>
                      <p className="muted">
                        Each finding names the rule it triggered and the
                        evidence behind it. Risk scores prioritize review; they
                        do not prove misconduct.
                      </p>
                      <div className="privacy-note">
                        <RefreshCw size={18} />
                        <p>
                          Saving a changed policy reruns every check and clears
                          previous decisions so claims can be reviewed against
                          the new rules.
                        </p>
                      </div>
                      <button
                        className="button primary full-width"
                        type="submit"
                      >
                        <Check size={17} />
                        Save policy & recheck
                      </button>
                      <button
                        className="button ghost full-width"
                        type="button"
                        onClick={() => setPolicyDraft({ ...DEFAULT_POLICY })}
                      >
                        Reset draft to example policy
                      </button>
                    </div>
                  </section>
                  <section className="panel settings-section">
                    <div className="panel-body">
                      <h3>Workspace data</h3>
                      <p className="muted">
                        Imported files are processed in your browser. Save an
                        audit only if you want a local copy on this device.
                      </p>
                      <button
                        className="button secondary full-width"
                        type="button"
                        onClick={() => setModal("reset")}
                      >
                        Start a new audit
                      </button>

                    </div>
                  </section>
                </aside>
              </div>
            </form>
          )}
          <footer className="app-footer">
            <span>
              <span className="footer-brand">ClaimLens</span> Clarity in every
              claim.
            </span>
            <span>
              <LockKeyhole size={12} />
              Built for thoughtful human review.
            </span>
          </footer>
        </main>
      </div>
      {modal === "import" && (
        <ModalShell
          title="Bring your audit into focus"
          subtitle="Import your files. ClaimLens checks the details automatically."
          onClose={() => setModal(null)}
          footer={
            <>
              <span className="helper-text">
                CSV, XLSX, or JSON · up to 10 MB per data file
              </span>
              <button
                className="button primary"
                onClick={() => {
                  setModal(null);
                  go("claims");
                }}
              >
                View claims
                <ArrowRight size={16} />
              </button>
            </>
          }
        >
          <div className="steps-row">
            <span className="step">
              <b>1</b>Add claims
            </span>
            <span className="step">
              <b>2</b>Add employees
            </span>
            <span className="step">
              <b>3</b>Review exceptions
            </span>
          </div>
          <div className="import-grid">
            <UploadZone
              title="Claims export"
              text="Your expense claims, amounts, and receipt details."
              accept=".csv,.xlsx,.json"
              icon={FileSpreadsheet}
              onFile={(f) => void importFile(f, "claims")}
              busy={!!busyImport}
              fileText={fileNames.claims}
              testId="claims-file"
            />
            <UploadZone
              title="Employee roster"
              text="Employee IDs, departments, and active status."
              accept=".csv,.xlsx,.json"
              icon={Users}
              onFile={(f) => void importFile(f, "employees")}
              busy={!!busyImport}
              fileText={fileNames.employees}
              testId="employees-file"
            />
          </div>
          <div className="template-row">
            <button
              className="template-link"
              onClick={() =>
                downloadFile(
                  "claimlens-claims-template.csv",
                  claimsTemplate(),
                  "text/csv",
                )
              }
            >
              <Download size={14} />
              Claims template
            </button>
            <button
              className="template-link"
              onClick={() =>
                downloadFile(
                  "claimlens-employees-template.csv",
                  employeesTemplate(),
                  "text/csv",
                )
              }
            >
              <Download size={14} />
              Employee template
            </button>
          </div>
          <div className="history-upload">
            <UploadZone
              title="Previous audit (optional)"
              text="Load a ClaimLens JSON backup to check for repeat claims across periods."
              accept=".json"
              icon={FolderClock}
              onFile={(f) => void importFile(f, "history")}
              busy={!!busyImport}
              fileText={fileNames.history}
              testId="history-file"
            />
          </div>
          {historyClaims.length > 0 && (
            <button
              className="text-button"
              onClick={() => {
                setHistoryClaims([]);
                setWorkspace((w) => ({ ...w, decisions: {} }));
                log(
                  "Historical comparison cleared",
                  "Checks refreshed and review decisions reset.",
                );
                setFileNames((f) => ({ ...f, history: "" }));
                toast("Historical comparison cleared.");
              }}
            >
              Clear historical comparison
            </button>
          )}
          {importNotes.length > 0 && (
            <div className="import-notices" role="status">
              <h4>Import notes</h4>
              <ul>
                {importNotes.slice(0, 12).map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
              {importNotes.length > 12 && (
                <p>And {importNotes.length - 12} more row notes.</p>
              )}
            </div>
          )}
          <div className="privacy-note">
            <LockKeyhole size={17} />
            <p>
              Files stay in this browser. Importing new claims replaces the
              current session’s claims and decisions. Save your current audit
              first if you want to keep it.
            </p>
          </div>
        </ModalShell>
      )}
      {modal === "help" && (
        <ModalShell
          title="A clearer path from file to decision"
          subtitle="Everything you need to get your first audit moving."
          onClose={() => setModal(null)}
        >
          <div className="help-grid">
            <div className="help-card">
              <span className="step">
                <b>1</b>
              </span>
              <h3>Import the evidence</h3>
              <p>
                Upload claims and a roster as CSV, XLSX, or JSON. Match
                employees using a consistent employee ID. Use the templates for
                the accepted columns.
              </p>
            </div>
            <div className="help-card">
              <span className="step">
                <b>2</b>
              </span>
              <h3>Set your policy</h3>
              <p>
                Review the example limits, currency, receipt threshold, and
                submission window in Policy settings. Checks rerun when you
                save.
              </p>
            </div>
            <div className="help-card">
              <span className="step">
                <b>3</b>
              </span>
              <h3>Make the call</h3>
              <p>
                Open a claim to inspect its findings. Approve, reject, or
                request follow-up. Every decision stays separate from the rule
                result.
              </p>
            </div>
            <div className="help-card">
              <span className="step">
                <b>4</b>
              </span>
              <h3>Save the context</h3>
              <p>
                Save an audit in your browser and download its JSON backup.
                Export the review CSV for a spreadsheet-ready report.
              </p>
            </div>
          </div>
          <div className="template-row">
            <button
              className="button secondary"
              onClick={() =>
                downloadFile(
                  "claimlens-claims-template.csv",
                  claimsTemplate(),
                  "text/csv",
                )
              }
            >
              <Download size={16} />
              Claims template
            </button>
            <button
              className="button secondary"
              onClick={() =>
                downloadFile(
                  "claimlens-employees-template.csv",
                  employeesTemplate(),
                  "text/csv",
                )
              }
            >
              <Download size={16} />
              Employee template
            </button>
          </div>
          <div className="privacy-note">
            <ShieldCheck size={20} />
            <div>
              <strong>Know what the tool can and cannot decide.</strong>
              <p>
                Exceptions identify records to investigate. They do not prove
                fraud. This version is a local review workspace, without team
                sign-in or shared storage. Only explicitly requested AI actions
                send selected data to a provider.
              </p>
            </div>
          </div>
        </ModalShell>
      )}
      {modal === "reset" && (
        <ModalShell
          title="Start a fresh audit?"
          subtitle="The current unsaved session will be cleared. Saved snapshots remain available."
          onClose={() => setModal(null)}
          footer={
            <>
              <button
                className="button secondary"
                onClick={() => {
                  saveRun();
                  startEmpty();
                }}
              >
                Save current & start fresh
              </button>
              <button className="button primary" onClick={startEmpty}>
                Start fresh
              </button>
            </>
          }
        >
          <p>
            Save a snapshot if you want to keep your current claims, decisions,
            and review notes.
          </p>
        </ModalShell>
      )}
      {modal === "receipt" && (
        <ModalShell
          title="From receipt to draft claim"
          subtitle="Extract the details, then review them before adding a claim."
          onClose={() => {
            if (!receiptBusy) {
              setModal(null);
              setReceiptImage(null);
            }
          }}
          footer={
            <>
              <span className="helper-text">
                An AI provider and API key are required.
              </span>
              <button
                className="button primary"
                onClick={() => void extractReceipt()}
                disabled={!receiptImage || receiptBusy || !config.apiKey.trim()}
              >
                {receiptBusy ? (
                  <Loader2 className="spinner" size={17} />
                ) : (
                  <Sparkles size={17} />
                )}
                Extract receipt
              </button>
            </>
          }
        >
          <UploadZone
            title="Upload a receipt image"
            text="JPG, PNG, or WebP · maximum 2.5 MB"
            accept="image/jpeg,image/png,image/webp"
            icon={Camera}
            onFile={(f) => void loadReceipt(f)}
            busy={receiptBusy}
            fileText={receiptImage?.name}
          />
          {receiptImage && (
            <img
              className="receipt-preview"
              src={receiptImage.preview}
              alt="Receipt selected for extraction"
            />
          )}
          <div className="privacy-note">
            <LockKeyhole size={18} />
            <p>
              Clicking Extract receipt sends the entire image, including any
              personal details on it, to {provider.name} using your key. Only
              extracted fields are added after your review. The image is not
              saved in audit files.
            </p>
          </div>
        </ModalShell>
      )}
      {modal === "add" && (
        <AddClaimModal
          receiptDraft={isReceiptDraft}
          draft={draftClaim}
          employees={workspace.employees}
          base={base}
          existing={new Set(workspace.claims.map((c) => c.id))}
          onClose={() => setModal(null)}
          onAdd={(claim) => {
            setWorkspace((w) => ({
              ...w,
              claims: [...w.claims, claim],
              events: [
                {
                  id: uid(),
                  timestamp: new Date().toISOString(),
                  claimId: claim.id,
                  action: "Claim added",
                  detail: `${claim.merchant} · ${currencyText(claim.amount, claim.currency)}`,
                },
                ...w.events,
              ],
            }));
            setModal(null);
            go("claims");
            setFilter("all");
            toast("Claim added and checked against your policy.");
          }}
        />
      )}
      {current && (
        <ModalShell
          className="claim-detail-modal"
          title={`Review ${current.id}`}
          subtitle={`${current.employeeName || current.employeeId} · ${current.department || "Unassigned"}`}
          onClose={() => setDetail(null)}
          footer={
            <>
              <button
                className="button secondary"
                onClick={() => decide([current.id], "rejected", reviewNote)}
              >
                <XCircle size={16} />
                Reject
              </button>
              <button
                className="button secondary"
                onClick={() => decide([current.id], "follow-up", reviewNote)}
              >
                <MessageSquareText size={16} />
                Follow up
              </button>
              <button
                className="button primary"
                onClick={() => decide([current.id], "approved", reviewNote)}
              >
                <Check size={17} />
                Approve
              </button>
            </>
          }
        >
          <div className="claim-detail-summary">
            <div>
              <span className="eyebrow">CLAIMED AMOUNT</span>
              <h3>{currencyText(current.amount, current.currency)}</h3>
            </div>
            <div>
              {badgeStatus(current)}
              <span className="risk-score">
                Risk score <strong>{current.riskScore}/100</strong>
              </span>
            </div>
          </div>
          <div className="detail-grid">
            {[
              ["Merchant", current.merchant],
              ["Category", current.category],
              ["Expense date", current.date],
              ["Submitted", current.submittedDate],
              ["Receipt", current.receipt ? "Provided" : "Not provided"],
              ["Employee ID", current.employeeId],
            ].map(([label, value]) => (
              <div className="detail-item" key={label}>
                <span>{label}</span>
                <strong>{value || "Not provided"}</strong>
              </div>
            ))}
          </div>
          <div className="claim-purpose">
            <span className="field-label">Business purpose</span>
            <p>{current.description || "No business purpose supplied."}</p>
          </div>
          <div className="section-heading">
            <h3>
              {current.findings.length
                ? `${current.findings.length} ${current.findings.length === 1 ? "finding" : "findings"} to review`
                : "No policy exceptions detected"}
            </h3>
            <button
              className="text-button purple-text"
              onClick={() =>
                void sendAI(
                  `Explain the findings for claim ${current.id}. Cite the rule evidence and tell me what to verify.`,
                  "explain",
                  current.id,
                )
              }
            >
              <Sparkles size={15} />
              Explain with AI
            </button>
          </div>
          {current.findings.map((f, i) => (
            <div
              className={`finding-card ${f.severity}`}
              key={`${f.code}-${i}`}
            >
              <AlertTriangle size={18} />
              <div>
                <h4 className="finding-title">
                  {f.title}
                  <span
                    className={`badge ${f.severity === "high" ? "red" : f.severity === "medium" ? "amber" : "neutral"}`}
                  >
                    {f.severity}
                  </span>
                </h4>
                <p className="finding-description">{f.description}</p>
                {f.relatedIds?.length && (
                  <div className="related-claims">
                    {f.relatedIds.map((id) => (
                      <button
                        key={id}
                        className="chip"
                        onClick={() =>
                          audited.some((c) => c.id === id)
                            ? setDetail(id)
                            : toast(
                                "This related claim is in the historical comparison file.",
                              )
                        }
                      >
                        {id}
                        <ArrowUpRight size={12} />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
          {!current.findings.length && (
            <div className="privacy-note">
              <CheckCircle2 size={18} />
              <p>
                This claim passed your configured checks. Review the evidence
                before approving.
              </p>
            </div>
          )}
          <div className="field">
            <label className="field-label" htmlFor="review-note">
              Review note
            </label>
            <textarea
              id="review-note"
              className="textarea"
              placeholder="Record the evidence or context behind your decision…"
              rows={3}
              maxLength={2000}
              value={reviewNote}
              onChange={(e) => setReviewNote(e.target.value)}
            />
          </div>
          <div className="detail-decision">
            <span>
              Current decision:{" "}
              <strong>
                {
                  decisionLabel[
                    workspace.decisions[current.id]?.decision || "pending"
                  ]
                }
              </strong>
            </span>
            <button
              className="text-button"
              onClick={() =>
                decide(
                  [current.id],
                  workspace.decisions[current.id]?.decision || "pending",
                  reviewNote,
                )
              }
            >
              Save note
            </button>
          </div>
          <button
            className="button ghost small"
            onClick={() =>
              void sendAI(
                `Draft a polite follow-up for claim ${current.id} asking for the evidence needed to resolve its findings. Use [Employee name] as a placeholder.`,
                "draft",
                current.id,
              )
            }
          >
            <MessageSquareText size={15} />
            Draft follow-up with AI
          </button>
        </ModalShell>
      )}
      <div className="toast-container" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div className={`toast ${t.type}`} key={t.id}>
            {t.type === "error" ? (
              <AlertTriangle size={18} />
            ) : (
              <CheckCircle2 size={18} />
            )}
            <span>{t.text}</span>
            <button
              aria-label="Dismiss notification"
              onClick={() => setToasts((ts) => ts.filter((x) => x.id !== t.id))}
            >
              <X size={15} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
function Metric({
  title,
  value,
  note,
  icon,
  color = "green",
  onClick,
}: {
  title: string;
  value: string;
  note: string;
  icon: ReactNode;
  color?: string;
  onClick?: () => void;
}) {
  const contents = (
    <>
      <div className="metric-top">
        <span className="metric-label">{title}</span>
        <IconBadge color={color}>{icon}</IconBadge>
      </div>
      <div className="metric-value">{value}</div>
      <div className="metric-foot">
        <span>{note}</span>
        {onClick && <ArrowUpRight size={15} />}
      </div>
    </>
  );
  return onClick ? (
    <button className="metric-card clickable" onClick={onClick}>
      {contents}
    </button>
  ) : (
    <section className="metric-card">{contents}</section>
  );
}
function AddClaimModal({
  draft,
  receiptDraft,
  employees,
  base,
  existing,
  onClose,
  onAdd,
}: {
  draft: Partial<Claim>;
  receiptDraft: boolean;
  employees: Employee[];
  base: string;
  existing: Set<string>;
  onClose: () => void;
  onAdd: (claim: Claim) => void;
}) {
  const today = localISODate();
  const [form, setForm] = useState<Claim>({
    id: `CL-${Date.now().toString().slice(-8)}`,
    employeeId: receiptDraft ? "" : employees[0]?.id || "",
    employeeName: receiptDraft ? "" : employees[0]?.name || "",
    department: receiptDraft ? "" : employees[0]?.department || "",
    date: receiptDraft ? "" : today,
    submittedDate: today,
    merchant: "",
    category: "Other",
    amount: 0,
    currency: receiptDraft ? "" : base,
    receipt: false,
    description: "",
    ...draft,
  });
  const [error, setError] = useState("");
  function submit(e: FormEvent) {
    e.preventDefault();
    if (
      [...existing].some(
        (id) => id.trim().toLowerCase() === form.id.trim().toLowerCase(),
      )
    ) {
      setError("That claim ID already exists. Choose a unique ID.");
      return;
    }
    if (
      !form.id.trim() ||
      !form.employeeId.trim() ||
      !form.merchant.trim() ||
      !Number.isFinite(form.amount) ||
      form.amount <= 0
    ) {
      setError(
        "Complete the required fields and enter an amount greater than zero.",
      );
      return;
    }
    if (
      form.mileage !== undefined &&
      (!Number.isFinite(form.mileage) || form.mileage <= 0)
    ) {
      setError("Mileage must be greater than zero when supplied.");
      return;
    }
    onAdd({
      ...form,
      id: form.id.trim(),
      employeeId: form.employeeId.trim(),
      merchant: form.merchant.trim(),
    });
  }
  return (
    <ModalShell
      title={
        receiptDraft ? "Review your receipt draft" : "Add an expense claim"
      }
      subtitle={
        receiptDraft
          ? "AI extracted these fields. Check the original receipt and correct anything missing."
          : "Enter the evidence. Your policy checks run as soon as the claim is added."
      }
      onClose={onClose}
      footer={
        <>
          <button className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button primary"
            type="submit"
            form="add-claim-form"
          >
            <Plus size={16} />
            Add & check claim
          </button>
        </>
      }
    >
      <form id="add-claim-form" onSubmit={submit}>
        <div className="form-grid">
          <div className="field">
            <label className="field-label" htmlFor="new-id">
              Claim ID
            </label>
            <input
              required
              id="new-id"
              className="input"
              value={form.id}
              onChange={(e) => setForm((f) => ({ ...f, id: e.target.value }))}
              maxLength={100}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="new-employee">
              Employee {employees.length ? "" : "ID"}
            </label>
            {employees.length ? (
              <select
                required
                id="new-employee"
                className="select"
                value={form.employeeId}
                onChange={(e) => {
                  const emp = employees.find((x) => x.id === e.target.value);
                  if (!emp) return;
                  setForm((f) => ({
                    ...f,
                    employeeId: emp.id,
                    employeeName: emp.name,
                    department: emp.department,
                  }));
                }}
              >
                <option value="" disabled>
                  Select the employee
                </option>
                {employees.map((emp) => (
                  <option value={emp.id} key={emp.id}>
                    {emp.name} ({emp.id})
                  </option>
                ))}
              </select>
            ) : (
              <input
                required
                id="new-employee"
                maxLength={120}
                className="input"
                value={form.employeeId}
                onChange={(e) =>
                  setForm((f) => ({ ...f, employeeId: e.target.value }))
                }
              />
            )}
          </div>
          <div className="field">
            <label className="field-label" htmlFor="new-merchant">
              Merchant
            </label>
            <input
              required
              className="input"
              id="new-merchant"
              value={form.merchant}
              onChange={(e) =>
                setForm((f) => ({ ...f, merchant: e.target.value }))
              }
              maxLength={200}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="new-category">
              Category
            </label>
            <select
              id="new-category"
              className="select"
              value={form.category}
              onChange={(e) =>
                setForm((f) => ({ ...f, category: e.target.value }))
              }
            >
              {[...new Set([...categories, form.category])].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="new-amount">
              Amount
            </label>
            <input
              required
              className="input"
              id="new-amount"
              type="number"
              min="0.01"
              max="100000000"
              step="0.01"
              value={form.amount || ""}
              onChange={(e) =>
                setForm((f) => ({ ...f, amount: Number(e.target.value) }))
              }
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="new-currency">
              Currency
            </label>
            <input
              required
              className="input"
              id="new-currency"
              maxLength={3}
              minLength={3}
              pattern="[A-Z]{3}"
              value={form.currency}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  currency: e.target.value.toUpperCase(),
                }))
              }
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="new-date">
              Expense date
            </label>
            <input
              required
              className="input"
              id="new-date"
              type="date"
              value={form.date}
              onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="new-submitted">
              Submitted date
            </label>
            <input
              required
              className="input"
              id="new-submitted"
              type="date"
              value={form.submittedDate}
              onChange={(e) =>
                setForm((f) => ({ ...f, submittedDate: e.target.value }))
              }
            />
          </div>
          {form.category === "Mileage" && (
            <div className="field">
              <label className="field-label" htmlFor="new-mileage">
                Distance (miles)
              </label>
              <input
                className="input"
                id="new-mileage"
                type="number"
                min="0.1"
                step="0.1"
                value={form.mileage ?? ""}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    mileage: e.target.value
                      ? Number(e.target.value)
                      : undefined,
                  }))
                }
              />
            </div>
          )}
        </div>
        <div className="field">
          <label className="field-label" htmlFor="new-purpose">
            Business purpose
          </label>
          <textarea
            className="textarea"
            id="new-purpose"
            rows={3}
            maxLength={2000}
            value={form.description}
            onChange={(e) =>
              setForm((f) => ({ ...f, description: e.target.value }))
            }
          />
        </div>
        <label className="toggle-row">
          <span>
            <strong>Receipt is available</strong>
            <small>Record whether supporting evidence exists.</small>
          </span>
          <input
            className="switch"
            type="checkbox"
            checked={form.receipt}
            onChange={(e) =>
              setForm((f) => ({ ...f, receipt: e.target.checked }))
            }
          />
        </label>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </ModalShell>
  );
}

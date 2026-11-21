import type { AIConfig, AIProvider, AuditedClaim, Policy } from "../types";

export type AIAction =
  "chat" | "test" | "summary" | "explain" | "draft" | "receipt";
export interface ReceiptDraft {
  merchant?: string;
  date?: string;
  amount?: number;
  currency?: string;
  category?: string;
  description?: string;
}
export interface ConversationMessage {
  role: "user" | "assistant";
  text: string;
}
export interface AIInput {
  action: AIAction;
  prompt?: string;
  context?: unknown;
  conversation?: ConversationMessage[];
  image?: { data: string; mimeType: string };
}
export interface AIResult {
  text: string;
  receipt?: ReceiptDraft;
}

export const RECEIPT_MAX_BYTES = 2.5 * 1024 * 1024;
export const PROVIDERS: {
  id: AIProvider;
  name: string;
  defaultModel: string;
  keyPlaceholder: string;
}[] = [
  {
    id: "openai",
    name: "OpenAI",
    defaultModel: "gpt-6-luna",
    keyPlaceholder: "sk-…",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    defaultModel: "claude-haiku-5-5",
    keyPlaceholder: "sk-ant-…",
  },
  {
    id: "gemini",
    name: "Google Gemini",
    defaultModel: "gemini-3.5-flash-lite",
    keyPlaceholder: "AIza…",
  },
  { id: "openrouter", name: "OpenRouter", defaultModel: "openai/gpt-4o-mini", keyPlaceholder: "sk-or-v1-…" },
];

/** No key, prompt, image, or AI response is written to browser storage here. */
export async function requestAI(
  config: AIConfig,
  input: AIInput,
): Promise<AIResult> {
  if (!(config.provider === "openrouter" && config.useServerKey && config.accessToken?.trim()) && !config.apiKey.trim())
    throw new Error("Add your API key or server-key access code in AI settings first.");
  if (!config.model.trim())
    throw new Error("Choose a model in AI settings first.");
  const conversation = input.conversation
    ?.filter((message) => message.text.trim())
    .slice(-6)
    .map((message) => ({
      role: message.role,
      text:
        message.text.length > 1500
          ? `${message.text.slice(0, 1480)} [message truncated]`
          : message.text,
    }));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55_000);
  try {
    const response = await fetch("/api/ai", {
      method: "POST",
      mode: "same-origin",
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: config.provider,
        model: config.model.trim(),
        apiKey: config.useServerKey ? "" : config.apiKey.trim(),
        ...(config.provider === "openrouter" && config.useServerKey ? { useServerKey: true, accessToken: config.accessToken?.trim() || "" } : {}),
        ...input,
        ...(conversation ? { conversation } : {}),
      }),
      signal: controller.signal,
    });
    let payload: { text?: unknown; receipt?: ReceiptDraft; error?: unknown };
    try {
      payload = await response.json();
    } catch {
      throw new Error(
        response.status === 413
          ? "This receipt is too large. Use a PNG, JPEG, or WebP image under 2.5 MB."
          : "The AI service is unavailable. Please try again after deployment is complete.",
      );
    }
    if (!response.ok)
      throw new Error(
        typeof payload.error === "string"
          ? payload.error
          : "The AI request could not be completed. Please try again.",
      );
    if (typeof payload.text !== "string" || !payload.text.trim())
      throw new Error(
        "The model returned no readable answer. Try another model or a shorter question.",
      );
    return {
      text: payload.text,
      ...(payload.receipt ? { receipt: payload.receipt } : {}),
    };
  } catch (error) {
    if (controller.signal.aborted)
      throw new Error(
        "The AI request timed out. Try again or choose a faster model.",
      );
    if (error instanceof TypeError)
      throw new Error(
        "Could not reach the AI service. Check your connection and try again.",
      );
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/** Explicit allowlist: employee identities, notes, and descriptions never enter the context. */
export function buildAIContext(
  claims: AuditedClaim[],
  policy: Policy,
  selectedId?: string,
) {
  const ordered = [...claims].sort((a, b) => {
    if (a.id === selectedId) return -1;
    if (b.id === selectedId) return 1;
    return b.riskScore - a.riskScore || a.id.localeCompare(b.id);
  });
  const selected = ordered.slice(0, 60);
  const employees = new Map<string, string>();
  for (const claim of claims) {
    if (!employees.has(claim.employeeId))
      employees.set(claim.employeeId, `Employee ${employees.size + 1}`);
  }
  const amountsByCurrency: Record<string, number> = {};
  for (const claim of claims) {
    if (Number.isFinite(claim.amount))
      amountsByCurrency[claim.currency] =
        Math.round(
          ((amountsByCurrency[claim.currency] ?? 0) + claim.amount) * 100,
        ) / 100;
  }
  return {
    totalClaims: claims.length,
    includedClaims: selected.length,
    omittedClaims: Math.max(0, claims.length - selected.length),
    selection: selectedId
      ? "Selected claim first, then highest rule-based risk"
      : "Highest rule-based risk first",
    selectedClaimId: selectedId ?? null,
    summary: {
      amountsByCurrency,
      hold: claims.filter((c) => c.status === "hold").length,
      fix: claims.filter((c) => c.status === "fix").length,
      clear: claims.filter((c) => c.status === "clear").length,
    },
    policy: {
      baseCurrency: policy.baseCurrency,
      receiptThreshold: policy.receiptThreshold,
      mealLimit: policy.mealLimit,
      hotelLimit: policy.hotelLimit,
      mileageRate: policy.mileageRate,
      submissionWindow: policy.submissionWindow,
      maxClaimAmount: policy.maxClaimAmount,
      weekendReview: policy.weekendReview,
      requiredDescription: policy.requiredDescription,
      blockedMerchants: [...policy.blockedMerchants].slice(0, 30),
    },
    claims: selected.map((claim) => ({
      id: claim.id,
      employeeRef: employees.get(claim.employeeId),
      department: claim.department,
      date: claim.date,
      submittedDate: claim.submittedDate,
      merchant: claim.merchant,
      category: claim.category,
      amount: claim.amount,
      currency: claim.currency,
      receipt: claim.receipt,
      ...(claim.mileage !== undefined ? { mileage: claim.mileage } : {}),
      status: claim.status,
      riskScore: claim.riskScore,
      findings: claim.findings.map((finding) => ({
        code: finding.code,
        title: finding.title,
        severity: finding.severity,
        ...(finding.relatedIds
          ? { relatedIds: finding.relatedIds.slice(0, 12) }
          : {}),
      })),
    })),
    limitations:
      "Rule findings are review signals, not proof of fraud. Employee names, original employee IDs, descriptions, reviewer notes, and decision history are excluded. Amounts in different currencies are not converted or combined. Only the included claims can be inspected individually. No approval or payment actions are available.",
  };
}

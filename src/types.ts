export type Severity = 'high' | 'medium' | 'low';
export type ClaimStatus = 'hold' | 'fix' | 'clear';
export type Decision = 'pending' | 'approved' | 'rejected' | 'follow-up';
export interface Claim {
  id: string; employeeId: string; employeeName: string; department: string;
  date: string; submittedDate: string; merchant: string; category: string;
  amount: number; currency: string; receipt: boolean; description: string;
  mileage?: number;
}
export interface Employee { id: string; name: string; department: string; status: 'active' | 'inactive'; manager?: string }
export interface Policy {
  baseCurrency: string; receiptThreshold: number; mealLimit: number; hotelLimit: number;
  mileageRate: number; submissionWindow: number; maxClaimAmount: number;
  weekendReview: boolean; blockedMerchants: string[]; requiredDescription: boolean;
}
export interface Finding { code: string; title: string; description: string; severity: Severity; relatedIds?: string[] }
export interface ClaimDecision { decision: Decision; note: string; updatedAt: string }
export interface AuditedClaim extends Claim { findings: Finding[]; riskScore: number; status: ClaimStatus }
export interface SavedRun {
  id: string; name: string; createdAt: string; claims: Claim[]; employees: Employee[];
  policy: Policy; decisions: Record<string, ClaimDecision>; events: AuditEvent[];
  comparisonClaims?: Claim[]; isDemo?: boolean;
}
export interface AuditEvent { id: string; timestamp: string; claimId?: string; action: string; detail: string }
export interface ImportResult<T> { data: T[]; warnings: string[]; errors: string[] }
export interface Workspace { claims: Claim[]; employees: Employee[]; policy: Policy; decisions: Record<string, ClaimDecision>; events: AuditEvent[]; isDemo: boolean; name: string }
export type AIProvider = 'openai' | 'anthropic' | 'gemini';
export interface AIConfig { provider: AIProvider; model: string; apiKey: string }

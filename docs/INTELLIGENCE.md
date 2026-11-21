# ClaimLens Intelligence: behavioral screening

The **Intelligence** workspace screens the current full claim batch locally and provides
a separate **Investigate signals with AI** action. This adds behavioral comparisons to
the deterministic policy engine, but it does **not** train or run a calibrated fraud
classifier.

## What is screened

| Signal | Minimum evidence | Interpretation |
| --- | --- | --- |
| Category amount outlier | At least 10 positive claims in the same category and currency | Compares claim amounts with the group's median and median absolute deviation (MAD), applying a relative and minimum absolute difference |
| Employee amount outlier | At least 8 positive claims for the same employee and currency | Checks whether a claim is unusually high versus that employee's recorded history in this run, across categories |
| Merchant amount outlier | At least 6 positive claims with the same normalized merchant, category, and currency | Compares the charge to the merchant's prior amounts |
| Possible near-duplicate | Same employee and currency, near amount and similarly named merchant within seven calendar days | Suggests source-receipt comparison; same-day exact duplicates remain the responsibility of the existing rules engine |
| Grouped charges above a category limit | Same employee, vendor, currency, and category within two days | Two individually below-limit claims together exceed the configured meal or accommodation limit; separate valid purchases may explain them |
| Rapid same-merchant repeat | Four or more claims for the same employee, normalized merchant and currency within 24 hours | Flags unusual transaction frequency |
| Merchant concentration | At least eight positive claims for an employee, at least five with one merchant, at least 80% of positive claimed value at that merchant | Highlights reliance on one vendor and may reflect legitimate recurring work |

The engine only compares equivalent currencies. Negative amounts are excluded
from positive-claim distribution baselines and remain in the existing credit/refund
reconciliation workflow. Invalid dates are omitted from temporal comparison
windows but still counted in the number of records screened and separately
flagged by the original data-quality rules.

The amounts, thresholds, cohort sizes, and weights are product-defined
heuristics, not official corporate policy or industry-standard fraud probabilities.
The overall screening priority score (0 to 100) is a capped sum of heuristic
signal weights. It is **not** a fraud risk percentage or a machine-learning
confidence level. An absence of signals does not prove an expense legitimate.

The near-match comparison examines up to 30 next claims per employee/currency
date window to prevent unreasonable work on files with 10,000 rows. This means
it is a **bounded screening method**, not an exhaustive all-pairs similarity
test. Confirm findings against original receipts and travel documentation.

## AI copilot scope

**Local screening automatically checks all imported claims with no AI key or
provider charges.** It runs when claims or policy change and is visible in
Intelligence. No source files are automatically transmitted.

**Model review is opt-in.** Clicking **Investigate signals with AI** sends:
- Aggregate screening totals and signal categories covering the entire run.
- Up to 60 highest-priority individual claims selected using both behavioral
  and deterministic review signals.
- Per-claim pseudonymous employee references, merchant/category/amount/date,
  source rule titles, and bounded anomaly signal explanations and related IDs.

Employee names, original employee IDs, free-text business purposes, reviewer
notes, and saved decisions are not included in the structured model context.
A person can still type personal information directly into an AI question.
The selected AI provider receives the bounded context via ClaimLens's Vercel
function only when a model action is explicitly requested. OpenRouter charges
and model access depend on the user's account.

This is an assisted analyst workflow, not an autonomous agent: ClaimLens does
not approve, reject, pay, email, browse, edit records, or make allegations.

## Workflow

1. Import a claims CSV and employee roster or restore a private ClaimLens audit.
2. Open **Intelligence**. See total coverage, patterns, and claim-by-claim evidence.
3. Filter by pattern, review priority, merchant, or claim ID. Expand evidence
   and related claim IDs. Choose **Review** to open the existing claim review.
4. Export local evidence to spreadsheet-safe CSV for audit documentation.
5. Optionally connect an AI provider and choose **Investigate signals with AI**.
   AI reviews the summary and the **sampled**, highest-priority claim details.
6. Verify signals manually against receipts, employee eligibility, and the
   organization's actual policies before recording a decision.

The application is a browser-local workspace, not shared organizational
storage. Do not commit private employee files or audit exports to public GitHub.

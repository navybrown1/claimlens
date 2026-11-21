import { useMemo, useState } from "react";
import { ArrowRight, BarChart3, BrainCircuit, Download, FileSearch, Search, ShieldAlert, Sparkles } from "lucide-react";
import type { AuditedClaim } from "./types";
import type { AnomalyReport } from "./lib/anomalies";
import "./intelligence.css";

interface Props {
  report: AnomalyReport;
  claims: AuditedClaim[];
  onReview: (claimId: string) => void;
  onAnalyze: () => void;
  onConnect: () => void;
  onExport: () => void;
  canUseAI: boolean;
  busy: boolean;
}
function currency(amount: number, code: string) {
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency: code }).format(amount); }
  catch { return code + " " + amount.toFixed(2); }
}
export default function IntelligencePage({ report, claims, onReview, onAnalyze, onConnect, onExport, canUseAI, busy }: Props) {
  const [search, setSearch] = useState("");
  const [priority, setPriority] = useState("all");
  const [pattern, setPattern] = useState("all");
  const [limit, setLimit] = useState(25);
  const claimById = useMemo(() => new Map(claims.map((claim) => [claim.id, claim])), [claims]);
  const filtered = useMemo(() => report.items.filter((item) => {
    const claim = claimById.get(item.claimId);
    const query = search.trim().toLowerCase();
    return (priority === "all" || priority === item.priority) &&
      (pattern === "all" || item.signals.some((s) => s.code === pattern)) &&
      (!query || [item.claimId, claim?.merchant, claim?.employeeName, claim?.department, claim?.category].some((value) => value?.toLowerCase().includes(query)));
  }), [report, priority, pattern, search, claimById]);
  const shown = filtered.slice(0, limit);
  return (
    <div className="intelligence-page">
      <section className="intelligence-hero">
        <div className="intelligence-hero-copy">
          <span className="intelligence-eyebrow"><BrainCircuit size={16} /> BEHAVIORAL REVIEW</span>
          <h2>Patterns that policy rules miss.</h2>
          <p>Screen every claim against observed spending patterns, repeated transactions, and peer-level baselines. Every signal includes a reason and evidence to check.</p>
          <div className="intelligence-actions">
            <button className="button primary" disabled={!report.scanned || busy} onClick={canUseAI ? onAnalyze : onConnect}>
              <Sparkles size={17} /> {canUseAI ? "Investigate signals with AI" : "Connect AI to investigate"} <ArrowRight size={16} />
            </button>
            <button className="button secondary" disabled={!report.flagged} onClick={onExport}><Download size={17} /> Export findings</button>
          </div>
        </div>
        <div className="intelligence-coverage">
          <span>FULL-DATASET COVERAGE</span>
          <strong>{report.scanned.toLocaleString()} <small>/ {report.scanned.toLocaleString()}</small></strong>
          <div className="coverage-bar" role="progressbar" aria-label="Claims screened" aria-valuenow={report.scanned} aria-valuemax={report.scanned || 1}><span style={{ width: report.scanned ? "100%" : "0%" }}/></div>
          <p>Every imported claim screened locally. {report.scanned ? "No AI credits used for the screening step." : "Import your claims to begin."}</p>
        </div>
      </section>
      <div className="intelligence-metrics">
        <div><span>Claims screened</span><strong>{report.scanned.toLocaleString()}</strong><small>Entire current run</small></div>
        <div><span>Claims with signals</span><strong>{report.flagged.toLocaleString()}</strong><small>Review leads, not fraud findings</small></div>
        <div><span>Higher-priority combinations</span><strong>{report.high.toLocaleString()}</strong><small>Multiple weighted signals</small></div>
        <div><span>Evidence signals</span><strong>{report.signalCount.toLocaleString()}</strong><small>Patterns can overlap</small></div>
      </div>
      <div className="intelligence-two-columns">
        <section className="panel intelligence-patterns">
          <div className="panel-header">
            <div><h3 className="panel-title">What the screening noticed</h3><p className="panel-subtitle">A reason for every flagged claim</p></div>
            <BarChart3 size={20}/>
          </div>
          <div className="panel-body">
            {report.patterns.length ? report.patterns.map((row) => (
              <button type="button" key={row.code} className={"intelligence-pattern-row" + (pattern === row.code ? " selected" : "")} onClick={() => {setPattern(pattern === row.code ? "all" : row.code);setLimit(25);}}>
                <span>{row.title}</span><span className="pattern-meter"><span style={{width: Math.max(5,row.count/Math.max(1,report.patterns[0].count)*100) + "%"}}/></span><strong>{row.count}</strong>
              </button>
            )) : <p className="muted">No unusual patterns detected yet. Import claims to start the analysis.</p>}
          </div>
        </section>
        <section className="panel intelligence-method">
          <div className="panel-header"><div><h3 className="panel-title">Evidence, not accusations</h3><p className="panel-subtitle">How to interpret these results</p></div><ShieldAlert size={20}/></div>
          <div className="panel-body">
            <p>Comparisons use robust medians, recurring merchant windows, similar vendor names, and category thresholds. Small comparison groups do not generate statistical-outlier claims.</p>
            <p>These are <strong>transparent screening signals</strong>, not a trained fraud model, proof of misconduct, or a probability of fraud. Travel, team meals, refunds, and repeated legitimate purchases may explain them.</p>
            <p>The optional AI step sends aggregate results for the entire run and up to 60 prioritized claim excerpts. It excludes employee names, original employee IDs, free-text purposes, and reviewer notes. AI cannot approve or reject claims.</p>
          </div>
        </section>
      </div>
      <section className="panel intelligence-results">
        <div className="panel-header"><div><h3 className="panel-title">Investigations to review</h3><p className="panel-subtitle">{filtered.length.toLocaleString()} flagged claims match the current filters</p></div><FileSearch size={20}/></div>
        <div className="intelligence-toolbar">
          <label className="intelligence-search"><Search size={16}/><input aria-label="Search anomaly findings" value={search} onChange={(e)=>{setSearch(e.target.value);setLimit(25);}} placeholder="Claim, merchant, employee, department..." /></label>
          <select aria-label="Filter anomaly priority" value={priority} onChange={(e)=>{setPriority(e.target.value);setLimit(25);}}>
            <option value="all">All priorities</option><option value="high">Higher priority</option><option value="medium">Medium priority</option><option value="low">Lower priority</option>
          </select>
          <select aria-label="Filter anomaly pattern" value={pattern} onChange={(e)=>{setPattern(e.target.value);setLimit(25);}}>
            <option value="all">Every pattern</option>{report.patterns.map((row)=><option value={row.code} key={row.code}>{row.title}</option>)}
          </select>
        </div>
        {shown.length ? (
          <div className="intelligence-table-wrap"><table className="intelligence-table">
            <thead><tr><th>Claim</th><th>Amount</th><th>Review priority</th><th>Evidence</th><th>Action</th></tr></thead>
            <tbody>{shown.map((item)=>{
              const claim=claimById.get(item.claimId);
              return <tr key={item.claimId}>
                <td><strong>{item.claimId}</strong><small>{claim?.merchant || "Unknown merchant"} · {claim?.category || "Uncategorized"}</small></td>
                <td className="intelligence-money">{claim ? currency(claim.amount,claim.currency) : "—"}</td>
                <td><span className={"intelligence-risk " + item.priority}>{item.priority === "high" ? "Higher" : item.priority === "medium" ? "Medium" : "Lower"} <span>{item.score}</span></span></td>
                <td><details><summary>{item.signals.length} signal{item.signals.length === 1 ? "" : "s"} · {item.signals[0].title}</summary><div className="intelligence-evidence">{item.signals.map((signal)=><div key={signal.code}><strong>{signal.title}</strong><p>{signal.explanation}</p>{signal.relatedIds.length > 0 && <small>Related claims: {signal.relatedIds.join(", ")}</small>}</div>)}</div></details></td>
                <td><button type="button" className="button secondary small" onClick={()=>onReview(item.claimId)}>Review <ArrowRight size={14}/></button></td>
              </tr>;
            })}</tbody>
          </table></div>
        ) : <div className="intelligence-empty"><FileSearch size={30}/><h3>{report.scanned ? "No findings match these filters" : "Your analysis starts with a claim import"}</h3><p>{report.scanned ? "Try clearing the search or filters. Not every legitimate expense needs further review." : "Import CSV, Excel, or your private audit backup to screen the full dataset."}</p></div>}
        <div className="intelligence-footer"><span>Showing {shown.length} of {filtered.length} matching claims</span>{shown.length < filtered.length && <button className="button secondary small" onClick={()=>setLimit((n)=>n+25)}>Show 25 more</button>}</div>
      </section>
    </div>
  );
}
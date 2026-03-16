"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Send, Loader2, Trash2, Sparkles, BookOpen,
  AlertCircle, FileText, X,
} from "lucide-react";
import { getPipelineSummary } from "@/lib/pipeline-store";

// ── Types ──
interface Message {
  role: "user" | "assistant";
  content: string;
  docs?: string[];
  phase?: string;
}

interface LoanCopilotProps {
  isOpen: boolean;
  onClose: () => void;
  loanContext: string;
}

// ── Citation source mapping (mirrors Milo page) ──
const SOURCE_TO_FILE: Record<string, string> = {
  "hud handbook 4000.1": "40001 FHA SFH Handbook.pdf",
  "fha handbook 4000.1": "40001 FHA SFH Handbook.pdf",
  "fha handbook": "40001 FHA SFH Handbook.pdf",
  "4000.1": "40001 FHA SFH Handbook.pdf",
  "fha chapter 1": "Chapter_1_Lender_Approval_Guidelines.pdf",
  "fha chapter 10": "Ch10_Appraisal_Process_NEW.pdf",
  "fha chapter 11": "Ch11_Appraisal_Report.pdf",
  "fha chapter 12": "Ch12_Minimum_Property_Requirement_NEW.pdf",
  "fha chapter 13": "Chapter_13.pdf",
  "fha chapter 14": "Chapter_14.pdf",
  "fha chapter 15": "Chapter_15.pdf",
  "fha chapter 16": "Chapter_16.pdf",
  "fha chapter 17": "Chapter_17.pdf",
  "fha chapter 18": "Chapter_18.pdf",
  "va pamphlet 26-7": "VA Handbook all chapters 12.2.24 (2).pdf",
  "va handbook": "VA Handbook all chapters 12.2.24 (2).pdf",
  "va chapter 2": "chapter2-veterans-eligibility-and-entitlement.pdf",
  "va chapter 3": "chapter3-the-va-loan-and-guaranty.pdf",
  "va chapter 4": "chapter_4_credit_underwriting.pdf",
  "va chapter 5": "vap26-7-chapter5-how-to-process-va-loans-and-submit-them-to-va.pdf",
  "va chapter 6": "chapter6-refinancing-loans.pdf",
  "va chapter 7": "vchapter7-loans-requiring-special-underwriting-guaranty-and-other-considerations.pdf",
  "va chapter 8": "chapter8-borrower-fees-and-charges-and-the-va-funding-fee.pdf",
  "va chapter 9": "ch9-legal-instruments-liens-escrows-and-related-issues.pdf",
  "fannie mae selling guide": "Selling-Guide_12-11-24 Highighted.pdf",
  "fannie mae": "Selling-Guide_12-11-24 Highighted.pdf",
  "freddie mac": "Freddie Mac Selling Guide 10.2.24.pdf",
  "freddie mac seller/servicer guide": "Freddie Mac Selling Guide 10.2.24.pdf",
  "freddie mac selling guide": "Freddie Mac Selling Guide 10.2.24.pdf",
  "usda hb-1-3555": "USDA hb-1-3555_0 12.2.24.pdf",
  "usda handbook": "USDA hb-1-3555_0 12.2.24.pdf",
  "usda": "USDA hb-1-3555_0 12.2.24.pdf",
};

function resolveSourceFile(citation: string): string | null {
  const lower = citation.toLowerCase();
  for (const [key, file] of Object.entries(SOURCE_TO_FILE)) {
    if (lower.includes(key)) return file;
  }
  const fhaChapterMatch = lower.match(/(?:fha|hud).*?chapter\s*(\d+)/);
  if (fhaChapterMatch) {
    const key = `fha chapter ${fhaChapterMatch[1]}`;
    if (SOURCE_TO_FILE[key]) return SOURCE_TO_FILE[key];
  }
  const vaChapterMatch = lower.match(/va.*?chapter\s*(\d+)/);
  if (vaChapterMatch) {
    const key = `va chapter ${vaChapterMatch[1]}`;
    if (SOURCE_TO_FILE[key]) return SOURCE_TO_FILE[key];
  }
  if (lower.includes("fha") || lower.includes("hud")) return SOURCE_TO_FILE["fha handbook 4000.1"];
  if (lower.includes("va")) return SOURCE_TO_FILE["va handbook"];
  if (lower.includes("fannie")) return SOURCE_TO_FILE["fannie mae"];
  if (lower.includes("freddie")) return SOURCE_TO_FILE["freddie mac"];
  if (lower.includes("usda") || lower.includes("rural")) return SOURCE_TO_FILE["usda"];
  return null;
}

function parseCitationLocation(citation: string): { page?: number; search?: string } {
  const pageMatch =
    citation.match(/\bp\.?\s*(\d+)/i) ||
    citation.match(/\bpage\s+(\d+)/i) ||
    citation.match(/\bpg\.?\s*(\d+)/i) ||
    citation.match(/\bpp\.?\s*(\d+)/i);
  const page = pageMatch ? parseInt(pageMatch[1]) : undefined;
  const sectionMatch = citation.match(/Section\s+([\w.\-()\/]+(?:\s*[\w.\-()\/]+)*)/i);
  const chapterMatch = !sectionMatch ? citation.match(/Chapter\s+(\d+)/i) : null;
  const search = sectionMatch
    ? sectionMatch[1].replace(/[,\s]+$/, "").trim()
    : chapterMatch
      ? `Chapter ${chapterMatch[1]}`
      : undefined;
  return { page, search };
}

function buildPdfUrl(file: string, citation: string): string {
  const base = `/api/milo/docs?file=${encodeURIComponent(file)}`;
  const loc = parseCitationLocation(citation);
  const parts: string[] = ["toolbar=1"];
  if (loc.page) parts.push(`page=${loc.page}`);
  if (loc.search) parts.push(`search=${encodeURIComponent(loc.search)}`);
  if (!loc.page) parts.push("view=FitH");
  return `${base}#${parts.join("&")}`;
}

// ── Markdown renderer with citation support ──
function renderMarkdown(text: string, onCitationClick: (file: string, citation: string) => void) {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let tableRows: string[][] = [];
  let tableHeader: string[] = [];
  let inTable = false;
  let listItems: string[] = [];
  let inList = false;
  let key = 0;

  const flushList = () => {
    if (listItems.length > 0) {
      elements.push(
        <ul key={key++} className="list-disc list-inside space-y-0.5 my-1.5 text-[13px] leading-relaxed">
          {listItems.map((item, i) => <li key={i}>{inlineFormat(item)}</li>)}
        </ul>
      );
      listItems = [];
      inList = false;
    }
  };

  const flushTable = () => {
    if (tableHeader.length > 0 || tableRows.length > 0) {
      const headers = tableHeader.length > 0 ? tableHeader : (tableRows[0] || []);
      const body = tableHeader.length > 0 ? tableRows : tableRows.slice(1);
      elements.push(
        <div key={key++} className="overflow-x-auto my-2">
          <table className="w-full text-[11px] border-collapse">
            <thead>
              <tr className="bg-orange-50">
                {headers.map((h, i) => (
                  <th key={i} className="border border-orange-200 px-2 py-1.5 text-left font-semibold text-[var(--text-primary)]">
                    {inlineFormat(h.trim())}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((row, ri) => (
                <tr key={ri} className={ri % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                  {row.map((cell, ci) => (
                    <td key={ci} className="border border-gray-200 px-2 py-1">
                      {inlineFormat(cell.trim())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      tableHeader = [];
      tableRows = [];
      inTable = false;
    }
  };

  const inlineFormat = (text: string): React.ReactNode => {
    const citationParts = text.split(/(【[^】]+】)/g);
    return citationParts.map((segment, si) => {
      if (segment.startsWith("【") && segment.endsWith("】")) {
        const citation = segment.slice(1, -1);
        const file = resolveSourceFile(citation);
        if (file) {
          return (
            <button
              key={`cite-${si}`}
              onClick={(e) => { e.stopPropagation(); onCitationClick(file, citation); }}
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 mx-0.5 bg-orange-100 text-orange-700 rounded text-[10px] font-medium hover:bg-orange-200 transition-colors cursor-pointer border border-orange-200"
              title={`View source: ${citation}`}
            >
              <BookOpen className="w-2.5 h-2.5" />
              {citation.length > 40 ? citation.slice(0, 37) + "..." : citation}
            </button>
          );
        }
        return (
          <span key={`cite-${si}`} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 mx-0.5 bg-gray-100 text-gray-600 rounded text-[10px] font-medium border border-gray-200">
            <FileText className="w-2.5 h-2.5" />
            {citation.length > 40 ? citation.slice(0, 37) + "..." : citation}
          </span>
        );
      }
      const parts = segment.split(/(\*\*[^*]+\*\*)/g);
      return parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return <strong key={`${si}-${i}`} className="font-semibold text-[var(--text-primary)]">{part.slice(2, -2)}</strong>;
        }
        const codeParts = part.split(/(`[^`]+`)/g);
        return codeParts.map((cp, j) => {
          if (cp.startsWith("`") && cp.endsWith("`")) {
            return <code key={`${si}-${i}-${j}`} className="bg-orange-50 text-orange-700 px-1 py-0.5 rounded text-[11px] font-mono">{cp.slice(1, -1)}</code>;
          }
          return cp;
        });
      });
    });
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      flushList();
      const cells = trimmed.split("|").slice(1, -1).map(c => c.trim());
      if (cells.every(c => /^[-:]+$/.test(c))) { inTable = true; continue; }
      if (!inTable && tableHeader.length === 0) { tableHeader = cells; } else { tableRows.push(cells); }
      inTable = true;
      continue;
    }
    if (inTable) flushTable();
    if (/^[-*]\s/.test(trimmed)) { listItems.push(trimmed.replace(/^[-*]\s/, "")); inList = true; continue; }
    if (/^\d+\.\s/.test(trimmed)) { listItems.push(trimmed.replace(/^\d+\.\s/, "")); inList = true; continue; }
    if (inList) flushList();
    if (trimmed === "") { elements.push(<div key={key++} className="h-1.5" />); continue; }
    if (trimmed.startsWith("### ")) { elements.push(<h4 key={key++} className="text-[13px] font-bold mt-3 mb-1 text-[var(--text-primary)]">{inlineFormat(trimmed.slice(4))}</h4>); continue; }
    if (trimmed.startsWith("## ")) { elements.push(<h3 key={key++} className="text-sm font-bold mt-3 mb-1 text-[var(--accent)]">{inlineFormat(trimmed.slice(3))}</h3>); continue; }
    if (trimmed.startsWith("# ")) { elements.push(<h2 key={key++} className="text-[15px] font-bold mt-3 mb-1.5 text-[var(--accent)]">{inlineFormat(trimmed.slice(2))}</h2>); continue; }
    if (/^---+$/.test(trimmed)) { elements.push(<hr key={key++} className="my-2 border-gray-200" />); continue; }
    elements.push(<p key={key++} className="text-[13px] leading-relaxed my-0.5">{inlineFormat(trimmed)}</p>);
  }
  if (inList) flushList();
  if (inTable) flushTable();
  return elements;
}

// ── Loan-specific starter questions ──
const LOAN_STARTERS = [
  { label: "Eligibility check", q: "Based on this loan's program, amount, and borrower profile, what are the key eligibility requirements I should verify?" },
  { label: "Red flags & risks", q: "Review this loan's details and flag any potential red flags, compliance risks, or items that need attention before underwriting." },
  { label: "Document checklist", q: "What documents should be in the file for this specific loan type and program? Create a checklist." },
  { label: "Rate lock analysis", q: "Analyze this loan's rate lock status and expiration. Any recommendations on timing?" },
];

// ── Component ──
export default function LoanCopilot({ isOpen, onClose, loanContext }: LoanCopilotProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState("");
  const [phase, setPhase] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [pdfPanel, setPdfPanel] = useState<{ file: string; citation: string } | null>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);
  useEffect(() => { if (isOpen) setTimeout(() => inputRef.current?.focus(), 300); }, [isOpen]);

  const openPdfPanel = useCallback((file: string, citation: string) => {
    setPdfPanel({ file, citation });
  }, []);

  const sendMessage = async (text?: string) => {
    const content = (text || input).trim();
    if (!content || loading) return;

    setInput("");
    setError("");
    setPhase("");
    const userMsg: Message = { role: "user", content };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setLoading(true);
    setStreaming(true);

    const assistantMsg: Message = { role: "assistant", content: "", docs: [] };
    setMessages([...updatedMessages, assistantMsg]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/milo/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: updatedMessages.map(m => ({ role: m.role, content: m.content })),
          pipelineContext: getPipelineSummary(),
          loanContext,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error || err.detail || `Request failed (${res.status})`);
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";
      let docs: string[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        accumulated += chunk;

        if (accumulated.includes("<!--DOCS:") && accumulated.includes("-->")) {
          const match = accumulated.match(/<!--DOCS:(.*?)-->/);
          if (match) {
            try { docs = JSON.parse(match[1]); } catch { /* */ }
            accumulated = accumulated.replace(/<!--DOCS:.*?-->/, "");
          }
        }
        if (accumulated.includes("<!--PHASE:") && accumulated.includes("-->")) {
          const phaseMatch = accumulated.match(/<!--PHASE:(.*?)-->/);
          if (phaseMatch) {
            setPhase(phaseMatch[1]);
            accumulated = accumulated.replace(/<!--PHASE:.*?-->/, "");
          }
        }

        setMessages(prev => {
          const copy = [...prev];
          copy[copy.length - 1] = { role: "assistant", content: accumulated, docs };
          return copy;
        });
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setError((err as Error).message || "Failed to get response");
      setMessages(prev => prev.filter(m => !(m.role === "assistant" && m.content === "")));
    } finally {
      setLoading(false);
      setStreaming(false);
      setPhase("");
      abortRef.current = null;
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  const clearChat = () => {
    if (abortRef.current) abortRef.current.abort();
    setMessages([]);
    setInput("");
    setError("");
    setPhase("");
    setLoading(false);
    setStreaming(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  return (
    <>
      {/* ── Copilot Sidebar Panel ── */}
      <div
        className={`fixed top-0 left-0 h-full w-[420px] z-[60] flex flex-col border-r border-[var(--border)] bg-white shadow-xl transition-transform duration-300 ${isOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] bg-gradient-to-r from-orange-50 to-white flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center shadow-sm">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div>
              <h3 className="text-sm font-bold">Milo AI</h3>
              <p className="text-[10px] text-[var(--text-muted)]">Loan Copilot</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {messages.length > 0 && (
              <button onClick={clearChat} className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-red-600 hover:bg-red-50 transition-colors" title="Clear chat">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
            <button onClick={onClose} className="p-1.5 rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-secondary)] transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto px-3 py-3">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center text-center pt-6">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center mb-3 shadow-md shadow-orange-200">
                <Sparkles className="w-6 h-6 text-white" />
              </div>
              <h4 className="text-sm font-bold mb-1">Ask Milo about this loan</h4>
              <p className="text-xs text-[var(--text-muted)] mb-4 px-2 leading-relaxed">
                Full access to FHA, VA, Fannie Mae, Freddie Mac &amp; USDA guidelines, plus this loan&apos;s details.
              </p>
              <div className="w-full space-y-1.5">
                {LOAN_STARTERS.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => sendMessage(s.q)}
                    className="w-full text-left px-3 py-2.5 bg-white border border-[var(--border)] rounded-lg hover:border-[var(--accent)] hover:bg-orange-50/50 transition-all group"
                  >
                    <span className="text-xs font-semibold text-[var(--accent)]">{s.label}</span>
                    <p className="text-[11px] text-[var(--text-muted)] mt-0.5 line-clamp-2">{s.q}</p>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[90%] ${msg.role === "user" ? "order-1" : ""}`}>
                    {msg.role === "assistant" && msg.docs && msg.docs.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-1 ml-1">
                        {msg.docs.map((doc, di) => (
                          <span key={di} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded-full text-[9px] font-medium">
                            <BookOpen className="w-2 h-2" />{doc}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className={`rounded-2xl px-3 py-2.5 ${
                      msg.role === "user"
                        ? "bg-[var(--accent)] text-white rounded-br-md"
                        : "bg-white border border-[var(--border)] rounded-bl-md shadow-sm"
                    }`}>
                      {msg.role === "user" ? (
                        <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                      ) : msg.content ? (
                        <div className="prose-sm">{renderMarkdown(msg.content, openPdfPanel)}</div>
                      ) : (
                        <div className="flex items-center gap-2 text-[11px] text-[var(--text-muted)] py-1">
                          <Loader2 className="w-3 h-3 animate-spin text-[var(--accent)]" />
                          {phase === "synthesizing" ? "Synthesizing from multiple documents..." : "Analyzing guidelines..."}
                        </div>
                      )}
                    </div>
                    {msg.role === "assistant" && streaming && i === messages.length - 1 && msg.content && (
                      <div className="flex items-center gap-1 mt-0.5 ml-1">
                        <span className="w-1 h-1 rounded-full bg-[var(--accent)] animate-pulse" />
                        <span className="text-[9px] text-[var(--text-muted)]">Streaming...</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Follow-up chips */}
        {messages.length > 0 && !loading && (
          <div className="px-3 pb-1 flex gap-1 overflow-x-auto scrollbar-hide">
            {["Check DTI limits", "Required conditions", "Compare programs"].map((q, i) => (
              <button
                key={i}
                onClick={() => sendMessage(q)}
                className="shrink-0 px-2.5 py-1 bg-white border border-[var(--border)] rounded-full text-[11px] text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors"
              >
                {q}
              </button>
            ))}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mx-3 mb-2 p-2 bg-red-50 border border-red-200 rounded-lg flex items-center gap-1.5 text-[11px] text-red-700">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            {error}
          </div>
        )}

        {/* Input Area */}
        <div className="px-3 pb-3 pt-2 border-t border-[var(--border)] flex-shrink-0">
          <div className="flex items-end gap-1.5">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about this loan..."
              rows={1}
              disabled={loading}
              className="flex-1 px-3 py-2 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl text-[13px] resize-none focus:outline-none focus:border-[var(--accent)] placeholder-[var(--text-muted)] disabled:opacity-50"
              style={{ minHeight: "36px", maxHeight: "80px" }}
              onInput={e => {
                const t = e.target as HTMLTextAreaElement;
                t.style.height = "auto";
                t.style.height = Math.min(t.scrollHeight, 80) + "px";
              }}
            />
            <button
              onClick={() => sendMessage()}
              disabled={!input.trim() || loading}
              className="w-8 h-8 flex items-center justify-center rounded-xl bg-[var(--accent)] text-white disabled:opacity-30 hover:bg-[var(--accent-dark)] transition-colors flex-shrink-0"
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            </button>
          </div>
          <p className="text-center text-[9px] text-[var(--text-muted)] mt-1.5">
            Grounded in official FHA, VA, Fannie Mae, Freddie Mac &amp; USDA guidelines
          </p>
        </div>
      </div>

      {/* ── PDF Side Panel ── */}
      {pdfPanel && isOpen && (
        <div className="fixed top-0 right-0 h-full w-1/2 z-[100] flex flex-col bg-white border-l border-gray-200 shadow-2xl animate-in slide-in-from-right duration-300">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
            <div className="flex items-center gap-2 min-w-0">
              <FileText className="w-4 h-4 text-[var(--accent)] shrink-0" />
              <div className="min-w-0">
                <h3 className="text-sm font-semibold truncate">{pdfPanel.file}</h3>
                <p className="text-[10px] text-[var(--text-muted)] truncate">{pdfPanel.citation}</p>
              </div>
            </div>
            <button
              onClick={() => setPdfPanel(null)}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-200 transition-colors"
            >
              <X className="w-4 h-4 text-gray-500" />
            </button>
          </div>
          <div className="flex-1 relative">
            {(() => {
              const pdfUrl = buildPdfUrl(pdfPanel.file, pdfPanel.citation);
              const loc = parseCitationLocation(pdfPanel.citation);
              return (
                <>
                  {(loc.page || loc.search) && (
                    <div className="px-4 py-1.5 bg-amber-50 border-b border-amber-200 text-[10px] text-amber-700 flex items-center gap-2">
                      {loc.page && <span>Jumping to page {loc.page}</span>}
                      {loc.page && loc.search && <span>&middot;</span>}
                      {loc.search && <span>Searching for &quot;{loc.search}&quot;</span>}
                    </div>
                  )}
                  <object data={pdfUrl} type="application/pdf" className="w-full h-full" title={`PDF: ${pdfPanel.file}`}>
                    <iframe src={pdfUrl} className="w-full h-full border-0" title={`PDF: ${pdfPanel.file}`} />
                  </object>
                </>
              );
            })()}
          </div>
        </div>
      )}
    </>
  );
}

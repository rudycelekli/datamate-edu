"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  Send, Loader2, Trash2, BarChart3, Sparkles, BookOpen,
  MessageSquare, ChevronDown, AlertCircle, FileText,
} from "lucide-react";

// ── Types ──
interface Message {
  role: "user" | "assistant";
  content: string;
  docs?: string[];
}

// ── Suggested starter questions ──
const STARTERS = [
  { label: "FHA credit requirements", q: "What are the FHA credit score and down payment requirements? When is manual underwriting required?" },
  { label: "VA vs FHA comparison", q: "Compare VA and FHA loans for a first-time homebuyer veteran with a 640 credit score buying a single-family primary residence." },
  { label: "Conventional DTI limits", q: "What are the DTI limits for conventional loans? How do DU findings affect the max DTI?" },
  { label: "Self-employed income", q: "How do you calculate self-employed income for a borrower with 2 years of tax returns showing declining income?" },
  { label: "VA funding fee", q: "Explain the VA funding fee structure. When is a veteran exempt? How does it change with subsequent use?" },
  { label: "USDA eligibility", q: "What are the USDA loan eligibility requirements including income limits and property location rules?" },
  { label: "Non-occupant co-borrower", q: "Can a non-occupant co-borrower be added to an FHA loan? What about conventional? What are the LTV impacts?" },
  { label: "Condo approval", q: "What are the condo project approval requirements for FHA vs conventional loans?" },
];

// ── Simple markdown renderer ──
function renderMarkdown(text: string) {
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
        <ul key={key++} className="list-disc list-inside space-y-1 my-2 text-sm leading-relaxed">
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
        <div key={key++} className="overflow-x-auto my-3">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-orange-50">
                {headers.map((h, i) => (
                  <th key={i} className="border border-orange-200 px-3 py-2 text-left font-semibold text-[var(--text-primary)]">
                    {inlineFormat(h.trim())}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((row, ri) => (
                <tr key={ri} className={ri % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                  {row.map((cell, ci) => (
                    <td key={ci} className="border border-gray-200 px-3 py-1.5">
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
    // Bold
    const parts = text.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return <strong key={i} className="font-semibold text-[var(--text-primary)]">{part.slice(2, -2)}</strong>;
      }
      // Inline code
      const codeParts = part.split(/(`[^`]+`)/g);
      return codeParts.map((cp, j) => {
        if (cp.startsWith("`") && cp.endsWith("`")) {
          return <code key={`${i}-${j}`} className="bg-orange-50 text-orange-700 px-1 py-0.5 rounded text-xs font-mono">{cp.slice(1, -1)}</code>;
        }
        return cp;
      });
    });
  };

  for (const line of lines) {
    const trimmed = line.trim();

    // Table row
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      flushList();
      const cells = trimmed.split("|").slice(1, -1).map(c => c.trim());
      // Check if separator row
      if (cells.every(c => /^[-:]+$/.test(c))) {
        inTable = true;
        continue;
      }
      if (!inTable && tableHeader.length === 0) {
        tableHeader = cells;
      } else {
        tableRows.push(cells);
      }
      inTable = true;
      continue;
    }

    // End of table
    if (inTable) flushTable();

    // Bullet list
    if (/^[-*]\s/.test(trimmed)) {
      listItems.push(trimmed.replace(/^[-*]\s/, ""));
      inList = true;
      continue;
    }
    if (/^\d+\.\s/.test(trimmed)) {
      listItems.push(trimmed.replace(/^\d+\.\s/, ""));
      inList = true;
      continue;
    }
    if (inList) flushList();

    // Empty line
    if (trimmed === "") {
      elements.push(<div key={key++} className="h-2" />);
      continue;
    }

    // Headers
    if (trimmed.startsWith("### ")) {
      elements.push(<h4 key={key++} className="text-sm font-bold mt-4 mb-1 text-[var(--text-primary)]">{inlineFormat(trimmed.slice(4))}</h4>);
      continue;
    }
    if (trimmed.startsWith("## ")) {
      elements.push(<h3 key={key++} className="text-base font-bold mt-4 mb-1 text-[var(--accent)]">{inlineFormat(trimmed.slice(3))}</h3>);
      continue;
    }
    if (trimmed.startsWith("# ")) {
      elements.push(<h2 key={key++} className="text-lg font-bold mt-4 mb-2 text-[var(--accent)]">{inlineFormat(trimmed.slice(2))}</h2>);
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(trimmed)) {
      elements.push(<hr key={key++} className="my-3 border-gray-200" />);
      continue;
    }

    // Regular paragraph
    elements.push(<p key={key++} className="text-sm leading-relaxed my-1">{inlineFormat(trimmed)}</p>);
  }

  // Flush remaining
  if (inList) flushList();
  if (inTable) flushTable();

  return elements;
}

// ── Component ──
export default function MiloPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const sendMessage = async (text?: string) => {
    const content = (text || input).trim();
    if (!content || loading) return;

    setInput("");
    setError("");
    const userMsg: Message = { role: "user", content };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setLoading(true);
    setStreaming(true);

    // Add placeholder assistant message
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

        // Parse doc metadata from prefix
        if (accumulated.includes("<!--DOCS:") && accumulated.includes("-->")) {
          const match = accumulated.match(/<!--DOCS:(.*?)-->/);
          if (match) {
            try { docs = JSON.parse(match[1]); } catch { /* */ }
            accumulated = accumulated.replace(/<!--DOCS:.*?-->/, "");
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
      // Remove empty assistant message
      setMessages(prev => prev.filter(m => !(m.role === "assistant" && m.content === "")));
    } finally {
      setLoading(false);
      setStreaming(false);
      abortRef.current = null;
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  const clearChat = () => {
    if (abortRef.current) abortRef.current.abort();
    setMessages([]);
    setInput("");
    setError("");
    setLoading(false);
    setStreaming(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const hasMessages = messages.length > 0;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-[var(--border)] bg-white sticky top-0 z-50">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4 sm:gap-5">
            <Image src="/logo.png" alt="Premier Lending" width={180} height={40} className="h-7 sm:h-9 w-auto" priority />
            <div className="w-px h-6 sm:h-8 bg-[var(--border)]" />
            <Link href="/" className="text-xs sm:text-sm font-medium text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors pb-0.5">
              Pipeline
            </Link>
            <Link href="/intelligence" className="flex items-center gap-1 sm:gap-1.5 text-xs sm:text-sm font-medium text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors pb-0.5">
              <BarChart3 className="w-3 sm:w-3.5 h-3 sm:h-3.5" />
              Intelligence
            </Link>
            <Link href="/market" className="text-xs sm:text-sm font-medium text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors pb-0.5">
              Market
            </Link>
            <span className="flex items-center gap-1 sm:gap-1.5 text-xs sm:text-sm font-semibold text-[var(--text)] border-b-2 border-[var(--accent)] pb-0.5">
              <Sparkles className="w-3 sm:w-3.5 h-3 sm:h-3.5 text-[var(--accent)]" />
              Milo AI
            </span>
          </div>
          {hasMessages && (
            <button
              onClick={clearChat}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[var(--text-muted)] hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Clear Chat
            </button>
          )}
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex flex-col max-w-[900px] mx-auto w-full">
        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
          {!hasMessages ? (
            /* ── Welcome Screen ── */
            <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center mb-5 shadow-lg shadow-orange-200">
                <Sparkles className="w-8 h-8 text-white" />
              </div>
              <h1 className="text-2xl font-bold mb-2">Milo</h1>
              <p className="text-sm text-[var(--text-muted)] mb-1 max-w-md">
                Chief Mortgage Underwriter AI
              </p>
              <p className="text-xs text-[var(--text-muted)] mb-8 max-w-lg leading-relaxed">
                Powered by FHA, VA, Fannie Mae, Freddie Mac, and USDA guidelines.
                Ask any underwriting question and get precise, guideline-backed answers.
              </p>

              <div className="flex flex-wrap items-center gap-2 mb-6">
                <span className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-full text-xs font-medium">
                  <BookOpen className="w-3 h-3" /> 25 Guideline Documents
                </span>
                <span className="flex items-center gap-1.5 px-3 py-1.5 bg-green-50 text-green-700 rounded-full text-xs font-medium">
                  <FileText className="w-3 h-3" /> Real-time Citations
                </span>
                <span className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-50 text-purple-700 rounded-full text-xs font-medium">
                  <MessageSquare className="w-3 h-3" /> Scenario Analysis
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-2xl">
                {STARTERS.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => sendMessage(s.q)}
                    className="text-left px-4 py-3 bg-white border border-[var(--border)] rounded-xl hover:border-[var(--accent)] hover:bg-orange-50/50 transition-all group"
                  >
                    <span className="text-xs font-semibold text-[var(--accent)] group-hover:text-[var(--accent-dark)]">
                      {s.label}
                    </span>
                    <p className="text-xs text-[var(--text-muted)] mt-0.5 line-clamp-2">{s.q}</p>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            /* ── Chat Messages ── */
            <div className="space-y-4">
              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] ${msg.role === "user" ? "order-1" : ""}`}>
                    {/* Doc badges */}
                    {msg.role === "assistant" && msg.docs && msg.docs.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-1.5 ml-1">
                        {msg.docs.map((doc, di) => (
                          <span key={di} className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full text-[10px] font-medium">
                            <BookOpen className="w-2.5 h-2.5" />{doc}
                          </span>
                        ))}
                      </div>
                    )}

                    <div className={`rounded-2xl px-4 py-3 ${
                      msg.role === "user"
                        ? "bg-[var(--accent)] text-white rounded-br-md"
                        : "bg-white border border-[var(--border)] rounded-bl-md shadow-sm"
                    }`}>
                      {msg.role === "user" ? (
                        <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                      ) : msg.content ? (
                        <div className="prose-sm">{renderMarkdown(msg.content)}</div>
                      ) : (
                        <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] py-1">
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--accent)]" />
                          Milo is analyzing guidelines...
                        </div>
                      )}
                    </div>

                    {/* Streaming indicator */}
                    {msg.role === "assistant" && streaming && i === messages.length - 1 && msg.content && (
                      <div className="flex items-center gap-1.5 mt-1 ml-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
                        <span className="text-[10px] text-[var(--text-muted)]">Streaming...</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="mx-4 sm:mx-6 mb-2 p-3 bg-red-50 border border-red-200 rounded-xl flex items-center gap-2 text-xs text-red-700">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        {/* Input Area */}
        <div className="sticky bottom-0 bg-gradient-to-t from-[var(--bg-primary)] via-[var(--bg-primary)] to-transparent pt-4 pb-4 px-4 sm:px-6">
          {hasMessages && !loading && (
            <div className="flex gap-1.5 mb-2 overflow-x-auto pb-1 scrollbar-hide">
              {["Compare FHA vs VA", "What about conventional?", "Calculate DTI", "Compensating factors?", "What docs are needed?"].map((q, i) => (
                <button
                  key={i}
                  onClick={() => sendMessage(q)}
                  className="shrink-0 px-3 py-1.5 bg-white border border-[var(--border)] rounded-full text-xs text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          <div className="flex items-end gap-2">
            <div className="flex-1 relative">
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask Milo anything about mortgage guidelines..."
                rows={1}
                disabled={loading}
                className="w-full px-4 py-3 pr-12 bg-white border border-[var(--border)] rounded-2xl text-sm resize-none focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/20 placeholder-[var(--text-muted)] disabled:opacity-50 transition-all"
                style={{ minHeight: "48px", maxHeight: "120px" }}
                onInput={e => {
                  const t = e.target as HTMLTextAreaElement;
                  t.style.height = "auto";
                  t.style.height = Math.min(t.scrollHeight, 120) + "px";
                }}
              />
              <button
                onClick={() => sendMessage()}
                disabled={!input.trim() || loading}
                className="absolute right-2 bottom-2 w-8 h-8 flex items-center justify-center rounded-xl bg-[var(--accent)] text-white disabled:opacity-30 hover:bg-[var(--accent-dark)] transition-colors"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-center gap-1.5 mt-2">
            <ChevronDown className="w-3 h-3 text-[var(--text-muted)]" />
            <span className="text-[10px] text-[var(--text-muted)]">
              Responses grounded in official FHA, VA, Fannie Mae, Freddie Mac & USDA guidelines
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

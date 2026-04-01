"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Send, Loader2, Trash2, Sparkles, BookOpen,
  ChevronDown, AlertCircle, FileText, X, Database,
} from "lucide-react";
import AppHeader from "@/components/AppHeader";
import { getEducationSummary } from "@/lib/education-store";

// ── Types ──
interface Message {
  role: "user" | "assistant";
  content: string;
  docs?: string[];
  phase?: string;
}

// ── Map citation source names to actual PDF filenames ──
const SOURCE_TO_FILE: Record<string, string> = {
  "formulario": "Formulario_Postulacion_Desafios2025.pdf",
  "postulacion": "Formulario_Postulacion_Desafios2025.pdf",
  "desafio": "Formulario_Postulacion_Desafios2025.pdf",
  "convocatoria": "Formulario_Postulacion_Desafios2025.pdf",
  "guia tecnica": "Guia_tecnica_Superintendencia_Educacion.pdf",
  "superintendencia": "Guia_tecnica_Superintendencia_Educacion.pdf",
  "sie": "Guia_tecnica_Superintendencia_Educacion.pdf",
  "fiscalizacion": "Guia_tecnica_Superintendencia_Educacion.pdf",
  "normativa": "Guia_tecnica_Superintendencia_Educacion.pdf",
  "configuracion": "Fase de Configuración Inicial con datos del SIE.pdf",
  "fase inicial": "Fase de Configuración Inicial con datos del SIE.pdf",
  "implementacion": "Fase de Configuración Inicial con datos del SIE.pdf",
  "carta gantt": "Carta Gantt Actualizada.pdf",
  "cronograma": "Carta Gantt Actualizada.pdf",
  "planificacion": "Carta Gantt Actualizada.pdf",
  "gantt": "Carta Gantt Actualizada.pdf",
  "indicador": "Propuesta_Indicadores.pdf",
  "indicadores": "Propuesta_Indicadores.pdf",
  "propuesta": "Propuesta_Indicadores.pdf",
  "metrica": "Propuesta_Indicadores.pdf",
  "anomalia": "Propuesta_Indicadores.pdf",
};

function resolveSourceFile(citation: string): string | null {
  const lower = citation.toLowerCase();
  for (const [key, file] of Object.entries(SOURCE_TO_FILE)) {
    if (lower.includes(key)) return file;
  }
  return null;
}

/** Extract page number and searchable section text from a citation string */
function parseCitationLocation(citation: string): { page?: number; search?: string } {
  const pageMatch =
    citation.match(/\bp\.?\s*(\d+)/i) ||
    citation.match(/\bpagina\s+(\d+)/i) ||
    citation.match(/\bpag\.?\s*(\d+)/i) ||
    citation.match(/\bpage\s+(\d+)/i);
  const page = pageMatch ? parseInt(pageMatch[1]) : undefined;

  const sectionMatch = citation.match(/Seccion\s+([\w.\-()\/]+(?:\s*[\w.\-()\/]+)*)/i) ||
    citation.match(/Section\s+([\w.\-()\/]+(?:\s*[\w.\-()\/]+)*)/i);
  const chapterMatch = !sectionMatch ? citation.match(/Capitulo\s+(\d+)/i) : null;

  const search = sectionMatch
    ? sectionMatch[1].replace(/[,\s]+$/, "").trim()
    : chapterMatch
      ? `Capitulo ${chapterMatch[1]}`
      : undefined;

  return { page, search };
}

/** Build PDF URL with page jump and search highlighting */
function buildPdfUrl(file: string, citation: string): string {
  const base = `/api/milo/docs?file=${encodeURIComponent(file)}`;
  const loc = parseCitationLocation(citation);
  const parts: string[] = ["toolbar=1"];
  if (loc.page) parts.push(`page=${loc.page}`);
  if (loc.search) parts.push(`search=${encodeURIComponent(loc.search)}`);
  if (!loc.page) parts.push("view=FitH");
  return `${base}#${parts.join("&")}`;
}

// ── Suggested starter questions ──
const STARTERS = [
  { label: "Gastos por region", q: "Cual es la distribucion de gastos educativos por region? Que regiones concentran mayor gasto?" },
  { label: "Indicadores SIE", q: "Explicame los 13 indicadores clave que evalua la Superintendencia de Educacion para fiscalizar sostenedores." },
  { label: "Anomalias de gasto", q: "Como puedo detectar anomalias en los gastos declarados por un sostenedor? Que patrones son sospechosos?" },
  { label: "Tipos de dependencia", q: "Compara los tipos de dependencia educativa: Municipal, Corporacion Municipal, SLEP y Particular Subvencionado. Cuales tienen mayor riesgo financiero?" },
  { label: "Remuneraciones", q: "Como analizar las remuneraciones de un sostenedor? Que proporcion del gasto total deberian representar?" },
  { label: "Documentos de compra", q: "Que tipos de documentos de compra deben presentar los sostenedores? Como detectar irregularidades en boletas y facturas?" },
  { label: "Riesgo financiero", q: "Como se evalua el riesgo financiero de un sostenedor? Que indicadores son mas criticos para la Superintendencia?" },
  { label: "Subvenciones", q: "Explicame los distintos tipos de subvenciones educativas y como se fiscaliza su uso correcto." },
];

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
              <tr className="bg-blue-50">
                {headers.map((h, i) => (
                  <th key={i} className="border border-blue-200 px-3 py-2 text-left font-semibold text-[var(--text-primary)]">
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
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 mx-0.5 bg-blue-100 text-blue-700 rounded text-[10px] font-medium hover:bg-blue-200 transition-colors cursor-pointer border border-blue-200"
              title={`Ver fuente: ${citation}`}
            >
              <BookOpen className="w-2.5 h-2.5" />
              {citation.length > 50 ? citation.slice(0, 47) + "..." : citation}
            </button>
          );
        }
        return (
          <span key={`cite-${si}`} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 mx-0.5 bg-gray-100 text-gray-600 rounded text-[10px] font-medium border border-gray-200">
            <FileText className="w-2.5 h-2.5" />
            {citation.length > 50 ? citation.slice(0, 47) + "..." : citation}
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
            return <code key={`${si}-${i}-${j}`} className="bg-blue-50 text-blue-700 px-1 py-0.5 rounded text-xs font-mono">{cp.slice(1, -1)}</code>;
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

    if (inTable) flushTable();

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

    if (trimmed === "") {
      elements.push(<div key={key++} className="h-2" />);
      continue;
    }

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

    if (/^---+$/.test(trimmed)) {
      elements.push(<hr key={key++} className="my-3 border-gray-200" />);
      continue;
    }

    elements.push(<p key={key++} className="text-sm leading-relaxed my-1">{inlineFormat(trimmed)}</p>);
  }

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
  const [phase, setPhase] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // PDF side panel state
  const [pdfPanel, setPdfPanel] = useState<{ file: string; citation: string } | null>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  useEffect(() => { inputRef.current?.focus(); }, []);

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
          educationContext: getEducationSummary(),
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error || err.detail || `Error en la solicitud (${res.status})`);
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

        // Parse phase indicator
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
      setError((err as Error).message || "Error al obtener respuesta");
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
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const hasMessages = messages.length > 0;

  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader
        activeTab="milo"
        rightContent={hasMessages ? (
          <button
            onClick={clearChat}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[var(--text-muted)] hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Limpiar Chat
          </button>
        ) : undefined}
      />

      {/* Main Content - adjusts width when PDF panel is open */}
      <div className={`flex-1 flex flex-col mx-auto w-full transition-all duration-300 ${pdfPanel ? "max-w-[50%]" : "max-w-[900px]"}`}>
        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
          {!hasMessages ? (
            /* ── Welcome Screen ── */
            <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center mb-5 shadow-lg shadow-blue-200">
                <Sparkles className="w-8 h-8 text-white" />
              </div>
              <h1 className="text-2xl font-bold mb-2">EduBot</h1>
              <p className="text-sm text-[var(--text-muted)] mb-1 max-w-md">
                Asistente de Inteligencia Educativa
              </p>
              <p className="text-xs text-[var(--text-muted)] mb-8 max-w-lg leading-relaxed">
                Experto en analisis de gastos educativos, fiscalizacion financiera
                y normativa de la Superintendencia de Educacion de Chile.
              </p>

              <div className="flex flex-wrap items-center gap-2 mb-6">
                <span className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-full text-xs font-medium">
                  <BookOpen className="w-3 h-3" /> 5 Documentos de Referencia
                </span>
                <span className="flex items-center gap-1.5 px-3 py-1.5 bg-green-50 text-green-700 rounded-full text-xs font-medium">
                  <FileText className="w-3 h-3" /> Citaciones Interactivas
                </span>
                {getEducationSummary() && (
                  <span className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-full text-xs font-medium">
                    <Database className="w-3 h-3" /> Datos Educativos Conectados
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-2xl">
                {STARTERS.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => sendMessage(s.q)}
                    className="text-left px-4 py-3 bg-white border border-[var(--border)] rounded-xl hover:border-[var(--accent)] hover:bg-blue-50/50 transition-all group"
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
                        <div className="prose-sm">{renderMarkdown(msg.content, openPdfPanel)}</div>
                      ) : (
                        <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] py-1">
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--accent)]" />
                          {phase === "synthesizing"
                            ? "EduBot esta sintetizando informacion de multiples documentos..."
                            : "EduBot esta analizando los datos educativos..."}
                        </div>
                      )}
                    </div>

                    {/* Streaming indicator */}
                    {msg.role === "assistant" && streaming && i === messages.length - 1 && msg.content && (
                      <div className="flex items-center gap-1.5 mt-1 ml-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
                        <span className="text-[10px] text-[var(--text-muted)]">Transmitiendo...</span>
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
              {["Comparar por dependencia", "Alertas de riesgo?", "Desglose por cuenta", "Tendencia historica", "Que documentos faltan?"].map((q, i) => (
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
                placeholder="Preguntale a EduBot sobre gastos educativos, indicadores, sostenedores..."
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
              Respuestas basadas en documentos oficiales de la Superintendencia de Educacion
            </span>
          </div>
        </div>
      </div>

      {/* ── PDF Side Panel ── */}
      {pdfPanel && (
        <div className="fixed top-0 right-0 h-full w-1/2 z-[100] flex flex-col bg-white border-l border-gray-200 shadow-2xl animate-in slide-in-from-right duration-300">
          {/* Panel Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
            <div className="flex items-center gap-2 min-w-0">
              <FileText className="w-4 h-4 text-[var(--accent)] shrink-0" />
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-[var(--text)] truncate">{pdfPanel.file}</h3>
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

          {/* PDF viewer - jumps to page & highlights section */}
          <div className="flex-1 relative">
            {(() => {
              const pdfUrl = buildPdfUrl(pdfPanel.file, pdfPanel.citation);
              const loc = parseCitationLocation(pdfPanel.citation);
              return (
                <>
                  {(loc.page || loc.search) && (
                    <div className="px-4 py-1.5 bg-amber-50 border-b border-amber-200 text-[10px] text-amber-700 flex items-center gap-2">
                      {loc.page && <span>Navegando a pagina {loc.page}</span>}
                      {loc.page && loc.search && <span>&middot;</span>}
                      {loc.search && <span>Buscando &quot;{loc.search}&quot;</span>}
                    </div>
                  )}
                  <object
                    data={pdfUrl}
                    type="application/pdf"
                    className="w-full h-full"
                    title={`PDF: ${pdfPanel.file}`}
                  >
                    <iframe
                      src={pdfUrl}
                      className="w-full h-full border-0"
                      title={`PDF: ${pdfPanel.file}`}
                    />
                  </object>
                </>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}

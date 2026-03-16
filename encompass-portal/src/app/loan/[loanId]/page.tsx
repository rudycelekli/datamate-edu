"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  ArrowLeft,
  FileText,
  DollarSign,
  User,
  MapPin,
  Calendar,
  Shield,
  Loader2,
  AlertCircle,
  Download,
  CheckCircle2,
  Clock,
  Building2,
  Landmark,
  Hash,
  Percent,
  RefreshCw,
  Eye,
  Paperclip,
  Search,
  X,
  File,
  Image as ImageIcon,
  FolderOpen,
  ChevronDown,
  ChevronRight,
  Sparkles,
} from "lucide-react";
import { FIELD_LABEL_MAP } from "@/lib/field-definitions";
import LoanCopilot from "@/components/LoanCopilot";

interface LoanData {
  [key: string]: unknown;
}

interface FieldData {
  fieldId: string;
  value: string;
}

interface AttachmentDetail {
  id: string;
  name: string;
  fileSize: number;
  createdDate?: string;
  type?: string;
  pageCount: number;
  isActive: boolean;
  downloadUrl: string;
}

interface DocItem {
  id: string;
  title: string;
  description: string;
  status: string;
  createdDate?: string;
  updatedDate?: string;
  lastAttachmentDate?: string;
  isProtected: boolean;
  borrower: string;
  milestone: string;
  groups: string[];
  createdBy: string;
  attachmentCount: number;
  attachments: AttachmentDetail[];
}

interface StandaloneAttachment {
  id: string;
  title: string;
  type?: string;
  fileSize: number;
  pageCount: number;
  createdDate?: string;
  createdBy: string;
  assignedTo: string;
  downloadUrl: string;
}

interface DocsResponse {
  documents: DocItem[];
  standaloneAttachments: StandaloneAttachment[];
  summary: {
    totalDocuments: number;
    docsWithAttachments: number;
    totalAttachments: number;
    standaloneAttachments: number;
  };
}

interface MilestoneItem {
  milestoneName?: string;
  id?: string;
  startDate?: string;
  doneIndicator?: boolean;
  expectedDays?: number;
  reviewedIndicator?: boolean;
  loanAssociate?: {
    name?: string;
    roleName?: string;
    email?: string;
  };
}

type Tab = "overview" | "fields" | "documents" | "milestones" | "raw";

const formatCurrency = (val: unknown) => {
  if (!val) return "--";
  const num = typeof val === "string" ? parseFloat(val) : (val as number);
  if (isNaN(num)) return String(val);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(num);
};

const formatDate = (val: unknown) => {
  if (!val) return "--";
  try {
    return new Date(String(val)).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return String(val);
  }
};

const formatFileSize = (bytes: number) => {
  if (!bytes) return "--";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const getFileIcon = (name: string, type?: string) => {
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext === "pdf" || type?.includes("pdf")) return File;
  if (["jpg", "jpeg", "png", "gif", "bmp", "tiff"].includes(ext || ""))
    return ImageIcon;
  return FileText;
};

function InfoCard({
  icon: Icon,
  label,
  value,
  color = "text-[var(--accent)]",
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="glass-card p-4">
      <div className="flex items-center gap-2 mb-1">
        <Icon className={`w-4 h-4 ${color}`} />
        <span className="text-xs text-[var(--text-muted)]">{label}</span>
      </div>
      <div className="text-sm font-semibold truncate" title={value}>
        {value || "--"}
      </div>
    </div>
  );
}

/* ── Documents Tab Component ── */
function DocumentsTab({
  loanId,
  docs,
}: {
  loanId: string;
  docs: DocsResponse;
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedDocs, setExpandedDocs] = useState<Set<string>>(new Set());
  const [previewPages, setPreviewPages] = useState<string[]>([]);
  const [previewPdfUrl, setPreviewPdfUrl] = useState<string | null>(null);
  const [previewTitle, setPreviewTitle] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const toggleDoc = (id: string) => {
    setExpandedDocs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openPreview = async (attachmentId: string, title: string) => {
    setPreviewTitle(title);
    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreviewPages([]);
    setPreviewPdfUrl(null);
    try {
      const res = await fetch(
        `/api/loans/${loanId}/attachments/${encodeURIComponent(attachmentId)}/urls`,
      );
      if (!res.ok) throw new Error("Failed to load preview");
      const data = await res.json();
      // If we have an original PDF URL, use that for iframe preview
      const origUrls = data.originalUrls as string[] | null;
      if (origUrls?.length && origUrls[0].includes(".pdf")) {
        setPreviewPdfUrl(origUrls[0]);
      } else {
        setPreviewPages(data.pages || []);
      }
    } catch (err) {
      console.error("Preview failed:", err);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleDownload = async (attachmentId: string, fileName: string) => {
    setDownloadingId(attachmentId);
    try {
      const res = await fetch(
        `/api/loans/${loanId}/attachments/${encodeURIComponent(attachmentId)}`,
      );
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      // Use original filename, ensure it has an extension
      const ext = blob.type.includes("pdf")
        ? "pdf"
        : blob.type.includes("png")
          ? "png"
          : "bin";
      a.download = fileName.includes(".") ? fileName : `${fileName}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Download failed:", err);
    } finally {
      setDownloadingId(null);
    }
  };

  const filteredDocs = docs.documents.filter((doc) => {
    const matchesSearch =
      !searchTerm ||
      doc.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      doc.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
      doc.borrower.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus =
      statusFilter === "all" || doc.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const statuses = [
    ...new Set(docs.documents.map((d) => d.status).filter(Boolean)),
  ];

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="glass-card p-4">
          <div className="flex items-center gap-2 mb-1">
            <FolderOpen className="w-4 h-4 text-[var(--accent)]" />
            <span className="text-xs text-[var(--text-muted)]">Documents</span>
          </div>
          <div className="text-xl font-bold">{docs.summary.totalDocuments}</div>
        </div>
        <div className="glass-card p-4">
          <div className="flex items-center gap-2 mb-1">
            <Paperclip className="w-4 h-4 text-[var(--accent)]" />
            <span className="text-xs text-[var(--text-muted)]">
              With Files
            </span>
          </div>
          <div className="text-xl font-bold">
            {docs.summary.docsWithAttachments}
          </div>
        </div>
        <div className="glass-card p-4">
          <div className="flex items-center gap-2 mb-1">
            <File className="w-4 h-4 text-[var(--accent)]" />
            <span className="text-xs text-[var(--text-muted)]">
              Total Files
            </span>
          </div>
          <div className="text-xl font-bold">
            {docs.summary.totalAttachments}
          </div>
        </div>
        <div className="glass-card p-4">
          <div className="flex items-center gap-2 mb-1">
            <FileText className="w-4 h-4 text-[var(--text-muted)]" />
            <span className="text-xs text-[var(--text-muted)]">Unassigned</span>
          </div>
          <div className="text-xl font-bold">
            {docs.summary.standaloneAttachments}
          </div>
        </div>
      </div>

      {/* Search & Filter Bar */}
      <div className="flex items-center gap-3">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search documents..."
            className="w-full pl-10 pr-4 py-2 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg text-sm placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm("")}
              className="absolute right-3 top-1/2 -translate-y-1/2"
            >
              <X className="w-3.5 h-3.5 text-[var(--text-muted)]" />
            </button>
          )}
        </div>
        {statuses.length > 0 && (
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--accent)]"
          >
            <option value="all">All Statuses</option>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Document List */}
      <div className="glass-card overflow-hidden">
        <div className="overflow-auto max-h-[calc(100vh-420px)]">
          {filteredDocs.length === 0 ? (
            <div className="p-8 text-center text-[var(--text-muted)] text-sm">
              {searchTerm
                ? "No documents match your search"
                : "No documents available"}
            </div>
          ) : (
            <div className="divide-y divide-[var(--border)]">
              {filteredDocs.map((doc) => {
                const isExpanded = expandedDocs.has(doc.id);
                return (
                  <div key={doc.id}>
                    {/* Document Row */}
                    <button
                      onClick={() => toggleDoc(doc.id)}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[var(--bg-secondary)] transition-colors text-left"
                    >
                      <div className="flex-shrink-0">
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4 text-[var(--text-muted)]" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-[var(--text-muted)]" />
                        )}
                      </div>
                      <FolderOpen
                        className={`w-4 h-4 flex-shrink-0 ${doc.attachmentCount > 0 ? "text-[var(--accent)]" : "text-[var(--text-muted)]"}`}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm truncate">
                            {doc.title}
                          </span>
                          {doc.attachmentCount > 0 && (
                            <span className="flex-shrink-0 text-xs bg-orange-50 text-[var(--accent)] px-2 py-0.5 rounded-full border border-orange-200">
                              {doc.attachmentCount} file
                              {doc.attachmentCount !== 1 ? "s" : ""}
                            </span>
                          )}
                          {doc.isProtected && (
                            <Shield className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                          )}
                        </div>
                        {doc.description && (
                          <p className="text-xs text-[var(--text-muted)] truncate mt-0.5">
                            {doc.description}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-4 flex-shrink-0">
                        {doc.status && (
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full ${
                              doc.status === "Added" ||
                              doc.status === "Received"
                                ? "bg-emerald-50 text-emerald-700"
                                : doc.status === "Expected"
                                  ? "bg-amber-50 text-amber-700"
                                  : "bg-gray-100 text-gray-600"
                            }`}
                          >
                            {doc.status}
                          </span>
                        )}
                        {doc.updatedDate && (
                          <span className="text-xs text-[var(--text-muted)] hidden md:block">
                            {formatDate(doc.updatedDate)}
                          </span>
                        )}
                      </div>
                    </button>

                    {/* Expanded Attachments */}
                    {isExpanded && doc.attachments.length > 0 && (
                      <div className="bg-[var(--bg-secondary)] border-t border-[var(--border)]">
                        {doc.attachments.map((att) => {
                          const FileIcon = getFileIcon(att.name, att.type);
                          return (
                            <div
                              key={att.id}
                              className="flex items-center gap-3 px-4 py-2.5 pl-12 hover:bg-white/50 transition-colors border-b border-[var(--border)] last:border-b-0"
                            >
                              <FileIcon className="w-4 h-4 text-[var(--accent)] flex-shrink-0" />
                              <div className="flex-1 min-w-0">
                                <div className="text-sm truncate">
                                  {att.name}
                                </div>
                                <div className="flex items-center gap-3 text-xs text-[var(--text-muted)]">
                                  <span>{formatFileSize(att.fileSize)}</span>
                                  {att.pageCount > 0 && (
                                    <span>
                                      {att.pageCount} page
                                      {att.pageCount !== 1 ? "s" : ""}
                                    </span>
                                  )}
                                  {att.createdDate && (
                                    <span>{formatDate(att.createdDate)}</span>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-1 flex-shrink-0">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openPreview(att.id, att.name);
                                  }}
                                  className="p-1.5 rounded-md hover:bg-orange-50 text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors"
                                  title="Preview"
                                >
                                  <Eye className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDownload(att.id, att.name);
                                  }}
                                  disabled={downloadingId === att.id}
                                  className="p-1.5 rounded-md hover:bg-orange-50 text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors disabled:opacity-50"
                                  title="Download"
                                >
                                  {downloadingId === att.id ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                  ) : (
                                    <Download className="w-4 h-4" />
                                  )}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {isExpanded && doc.attachments.length === 0 && (
                      <div className="bg-[var(--bg-secondary)] border-t border-[var(--border)] px-4 py-3 pl-12 text-xs text-[var(--text-muted)]">
                        No files attached to this document
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Standalone Attachments */}
      {docs.standaloneAttachments.length > 0 && (
        <div className="glass-card overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--border)]">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Paperclip className="w-4 h-4 text-[var(--text-muted)]" />
              Unassigned Files ({docs.standaloneAttachments.length})
            </h3>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {docs.standaloneAttachments.map((att) => {
              const FileIcon = getFileIcon(att.title, att.type);
              return (
                <div
                  key={att.id}
                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--bg-secondary)] transition-colors"
                >
                  <FileIcon className="w-4 h-4 text-[var(--text-muted)] flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">{att.title}</div>
                    <div className="flex items-center gap-3 text-xs text-[var(--text-muted)]">
                      <span>{formatFileSize(att.fileSize)}</span>
                      {att.pageCount > 0 && (
                        <span>
                          {att.pageCount} page
                          {att.pageCount !== 1 ? "s" : ""}
                        </span>
                      )}
                      {att.createdBy && <span>by {att.createdBy}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => openPreview(att.id, att.title)}
                      className="p-1.5 rounded-md hover:bg-orange-50 text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors"
                      title="Preview"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDownload(att.id, att.title)}
                      disabled={downloadingId === att.id}
                      className="p-1.5 rounded-md hover:bg-orange-50 text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors disabled:opacity-50"
                      title="Download"
                    >
                      {downloadingId === att.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Download className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {previewOpen && (
        <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-6">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border)]">
              <div className="flex items-center gap-2 min-w-0">
                <File className="w-4 h-4 text-[var(--accent)] flex-shrink-0" />
                <span className="text-sm font-medium truncate">
                  {previewTitle}
                </span>
                {previewPages.length > 0 && (
                  <span className="text-xs text-[var(--text-muted)]">
                    ({previewPages.length} page
                    {previewPages.length !== 1 ? "s" : ""})
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => {
                    setPreviewOpen(false);
                    setPreviewPages([]);
                    setPreviewPdfUrl(null);
                  }}
                  className="p-1.5 rounded-lg hover:bg-[var(--bg-secondary)]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="flex-1 bg-[var(--bg-secondary)] overflow-auto">
              {previewLoading ? (
                <div className="flex items-center justify-center h-full">
                  <Loader2 className="w-8 h-8 animate-spin text-[var(--accent)]" />
                </div>
              ) : previewPdfUrl ? (
                <iframe
                  src={previewPdfUrl}
                  className="w-full h-full border-0"
                  title={previewTitle}
                />
              ) : previewPages.length === 0 ? (
                <div className="flex items-center justify-center h-full text-[var(--text-muted)] text-sm">
                  No preview available
                </div>
              ) : (
                <div className="space-y-4 max-w-4xl mx-auto p-4">
                  {previewPages.map((url, i) => (
                    <div
                      key={i}
                      className="bg-white rounded-lg shadow-sm border border-[var(--border)] overflow-hidden"
                    >
                      {previewPages.length > 1 && (
                        <div className="px-3 py-1.5 bg-gray-50 border-b border-[var(--border)] text-xs text-[var(--text-muted)]">
                          Page {i + 1} of {previewPages.length}
                        </div>
                      )}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={url}
                        alt={`Page ${i + 1}`}
                        className="w-full h-auto"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function LoanDetailPage({
  params,
}: {
  params: Promise<{ loanId: string }>;
}) {
  const { loanId } = use(params);
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("overview");
  const [loan, setLoan] = useState<LoanData | null>(null);
  const [fields, setFields] = useState<FieldData[]>([]);
  const [docs, setDocs] = useState<DocsResponse>({
    documents: [],
    standaloneAttachments: [],
    summary: {
      totalDocuments: 0,
      docsWithAttachments: 0,
      totalAttachments: 0,
      standaloneAttachments: 0,
    },
  });
  const [milestones, setMilestones] = useState<MilestoneItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copilotOpen, setCopilotOpen] = useState(false);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [loanRes, fieldsRes, docsRes, msRes] = await Promise.all([
          fetch(`/api/loans/${loanId}`),
          fetch(`/api/loans/${loanId}/fields`),
          fetch(`/api/loans/${loanId}/documents`),
          fetch(`/api/loans/${loanId}/milestones`).catch(() => null),
        ]);

        if (!loanRes.ok) throw new Error(await loanRes.text());
        setLoan(await loanRes.json());

        if (fieldsRes.ok) {
          const fd = await fieldsRes.json();
          setFields(Array.isArray(fd) ? fd : []);
        }

        if (docsRes.ok) {
          setDocs(await docsRes.json());
        }

        if (msRes && msRes.ok) {
          const msData = await msRes.json();
          setMilestones(Array.isArray(msData) ? msData : []);
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load loan");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [loanId]);

  const getField = (id: string) => {
    const f = fields.find((x) => x.fieldId === id);
    return f?.value || "";
  };

  // Build non-PII loan context for Milo AI copilot
  const buildLoanCtx = (): string => {
    if (!loan) return "";
    const l = loan as Record<string, unknown>;
    const prop = (loan.applications as { property?: Record<string, unknown> }[])?.[0]?.property;
    const borr = (loan.applications as { borrower?: Record<string, unknown> }[])?.[0]?.borrower;
    const lines: string[] = ["## Current Loan Details", ""];
    lines.push(`Loan Number: ${l.loanNumber || "N/A"}`);
    lines.push(`Loan Amount: $${Number(l.baseLoanAmount || 0).toLocaleString()}`);
    lines.push(`Note Rate: ${l.requestedInterestRatePercent ? `${Number(l.requestedInterestRatePercent).toFixed(3)}%` : "N/A"}`);
    lines.push(`Loan Program: ${getField("1401") || String(l.loanProgramName || "N/A")}`);
    lines.push(`Loan Purpose: ${getField("19") || String(l.loanPurposeType || "N/A")}`);
    lines.push(`Lien Position: ${getField("420") || "N/A"}`);
    lines.push(`LTV: ${getField("353") ? `${getField("353")}%` : "N/A"}`);
    lines.push(`File Status: ${getField("CX.FILE.STATUS") || String(l.loanFolder || "N/A")}`);
    lines.push(`Credit Score: ${borr?.middleCreditScore || borr?.middleFicoScore || getField("VASUMM.X23") || "N/A"}`);
    lines.push("", "Property:");
    lines.push(`  Address: ${prop?.streetAddress || getField("11") || "N/A"}`);
    lines.push(`  City: ${prop?.city || getField("12") || "N/A"}`);
    lines.push(`  State: ${prop?.state || getField("14") || "N/A"}`);
    lines.push(`  Zip: ${prop?.postalCode || getField("15") || "N/A"}`);
    lines.push(`  County: ${prop?.county || getField("13") || "N/A"}`);
    lines.push(`  Occupancy: ${getField("1811") || "N/A"}`);
    lines.push("", "Loan Team:");
    lines.push(`  Loan Officer: ${getField("317") || "N/A"}`);
    lines.push(`  Processor: ${getField("362") || "N/A"}`);
    lines.push(`  Channel: ${getField("2626") || "N/A"}`);
    lines.push("", "Key Dates:");
    const dateFields = [
      ["Application", getField("3142") || getField("745")],
      ["Closing", getField("748")],
      ["Lock Date", getField("761")],
      ["Lock Expiration", getField("762")],
      ["CD Sent", getField("3977")],
      ["COE", getField("CX.BSCLOSEBYDATE")],
    ];
    dateFields.forEach(([label, val]) => { if (val) lines.push(`  ${label}: ${val}`); });
    lines.push("", "Pricing:");
    const pricingFields = [
      ["Note Rate", getField("3")],
      ["Buy Price", getField("2218")],
      ["Corp Margin", getField("CX.CORPORATE.MARGIN")],
      ["Branch Margin", getField("CX.BRANCH.MARGIN")],
      ["LO Margin", getField("CX.LO.MARGIN")],
    ];
    pricingFields.forEach(([label, val]) => { if (val) lines.push(`  ${label}: ${val}`); });
    if (milestones.length > 0) {
      lines.push("", "Milestones:");
      milestones.forEach(ms => {
        lines.push(`  ${ms.milestoneName || "Unknown"}: ${ms.doneIndicator ? "Complete" : "Pending"}`);
      });
    }
    lines.push("", `Documents: ${docs.summary.totalDocuments} total, ${docs.summary.docsWithAttachments} with files, ${docs.summary.totalAttachments} attachments`);
    return lines.join("\n");
  };

  const borrowerName = loan
    ? [
        (
          loan.applications as {
            borrower?: { firstName?: string; lastName?: string };
          }[]
        )?.[0]?.borrower?.firstName,
        (
          loan.applications as {
            borrower?: { firstName?: string; lastName?: string };
          }[]
        )?.[0]?.borrower?.lastName,
      ]
        .filter(Boolean)
        .join(" ") || "Borrower"
    : "Loading...";

  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: "overview", label: "Overview", icon: Building2 },
    { id: "fields", label: "Mapped Fields", icon: Hash },
    { id: "documents", label: "Documents", icon: FileText },
    { id: "milestones", label: "Milestones", icon: CheckCircle2 },
    { id: "raw", label: "Raw Data", icon: FileText },
  ];

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[var(--accent)]" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="glass-card p-8 max-w-md text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-lg font-semibold mb-2">Error Loading Loan</h2>
          <p className="text-sm text-[var(--text-muted)] mb-4">{error}</p>
          <button
            onClick={() => router.back()}
            className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg text-sm hover:bg-[var(--accent-dark)]"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  const property = (
    loan?.applications as { property?: Record<string, unknown> }[]
  )?.[0]?.property;
  const borrower = (
    loan?.applications as { borrower?: Record<string, unknown> }[]
  )?.[0]?.borrower;

  return (
    <>
      <LoanCopilot isOpen={copilotOpen} onClose={() => setCopilotOpen(false)} loanContext={buildLoanCtx()} />
      <div className={`min-h-screen transition-all duration-300 ${copilotOpen ? "ml-[420px]" : ""}`}>
      {/* Header */}
      <header className="border-b border-[var(--border)] bg-white sticky top-0 z-50">
        <div className="max-w-[1600px] mx-auto px-6 py-3">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-4">
              <button
                onClick={() => router.push("/")}
                className="flex items-center gap-1 text-sm text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                Pipeline
              </button>
              <div className="w-px h-6 bg-[var(--border)]" />
              <Image
                src="/logo.png"
                alt="Premier Lending"
                width={140}
                height={32}
                className="h-7 w-auto"
              />
              <div className="w-px h-6 bg-[var(--border)]" />
              <div>
                <h1 className="text-lg font-bold">{borrowerName}</h1>
                <div className="flex items-center gap-3 text-xs text-[var(--text-muted)]">
                  <span className="font-mono">
                    Loan #
                    {((loan as Record<string, unknown>)?.loanNumber as string) ||
                      loanId.slice(0, 8)}
                  </span>
                  <span>|</span>
                  <span>
                    {getField("CX.FILE.STATUS") ||
                      ((loan as Record<string, unknown>)?.loanFolder as string) ||
                      "--"}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCopilotOpen(!copilotOpen)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  copilotOpen
                    ? "bg-orange-100 text-[var(--accent)] border border-orange-200"
                    : "bg-white text-[var(--text-muted)] border border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Milo AI</span>
              </button>
              <button
                onClick={() => window.location.reload()}
                className="flex items-center gap-2 px-3 py-1.5 bg-[var(--accent)] text-white rounded-lg text-xs hover:bg-[var(--accent-dark)]"
              >
                <RefreshCw className="w-3 h-3" /> Refresh
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-colors ${
                  tab === t.id ? "tab-active" : "tab-inactive"
                }`}
              >
                <t.icon className="w-3.5 h-3.5" />
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-6 py-6">
        {/* Overview Tab */}
        {tab === "overview" && loan && (
          <div className="space-y-6">
            {/* Key Metrics */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
              <InfoCard
                icon={DollarSign}
                label="Loan Amount"
                value={formatCurrency(
                  (loan as Record<string, unknown>).baseLoanAmount,
                )}
                color="text-emerald-600"
              />
              <InfoCard
                icon={Percent}
                label="Note Rate"
                value={
                  (loan as Record<string, unknown>).requestedInterestRatePercent
                    ? `${Number((loan as Record<string, unknown>).requestedInterestRatePercent).toFixed(3)}%`
                    : "--"
                }
                color="text-[var(--accent)]"
              />
              <InfoCard
                icon={Landmark}
                label="Loan Program"
                value={
                  getField("1401") ||
                  String(
                    (loan as Record<string, unknown>).loanProgramName || "--",
                  )
                }
                color="text-[var(--accent)]"
              />
              <InfoCard
                icon={Shield}
                label="Credit Score"
                value={
                  String(
                    borrower?.middleCreditScore ||
                    borrower?.middleFicoScore ||
                    getField("VASUMM.X23") ||
                    "--",
                  )
                }
                color="text-blue-600"
              />
              <InfoCard
                icon={Shield}
                label="Lien Position"
                value={getField("420") || "--"}
                color="text-amber-600"
              />
              <InfoCard
                icon={Calendar}
                label="Lock Expiration"
                value={formatDate(getField("762"))}
                color="text-[var(--accent)]"
              />
              <InfoCard
                icon={Clock}
                label="File Status"
                value={getField("CX.FILE.STATUS") || "--"}
                color="text-rose-600"
              />
            </div>

            {/* Borrower & Property */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="glass-card p-5">
                <h3 className="flex items-center gap-2 text-sm font-semibold mb-4">
                  <User className="w-4 h-4 text-[var(--accent)]" />
                  Borrower Information
                </h3>
                <div className="grid grid-cols-2 gap-y-3 text-sm">
                  {[
                    ["Name", borrowerName],
                    [
                      "Email",
                      String(borrower?.emailAddressText || "--"),
                    ],
                    [
                      "Phone",
                      String(borrower?.homePhoneNumber || "--"),
                    ],
                    [
                      "SSN",
                      borrower?.taxIdentificationIdentifier
                        ? "***-**-" +
                          String(
                            borrower.taxIdentificationIdentifier,
                          ).slice(-4)
                        : "--",
                    ],
                    ["DOB", formatDate(borrower?.birthDate)],
                    [
                      "Credit Score",
                      String(
                        borrower?.middleCreditScore ||
                        borrower?.middleFicoScore ||
                        "--",
                      ),
                    ],
                    [
                      "Marital Status",
                      String(borrower?.maritalStatusType || "--"),
                    ],
                  ].map(([label, val]) => (
                    <div key={label}>
                      <div className="text-xs text-[var(--text-muted)]">
                        {label}
                      </div>
                      <div className="font-medium">{val}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="glass-card p-5">
                <h3 className="flex items-center gap-2 text-sm font-semibold mb-4">
                  <MapPin className="w-4 h-4 text-emerald-600" />
                  Subject Property
                </h3>
                <div className="grid grid-cols-2 gap-y-3 text-sm">
                  {[
                    [
                      "Address",
                      String(
                        property?.streetAddress || getField("11") || "--",
                      ),
                    ],
                    [
                      "City",
                      String(property?.city || getField("12") || "--"),
                    ],
                    [
                      "State",
                      String(property?.state || getField("14") || "--"),
                    ],
                    [
                      "Zip",
                      String(property?.postalCode || getField("15") || "--"),
                    ],
                    [
                      "County",
                      String(property?.county || getField("13") || "--"),
                    ],
                    ["Occupancy", getField("1811") || "--"],
                    [
                      "Purpose",
                      getField("19") ||
                        String(
                          (loan as Record<string, unknown>).loanPurposeType ||
                            "--",
                        ),
                    ],
                    [
                      "LTV",
                      getField("353") ? `${getField("353")}%` : "--",
                    ],
                  ].map(([label, val]) => (
                    <div key={label}>
                      <div className="text-xs text-[var(--text-muted)]">
                        {label}
                      </div>
                      <div className="font-medium">{val}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Team & Dates */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="glass-card p-5">
                <h3 className="flex items-center gap-2 text-sm font-semibold mb-4">
                  <User className="w-4 h-4 text-[var(--accent)]" />
                  Loan Team
                </h3>
                <div className="space-y-2 text-sm">
                  {[
                    ["Loan Officer", getField("317")],
                    ["Processor", getField("362")],
                    ["Onboarding LO", getField("CX.ONBOARDING.LO")],
                    ["Channel", getField("2626")],
                    ["Lead Source", getField("CX.LEAD.SOURCE")],
                  ].map(([label, val]) => (
                    <div
                      key={label}
                      className="flex justify-between py-1.5 border-b border-[var(--border)]"
                    >
                      <span className="text-[var(--text-muted)]">{label}</span>
                      <span className="font-medium">{val || "--"}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="glass-card p-5">
                <h3 className="flex items-center gap-2 text-sm font-semibold mb-4">
                  <Calendar className="w-4 h-4 text-[var(--accent)]" />
                  Key Dates
                </h3>
                <div className="space-y-2 text-sm">
                  {[
                    ["Application Date", formatDate(getField("3142") || getField("745"))],
                    ["Closing Date", formatDate(getField("748"))],
                    [
                      "COE Date",
                      formatDate(getField("CX.BSCLOSEBYDATE")),
                    ],
                    ["Lock Date", formatDate(getField("761"))],
                    ["Lock Expiration", formatDate(getField("762"))],
                    ["CD Sent", formatDate(getField("3977"))],
                    [
                      "Contingency",
                      formatDate(getField("CX.BSCOMMITMENTDATE")),
                    ],
                    [
                      "Appraisal Due",
                      formatDate(getField("CX.SF.APPRAISAL.DUE")),
                    ],
                  ].map(([label, val]) => (
                    <div
                      key={label}
                      className="flex justify-between py-1.5 border-b border-[var(--border)]"
                    >
                      <span className="text-[var(--text-muted)]">{label}</span>
                      <span className="font-medium">{val}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Pricing & Margins */}
            <div className="glass-card p-5">
              <h3 className="flex items-center gap-2 text-sm font-semibold mb-4">
                <DollarSign className="w-4 h-4 text-emerald-600" />
                Pricing & Margins
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 text-sm">
                {[
                  ["Note Rate", getField("3")],
                  ["Buy Price", getField("2218")],
                  ["Corp Margin", getField("CX.CORPORATE.MARGIN")],
                  ["Branch Margin", getField("CX.BRANCH.MARGIN")],
                  ["LO Margin", getField("CX.LO.MARGIN")],
                  ["Orig Fees", getField("454")],
                  [
                    "Branch Net",
                    getField("CX.BRANCH.MARGIN.NET"),
                  ],
                  [
                    "Secondary Mkt",
                    getField("CX.SECONDARY.MARKET"),
                  ],
                ].map(([label, val]) => (
                  <div key={label}>
                    <div className="text-xs text-[var(--text-muted)]">
                      {label}
                    </div>
                    <div className="font-semibold">{val || "--"}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Fields Tab */}
        {tab === "fields" && (
          <div className="glass-card overflow-hidden">
            <div className="p-4 border-b border-[var(--border)]">
              <h3 className="text-sm font-semibold">
                Encompass Mapped Fields ({fields.length} fields)
              </h3>
              <p className="text-xs text-[var(--text-muted)]">
                Data from your mapped field definitions
              </p>
            </div>
            <div className="overflow-auto max-h-[calc(100vh-280px)]">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Field ID</th>
                    <th>Label</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {fields
                    .filter((f) => f.value)
                    .sort((a, b) => {
                      const la = FIELD_LABEL_MAP[a.fieldId] || a.fieldId;
                      const lb = FIELD_LABEL_MAP[b.fieldId] || b.fieldId;
                      return la.localeCompare(lb);
                    })
                    .map((f) => (
                      <tr key={f.fieldId} className="cursor-default">
                        <td className="font-mono text-xs text-[var(--accent)]">
                          {f.fieldId}
                        </td>
                        <td className="text-sm">
                          {FIELD_LABEL_MAP[f.fieldId] || f.fieldId}
                        </td>
                        <td className="text-sm font-medium">{f.value}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Documents Tab */}
        {tab === "documents" && (
          <DocumentsTab loanId={loanId} docs={docs} />
        )}

        {/* Milestones Tab */}
        {tab === "milestones" && (
          <div className="glass-card p-5">
            <h3 className="text-sm font-semibold mb-4">Loan Milestones</h3>
            {milestones.length === 0 ? (
              <p className="text-[var(--text-muted)] text-sm">
                No milestones available
              </p>
            ) : (
              <div className="space-y-0">
                {milestones.map((ms, i) => {
                  const isDone = ms.doneIndicator === true;
                  return (
                    <div key={i} className="flex items-start gap-4 relative">
                      {i < milestones.length - 1 && (
                        <div className="absolute left-[15px] top-[30px] w-px h-[calc(100%-10px)] bg-[var(--border)]" />
                      )}
                      <div
                        className={`w-[30px] h-[30px] rounded-full flex items-center justify-center flex-shrink-0 z-10 ${
                          isDone
                            ? "bg-emerald-50 border-2 border-emerald-500"
                            : "bg-white border-2 border-[var(--border)]"
                        }`}
                      >
                        {isDone ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        ) : (
                          <Clock className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                        )}
                      </div>
                      <div className="flex-1 pb-6">
                        <div className="text-sm font-semibold">
                          {ms.milestoneName || `Milestone ${i + 1}`}
                        </div>
                        <div className="flex gap-4 text-xs text-[var(--text-muted)] mt-1">
                          {isDone && ms.startDate && (
                            <span>Completed: {formatDate(ms.startDate)}</span>
                          )}
                          {!isDone && ms.startDate && (
                            <span>Expected: {formatDate(ms.startDate)}</span>
                          )}
                          {ms.expectedDays !== undefined && (
                            <span>{ms.expectedDays} days</span>
                          )}
                          {ms.loanAssociate?.name && (
                            <span>{ms.loanAssociate.roleName ? `${ms.loanAssociate.roleName}: ` : ""}{ms.loanAssociate.name}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Raw Data Tab */}
        {tab === "raw" && loan && (
          <div className="glass-card p-5">
            <h3 className="text-sm font-semibold mb-3">
              Raw Loan JSON (Read-Only)
            </h3>
            <pre className="bg-[var(--bg-secondary)] p-4 rounded-lg text-xs font-mono overflow-auto max-h-[calc(100vh-300px)] text-[var(--text-secondary)]">
              {JSON.stringify(loan, null, 2)}
            </pre>
          </div>
        )}
      </main>
      </div>
    </>
  );
}

import { NextRequest, NextResponse } from "next/server";
import { getDocuments, getAttachments } from "@/lib/encompass";

interface RawAttachmentRef {
  entityId: string;
  entityName?: string;
  entityType?: string;
  isActive?: boolean;
  createdDate?: string;
  fileSize?: number;
}

interface RawDocument {
  id: string;
  title?: string;
  description?: string;
  status?: string;
  documentStatus?: string;
  createdDate?: string;
  updatedDate?: string;
  lastAttachmentDate?: string;
  isProtected?: boolean;
  attachments?: RawAttachmentRef[];
  application?: { entityName?: string };
  milestone?: { entityName?: string };
  documentGroups?: string[];
  createdBy?: { entityId?: string; entityName?: string };
}

interface RawAttachment {
  id: string;
  title?: string;
  type?: string;
  isActive?: boolean;
  fileSize?: number;
  isRemoved?: boolean;
  createdDate?: string;
  createdBy?: { entityId?: string; entityName?: string };
  assignedTo?: { entityId?: string; entityName?: string };
  pages?: unknown[];
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ loanId: string }> },
) {
  try {
    const { loanId } = await params;

    const [rawDocs, rawAtts] = await Promise.all([
      getDocuments(loanId).catch(() => []) as Promise<RawDocument[]>,
      getAttachments(loanId).catch(() => []) as Promise<RawAttachment[]>,
    ]);

    // Build a map of attachment ID -> attachment detail
    const attMap = new Map<string, RawAttachment>();
    for (const att of rawAtts) {
      if (att.id) attMap.set(att.id, att);
    }

    // Enrich documents with their attachment details
    const documents = (rawDocs || []).map((doc) => {
      const docAttachments = (doc.attachments || []).map((ref) => {
        const detail = attMap.get(ref.entityId);
        return {
          id: ref.entityId,
          name: ref.entityName || detail?.title || "Untitled",
          fileSize: ref.fileSize || detail?.fileSize || 0,
          createdDate: ref.createdDate || detail?.createdDate,
          type: detail?.type,
          pageCount: detail?.pages?.length || 0,
          isActive: ref.isActive ?? detail?.isActive ?? true,
          downloadUrl: `/api/loans/${loanId}/attachments/${encodeURIComponent(ref.entityId)}`,
        };
      });

      return {
        id: doc.id,
        title: doc.title || "Untitled",
        description: doc.description || "",
        status: doc.documentStatus || doc.status || "",
        createdDate: doc.createdDate,
        updatedDate: doc.updatedDate,
        lastAttachmentDate: doc.lastAttachmentDate,
        isProtected: doc.isProtected || false,
        borrower: doc.application?.entityName || "",
        milestone: doc.milestone?.entityName || "",
        groups: doc.documentGroups || [],
        createdBy: doc.createdBy?.entityName || doc.createdBy?.entityId || "",
        attachmentCount: docAttachments.length,
        attachments: docAttachments,
      };
    });

    // Also expose standalone attachments (not assigned to a doc)
    const docAttIds = new Set(
      rawDocs.flatMap((d) => (d.attachments || []).map((a) => a.entityId)),
    );
    const standaloneAttachments = rawAtts
      .filter((a) => !docAttIds.has(a.id) && !a.isRemoved)
      .map((att) => ({
        id: att.id,
        title: att.title || "Untitled",
        type: att.type,
        fileSize: att.fileSize || 0,
        pageCount: att.pages?.length || 0,
        createdDate: att.createdDate,
        createdBy: att.createdBy?.entityName || att.createdBy?.entityId || "",
        assignedTo: att.assignedTo?.entityName || "",
        downloadUrl: `/api/loans/${loanId}/attachments/${encodeURIComponent(att.id)}`,
      }));

    return NextResponse.json({
      documents,
      standaloneAttachments,
      summary: {
        totalDocuments: documents.length,
        docsWithAttachments: documents.filter((d) => d.attachmentCount > 0).length,
        totalAttachments: rawAtts.length,
        standaloneAttachments: standaloneAttachments.length,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

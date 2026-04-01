import { readFileSync, existsSync } from "fs";
import { join } from "path";

const DOCS_DIR = join(process.cwd(), "docs", "MIlo AI");

export interface DocMeta {
  filename: string;
  topic: string;
  keywords: string[];
}

export const DOC_CATALOG: DocMeta[] = [
  {
    filename: "Formulario_Postulacion_Desafios2025.pdf",
    topic: "Formulario de Postulacion Desafios 2025",
    keywords: ["postulacion", "desafio", "formulario", "convocatoria", "2025", "proyecto"],
  },
  {
    filename: "Guia_tecnica_Superintendencia_Educacion.pdf",
    topic: "Guia Tecnica de la Superintendencia de Educacion",
    keywords: ["guia", "tecnica", "superintendencia", "sie", "fiscalizacion", "normativa", "regulacion", "indicador"],
  },
  {
    filename: "Fase de Configuración Inicial con datos del SIE.pdf",
    topic: "Fase de Configuracion Inicial con datos del SIE",
    keywords: ["configuracion", "inicial", "sie", "datos", "fase", "implementacion", "setup"],
  },
  {
    filename: "Carta Gantt Actualizada.pdf",
    topic: "Carta Gantt Actualizada del Proyecto",
    keywords: ["gantt", "cronograma", "planificacion", "calendario", "hitos", "timeline", "proyecto"],
  },
  {
    filename: "Propuesta_Indicadores.pdf",
    topic: "Propuesta de Indicadores de Gasto Educativo",
    keywords: ["indicador", "indicadores", "gasto", "propuesta", "medicion", "metrica", "anomalia", "riesgo", "alerta"],
  },
];

// ── In-memory base64 cache ──
const b64Cache = new Map<string, string>();

export function loadDocBase64(filename: string): string | null {
  if (b64Cache.has(filename)) return b64Cache.get(filename)!;
  const filepath = join(DOCS_DIR, filename);
  try {
    if (!existsSync(filepath)) return null;
    const buf = readFileSync(filepath);
    const b64 = buf.toString("base64");
    b64Cache.set(filename, b64);
    return b64;
  } catch {
    return null;
  }
}

/** Route a question to the most relevant education documents */
export function routeDocs(question: string, conversationContext?: string): DocMeta[] {
  const q = (question + " " + (conversationContext || "")).toLowerCase();

  // Score each doc by keyword hits
  const scored = DOC_CATALOG.map(doc => {
    const hits = doc.keywords.filter(kw => q.includes(kw)).length;
    return { doc, hits };
  }).filter(s => s.hits > 0)
    .sort((a, b) => b.hits - a.hits);

  // Return top 3 most relevant docs
  return scored.slice(0, 3).map(s => s.doc);
}

/** Route docs with batch support */
export function routeDocsMultiBatch(question: string, conversationContext?: string): {
  directBatch: DocMeta[];
  overflowBatches: DocMeta[][];
} {
  const docs = routeDocs(question, conversationContext);
  // Education docs are small enough to fit in a single batch
  return { directBatch: docs, overflowBatches: [] };
}

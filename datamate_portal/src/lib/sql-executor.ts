/**
 * Safe SQL executor for AI-generated queries against the desafio schema.
 * Only allows SELECT statements. Blocks mutations and dangerous operations.
 */

import { getSupabaseAdmin } from "./supabase";

const MAX_ROWS = 500;
const QUERY_TIMEOUT_MS = 30_000;

// Whitelist of allowed tables in the desafio schema
const ALLOWED_TABLES = [
  "estado_resultado",
  "documentos",
  "remuneraciones_2020",
  "remuneraciones_2021",
  "remuneraciones_2022",
  "remuneraciones_2023",
  "remuneraciones_2024",
  "mv_sostenedor_profile",
  "mv_sostenedor_yoy",
  "mv_sostenedor_financials",
  "mv_sostenedor_payroll",
  "mv_sostenedor_hhi",
  "mv_sostenedor_documentos",
  "mv_sostenedor_identity",
  "mv_payroll_2020",
  "mv_payroll_2021",
  "mv_payroll_2022",
  "mv_payroll_2023",
  "mv_payroll_2024",
  "mv_sostenedor_indicators",
];

interface SqlResult {
  data: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
  error?: string;
  executionMs: number;
}

/** Validate that SQL is read-only and targets allowed tables */
function validateQuery(sql: string): { valid: boolean; error?: string } {
  const normalized = sql.trim().replace(/\s+/g, " ").toLowerCase();

  // Must start with SELECT or WITH (CTE)
  if (!normalized.startsWith("select") && !normalized.startsWith("with")) {
    return { valid: false, error: "Solo se permiten consultas SELECT" };
  }

  // Block dangerous keywords
  const blocked = [
    "insert", "update", "delete", "drop", "alter", "create", "truncate",
    "grant", "revoke", "execute", "exec", "copy", "pg_", "information_schema",
    "set ", "reset ", "begin", "commit", "rollback",
  ];
  for (const kw of blocked) {
    const regex = new RegExp(`(?<![a-z_])${kw.replace(/\s/g, "\\s+")}(?![a-z_])`, "i");
    if (regex.test(normalized)) {
      return { valid: false, error: `Operacion no permitida: ${kw.trim().toUpperCase()}` };
    }
  }

  // Verify it references at least one allowed table
  const referencesAllowed = ALLOWED_TABLES.some(t => normalized.includes(t));
  if (!referencesAllowed) {
    return { valid: false, error: `La consulta debe referenciar tablas del esquema desafio: ${ALLOWED_TABLES.join(", ")}` };
  }

  return { valid: true };
}

/** Execute a validated SQL query against the desafio schema.
 *  Never throws — always returns a result with optional error message. */
export async function executeSql(sql: string): Promise<SqlResult> {
  const start = Date.now();

  const validation = validateQuery(sql);
  if (!validation.valid) {
    return { data: [], rowCount: 0, truncated: false, error: validation.error, executionMs: 0 };
  }

  // Always strip trailing semicolons — they cause syntax errors inside the RPC format wrapper
  let safeSql = sql.trim().replace(/;\s*$/, "");

  // Ensure LIMIT is present to prevent runaway queries
  const normalizedLower = safeSql.toLowerCase();
  if (!normalizedLower.includes("limit")) {
    safeSql = `${safeSql} LIMIT ${MAX_ROWS}`;
  }

  try {
    const db = getSupabaseAdmin();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (db as any).rpc("execute_readonly_sql", {
      query_text: safeSql,
    });

    if (error) {
      const msg = error.message || "";
      // Handle timeout gracefully
      if (msg.includes("statement timeout") || msg.includes("canceling statement")) {
        return {
          data: [],
          rowCount: 0,
          truncated: false,
          error: "Consulta excedio el tiempo limite (60s). Usa WHERE sost_id = 'X' o WHERE periodo = 'YYYY' para filtrar, o prefiere las vistas mv_sostenedor_* que son pre-calculadas.",
          executionMs: Date.now() - start,
        };
      }
      // For other errors, try fallback but also expose the RPC error
      const fallback = await executeSqlFallback(safeSql, start);
      if (fallback.error) {
        // Both RPC and fallback failed — return the RPC error (more informative)
        return { ...fallback, error: `RPC: ${msg} | Fallback: ${fallback.error}` };
      }
      return fallback;
    }

    const rows = Array.isArray(data) ? data : [];
    return {
      data: rows.slice(0, MAX_ROWS),
      rowCount: rows.length,
      truncated: rows.length > MAX_ROWS,
      executionMs: Date.now() - start,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("fetch failed") || msg.includes("timeout") || msg.includes("abort")) {
      return {
        data: [],
        rowCount: 0,
        truncated: false,
        error: "La conexion a la base de datos excedio el tiempo limite. Intenta con una consulta mas especifica (filtrar por sost_id o periodo).",
        executionMs: Date.now() - start,
      };
    }
    return await executeSqlFallback(safeSql, start);
  }
}

/** Fallback: parse SQL intent and use Supabase query builder */
async function executeSqlFallback(sql: string, startTime: number): Promise<SqlResult> {
  try {
    const { getDesafioClient } = await import("./supabase");
    const db = getDesafioClient();

    const normalized = sql.trim().toLowerCase();

    // Match: SELECT columns FROM table [WHERE ...] [ORDER BY ...] [LIMIT ...]
    const selectMatch = normalized.match(
      /select\s+(.+?)\s+from\s+(?:desafio\.)?(\w+)(?:\s+(?:as\s+\w+\s+)?)?(?:where\s+(.+?))?(?:\s+group\s+by\s+(.+?))?(?:\s+order\s+by\s+(.+?))?(?:\s+limit\s+(\d+))?$/
    );

    if (!selectMatch) {
      return {
        data: [],
        rowCount: 0,
        truncated: false,
        error: "Consulta compleja no soportada en modo fallback. Cree la funcion RPC 'execute_readonly_sql' en Supabase para consultas avanzadas con JOINs. SQL en: supabase/migrations/20260331_add_readonly_sql_function.sql",
        executionMs: Date.now() - startTime,
      };
    }

    const [, columns, table, whereClause, , orderClause, limitStr] = selectMatch;
    const limit = limitStr ? parseInt(limitStr) : MAX_ROWS;

    const selectCols = columns.trim() === "*" ? "*" : columns.trim();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query: any = db.from(table).select(selectCols).limit(Math.min(limit, MAX_ROWS));

    // Apply simple equality WHERE clauses (col = 'val' or col = num)
    if (whereClause) {
      const eqMatches = whereClause.matchAll(/(\w+)\s*=\s*'([^']+)'/g);
      for (const m of eqMatches) query = query.eq(m[1], m[2]);
      const eqNumMatches = whereClause.matchAll(/(\w+)\s*=\s*(\d+(?:\.\d+)?)/g);
      for (const m of eqNumMatches) query = query.eq(m[1], m[2]);
    }

    // Apply ORDER BY for single-column sorts
    if (orderClause) {
      const orderMatch = orderClause.match(/^(\w+)(?:\s+(asc|desc))?/i);
      if (orderMatch) {
        query = query.order(orderMatch[1], { ascending: (orderMatch[2] || "asc").toLowerCase() === "asc" });
      }
    }

    const { data, error } = await query;

    if (error) {
      return {
        data: [],
        rowCount: 0,
        truncated: false,
        error: `Error Supabase: ${error.message}`,
        executionMs: Date.now() - startTime,
      };
    }

    const rows = (data || []) as Record<string, unknown>[];
    return {
      data: rows,
      rowCount: rows.length,
      truncated: rows.length >= Math.min(limit, MAX_ROWS),
      executionMs: Date.now() - startTime,
    };
  } catch (err) {
    return {
      data: [],
      rowCount: 0,
      truncated: false,
      error: `Fallback error: ${err instanceof Error ? err.message : "Unknown"}`,
      executionMs: Date.now() - startTime,
    };
  }
}

/** Complete schema description with sample data for AI SQL generation */
export function getSchemaDescription(): string {
  return `## Base de Datos PostgreSQL — Esquema "desafio" (Supabase)

### ESCALA: ~252 MILLONES DE FILAS TOTALES
- estado_resultado: ~22.6M filas (~12 sostenedores, cada uno con ~2M filas)
- documentos: ~17.4M filas
- remuneraciones_2020: ~42.6M | remuneraciones_2021: ~44.4M | remuneraciones_2022: ~45.6M | remuneraciones_2023: ~30.6M | remuneraciones_2024: ~49.1M

### REGLA DE ORO: SIEMPRE usar GROUP BY + agregaciones. NUNCA SELECT * sin WHERE estricto.

---

### Tabla: desafio.estado_resultado (~22.6M filas)
Flujo anual de ingresos y gastos por sostenedor/RBD/cuenta/subvencion.

| Columna | Tipo | Valores ejemplo |
|---------|------|-----------------|
| sost_id | text | "65152518", "65153611", "65153617", "74290100", "69140100" |
| periodo | text | "2020", "2021", "2024" |
| rbd | text | "12820", "18094", "AC", "1011", "22337" |
| region_rbd | text (nullable) | "2.0", "5.0", "8.0", "10.0", "13.0", null |
| dependencia_rbd | text | "PS", "M", "ADM. CENTRAL" |
| subvencion_alias | text | "GENERAL", "MANTENIMIENTO", "SEP", "PIE", "ACG", "PRORETENCION" |
| desc_tipo_cuenta | text | "Ingreso", "Gasto" |
| cuenta_alias | text | "410101" (Sueldo Base), "411601" (Mantencion), "310107" (Ley 19464) |
| desc_cuenta | text | "SUELDO BASE", "MANTENCIN Y REPARACIN DE INFRAESTRUCTURA" |
| cuenta_alias_padre | text | "410100", "411600", "310100" |
| desc_cuenta_padre | text | "REMUNERACIONES PERSONAL DOCENTE", "GASTOS EN CONSTRUCCIN..." |
| monto_declarado | text (cast to numeric) | "1924892", "0", "8280325" |
| desc_estado | text | "RENDIDO" |

**Fila ejemplo (Gasto):**
\`\`\`json
{"desc_tipo_cuenta":"Gasto","cuenta_alias":"411601","desc_cuenta":"MANTENCIN Y REPARACIN DE INFRAESTRUCTURA","cuenta_alias_padre":"411600","desc_cuenta_padre":"GASTOS EN CONSTRUCCIN Y MANTENCIN DE INFRAESTRUCTURA","monto_declarado":"1924892","periodo":"2024","subvencion_alias":"MANTENIMIENTO","sost_id":"65152518","rbd":"12820","region_rbd":"2.0","dependencia_rbd":"PS","desc_estado":"RENDIDO"}
\`\`\`

**Fila ejemplo (Ingreso):**
\`\`\`json
{"desc_tipo_cuenta":"Ingreso","cuenta_alias":"310604","desc_cuenta":"BONO ESPECIAL","cuenta_alias_padre":"310600","desc_cuenta_padre":"BONOS Y AGUINALDOS LEY DE REAJUSTE SECTOR PBLICO","monto_declarado":"0","periodo":"2024","subvencion_alias":"ACG","sost_id":"65153617","rbd":"AC","region_rbd":null,"dependencia_rbd":"PS","desc_estado":"RENDIDO"}
\`\`\`

---

### Tabla: desafio.documentos (~17.4M filas)
Libros de compras y honorarios con detalle de proveedor, fecha, monto.

| Columna | Tipo | Valores ejemplo |
|---------|------|-----------------|
| id_registro | text | "1094221", "1311637" |
| periodo | text | "2021", "2023", "2024" |
| sost_id | text | "65145834", "65138313", "71430300" |
| rut_sost | text | "65145834-k", "71430300-7" |
| nombre_sost | text | "FUNDACIÓN EDUCACIONAL COLEGIO LEONARDO DA VINCI DE ARICA" |
| rbd | text | "12630", "10600", "2514" |
| nombre_rbd | text | "COLEGIO LEONARDO DA VINCI", "ESCUELA AGRICOLA LAS GARZAS" |
| region_rbd | text | "15.0", "13.0", "6.0" |
| dependencia_rbd | text | "PS", "M" |
| subvencion_alias | text | "GENERAL", "MANTENIMIENTO", "SEP" |
| desc_libro | text | "Libro de Honorarios Percibidos", "Libro de Compras Percibidos" |
| tipo_docs_alias | text | "FACEL", "BPST", "BHE", "BOL", "BOLE", "BOLEC", "BOLH", "BOLHE", "FACEX", "ODE", "NOTACRE" |
| cuenta_alias | text | "411103", "411601", "410910" |
| desc_cuenta | text | "CONTRATACIN OTROS SERVICIOS EXTERNOS" |
| desc_cuenta_padre | text | "SERVICIOS GENERALES" |
| cuenta_alias_padre | text | "411100" |
| numero_documento | text | "83", "2151082", "4858" |
| nombre_documento | text | "MARCELA PAZ CABALLERO GANA", "SHERWIN-WILLIAMS CHILE S.A." |
| detalle_documento | text | "REEMPLAZO DOCENTE", "LATEX CONSTRUCCION, rodillos" |
| fecha_documento | text (date) | "2021-08-31", "2023-01-04", "2024-01-15" |
| monto_total | text (numeric) | "320393", "1932374", "51849" |
| monto_declarado | text (numeric) | "320393", "1932374" |
| fecha_pago_documento | text (date) | "2021-08-31", "2024-01-18" |
| rut_documento | text | "202010024", "96803460", "76953766" |

**Fila ejemplo:**
\`\`\`json
{"id_registro":"1094291","periodo":"2023","sost_id":"65138313","rut_sost":"65138313-7","nombre_sost":"FUNDACIÓN EDUCACIONAL COLEGIO MONTESSORI SAN BERNARDO","rbd":"10600","nombre_rbd":"COLEGIO MONTESSORI","region_rbd":"13.0","dependencia_rbd":"PS","subvencion_alias":"MANTENIMIENTO","desc_libro":"Libro de Compras Percibidos","tipo_docs_alias":"FACEL","cuenta_alias":"411601","desc_cuenta":"MANTENCIN Y REPARACIN DE INFRAESTRUCTURA","desc_cuenta_padre":"GASTOS EN CONSTRUCCIN Y MANTENCIN DE INFRAESTRUCTURA","cuenta_alias_padre":"411600","numero_documento":"2151082","nombre_documento":"SHERWIN-WILLIAMS CHILE S.A.","detalle_documento":"LATEX CONSTRUCCION, rodillos, brochas","fecha_documento":"2023-01-04","monto_total":"1932374","monto_declarado":"1932374","fecha_pago_documento":"2023-01-04","rut_documento":"96803460"}
\`\`\`

---

### Tablas: desafio.remuneraciones_YYYY (~30-49M filas cada una)
Planilla mensual por trabajador. Una tabla por año: remuneraciones_2020, _2021, _2022, _2023, _2024.

**CRITICO: remuneraciones_2023 tiene columnas en MAYUSCULAS** — usar comillas dobles:
- remuneraciones_2020/2021/2022/2024: columnas en minusculas (sostenedor, totalhaber, liquido, etc.)
- remuneraciones_2023: columnas en MAYUSCULAS ("SOSTENEDOR", "TOTALHABER", "LIQUIDO", etc.)
- Para consultas multi-año, normalizar: SELECT sostenedor, totalhaber FROM desafio.remuneraciones_2024 UNION ALL SELECT "SOSTENEDOR", "TOTALHABER" FROM desafio.remuneraciones_2023

| Columna | Tipo | Valores ejemplo |
|---------|------|-----------------|
| rut | text (anonimizado) | "2020546790", "2020539377" |
| periodo | text | "2024", "2020" |
| sostenedor | text (**= sost_id** en otras tablas) | "74290100", "65116472" |
| rbd | text | "9930", "22462" |
| dgv | text | "3", "K" |
| tip | text | "CPF" (planta fija), "CI" (contrata/honorarios) |
| hc | text (numeric) | "42", "32" (horas contratadas) |
| fei | text (date) | "2023-08-07", "2019-10-04" |
| fun | text | "ASIPAR", "DOCAUL" (funcion del trabajador) |
| mes | text (int) | "1"-"12" |
| anio | text (int) | "2024", "2020" |
| habernorend | text (numeric) | "0" (haberes no remunerativos) |
| totalhaber | text (numeric) | "1598164", "827237" (total haberes bruto) |
| pre | text (numeric) | "130191" (prevision) |
| aaf | text (numeric) | "0" (aporte adicional) |
| sal | text (numeric) | "86138" (salud) |
| asa | text (numeric) | "0" (asignacion) |
| imp | text (numeric) | "5649" (impuesto) |
| cca | text (numeric) | "0" |
| dif | text (numeric) | "0" |
| dis | text (numeric) | "2914" |
| rej | text (numeric) | "0" |
| sce | text (numeric) | "0" |
| ant | text (numeric) | "0" (anticipo) |
| odv | text (numeric) | "3000" (otros descuentos varios) |
| totaldescuento | text (numeric) | "227892" (total descuentos) |
| liquido | text (numeric) | "1370272" (sueldo liquido neto) |
| subvencion_alias | text | "SEP", "GENERAL" |
| cuenta_alias | text | "410403", "410101", "410205" |
| monto | text (numeric) | "17972", "460896" |

**Fila ejemplo:**
\`\`\`json
{"rut":"2020546790","periodo":"2024","sostenedor":"74290100","rbd":"9930","dgv":"3","tip":"CPF","hc":"42","fei":"2023-08-07","fun":"ASIPAR","mes":"1","anio":"2024","habernorend":"0","totalhaber":"1598164","pre":"130191","aaf":"0","sal":"86138","asa":"0","imp":"5649","cca":"0","dif":"0","dis":"2914","rej":"0","sce":"0","ant":"0","odv":"3000","totaldescuento":"227892","liquido":"1370272","subvencion_alias":"SEP","cuenta_alias":"410403","monto":"17972"}
\`\`\`

---

---

### Vistas Materializadas (USAR PRIMERO para consultas generales — mucho mas rapidas)

#### desafio.mv_sostenedor_profile (~24K filas — perfil completo por sostenedor/periodo)
| Columna | Descripcion |
|---------|-------------|
| sost_id, periodo | Claves primarias |
| nombre, rut | Identidad del sostenedor |
| region_rbd, dependencia_rbd, rbd_count | Ubicacion y numero de establecimientos |
| total_ingresos, total_gastos, balance | Flujo financiero |
| gasto_admin, gasto_pedagogico, gasto_innovacion, gasto_operacion, gasto_infraestructura | Gastos por categoria |
| ind4_admin_ratio, ind4_level | #4 % gastos administrativos (CRITICO >30%, ALERTA >20%) |
| ind9_payroll_ratio, ind9_level | #9 % haberes sobre ingresos (CRITICO >85%, ALERTA >65%) |
| ind10_innovacion_ratio | #10 % innovacion pedagogica |
| ind11_hhi, ind11_level | #11 indice HHI concentracion fuentes (CRITICO >0.5, ALERTA >0.25) |
| balance_ratio, balance_level | Balance % (CRITICO <-5%, ALERTA <5%) |
| tasa_ejecucion | % gastos/ingresos |
| total_haberes, total_liquido, trabajadores, planta_fija, contrata, total_horas | Datos remuneraciones |
| doc_count, doc_monto, doc_types, proveedores_unicos, doc_coverage_ratio | Datos documentos |
| risk_score, risk_level | Score ponderado y nivel (CRITICO >45, ALERTA >15) |

**Ejemplo de query:**
\`\`\`sql
SELECT nombre, ind9_payroll_ratio, trabajadores, total_haberes, ind9_level
FROM desafio.mv_sostenedor_profile
WHERE periodo = '2020' AND ind9_level IN ('CRITICO', 'ALERTA')
ORDER BY ind9_payroll_ratio DESC
LIMIT 20
\`\`\`

#### desafio.mv_sostenedor_yoy (~24K filas — cambios año a año)
| Columna | Descripcion |
|---------|-------------|
| sost_id, periodo, nombre | Identificacion |
| yoy_ingresos_pct | Variacion % ingresos vs año anterior |
| yoy_gastos_pct | Variacion % gastos vs año anterior |
| yoy_haberes_pct | Variacion % haberes vs año anterior |
| yoy_admin_delta | Cambio absoluto en ratio administrativo |
| yoy_payroll_delta | Cambio absoluto en ratio remuneracional |

#### desafio.mv_sostenedor_payroll (remuneraciones agregadas por sostenedor/periodo)
| Columna | Descripcion |
|---------|-------------|
| total_haberes, total_liquido | Montos totales |
| trabajadores, planta_fija, contrata | Conteo por tipo |
| total_horas_contratadas | Horas totales |

#### desafio.mv_sostenedor_identity (nombres y RUTs)
#### desafio.mv_sostenedor_financials (totales financieros)
#### desafio.mv_sostenedor_hhi (concentracion de fuentes de ingreso)
#### desafio.mv_sostenedor_documentos (compras y proveedores)

#### desafio.mv_sostenedor_indicators (~24K filas — indicadores calculados #1 #2 #5 #7 #8 #13, cruza datos SIE con MINEDUC)
| Columna | Descripcion |
|---------|-------------|
| sost_id, periodo, nombre | Identificacion |
| ind1_costo_por_alumno | #1 Gasto total / matricula (CLP/alumno). CRITICO >$3.75M, ALERTA >$3M |
| ind1_level | 'OK' / 'ALERTA' / 'CRITICO' |
| ind2_pct_pedagogico | #2 % gasto pedagogico sobre total. CRITICO <40%, ALERTA <65% |
| ind2_level | 'OK' / 'ALERTA' / 'CRITICO' |
| ind5_yoy_ingresos_pct | #5 Variacion % ingresos vs año anterior |
| ind5_yoy_mat_pct | #5 Variacion % matricula vs año anterior (MINEDUC) |
| ind5_divergence_flag | #5 'ALERTA' si ingresos y matricula se mueven en sentido opuesto >10pp |
| ind7_zscore_admin | #7 Z-score de ind4_admin_ratio vs historial propio del sostenedor |
| ind7_zscore_payroll | #7 Z-score de ind9_payroll_ratio vs historial propio |
| ind7_zscore_balance | #7 Z-score de balance vs historial propio |
| ind7_zscore_risk | #7 Z-score de risk_score vs historial propio |
| ind7_anomaly_flag | #7 TRUE si algun z-score supera ±2σ |
| ind8_balance_proj_next | #8 Balance proyectado para el siguiente periodo (regresion lineal) |
| ind8_balance_proj_plus2 | #8 Balance proyectado para dos periodos adelante |
| ind8_balance_slope_per_period | #8 Pendiente de la tendencia del balance (CLP por periodo) |
| ind8_model_r2 | #8 R² de ajuste del modelo (0-1, mayor = mejor) |
| ind8_proj_risk_level | #8 Nivel de riesgo proyectado basado en balance futuro |
| ind13_alumnos_por_docente | #13 Alumnos por docente. CRITICO >37, ALERTA >25 |
| ind13_level | 'OK' / 'ALERTA' / 'CRITICO' |
| mat_total, n_docentes, horas_contrato_total | Datos MINEDUC de apoyo |
| ind4_admin_ratio, ind9_payroll_ratio, risk_score, risk_level | Pass-through de mv_sostenedor_profile |

**Ejemplo de query (sostenedores con proyeccion de balance negativo):**
\`\`\`sql
SELECT sost_id, nombre, periodo, ind8_balance_proj_next, ind8_proj_risk_level, ind8_model_r2
FROM desafio.mv_sostenedor_indicators
WHERE ind8_proj_risk_level IN ('CRITICO', 'ALERTA')
ORDER BY ind8_balance_proj_next ASC
LIMIT 20
\`\`\`

**Ejemplo de query (costo por alumno mas alto):**
\`\`\`sql
SELECT sost_id, nombre, periodo, ind1_costo_por_alumno, mat_total, total_gastos
FROM desafio.mv_sostenedor_indicators
WHERE periodo = '2023' AND ind1_costo_por_alumno IS NOT NULL
ORDER BY ind1_costo_por_alumno DESC
LIMIT 20
\`\`\`

---

### Claves de JOIN entre tablas
- estado_resultado.sost_id = documentos.sost_id
- estado_resultado.sost_id = remuneraciones_YYYY.sostenedor  **(OJO: columna se llama "sostenedor", NO "sost_id")**
- Claves compartidas: periodo, rbd, subvencion_alias, cuenta_alias
- documentos tiene nombre_sost (nombre del sostenedor) — las demas tablas NO

### Valores Enum Conocidos
- **desc_tipo_cuenta**: "Ingreso", "Gasto"
- **dependencia_rbd**: "PS", "M", "ADM. CENTRAL"
- **subvencion_alias**: "ACG", "GENERAL", "MANTENIMIENTO", "PIE", "PRORETENCION", "SEP"
- **tipo_docs_alias**: "BHE", "BOL", "BOLE", "BOLEC", "BOLH", "BOLHE", "BPST", "BPSTE", "FAC", "FACEL", "FACEX", "NOTACRE", "ODE"
- **tip (remuneraciones)**: "CPF" (contrato planta fija), "CI" (contrata/honorarios)
- **desc_estado**: "RENDIDO"

### IMPORTANTE: Tipos de dato
TODOS los valores numericos (monto_declarado, totalhaber, liquido, hc, mes, anio, etc.) se almacenan como TEXT.
Para operaciones matematicas SIEMPRE castear: CAST(monto_declarado AS numeric) o monto_declarado::numeric

### Jerarquia de cuentas contables
- 3XXXXX = Ingresos (310XXX subcategorias)
- 4XXXXX = Gastos (410XXX pedagogicos, 411XXX servicios/infraestructura, 420XXX administrativos)
- cuenta_alias_padre agrupa subcuentas (ej: 410100 agrupa 410101, 410102, etc.)

### Patrones de consulta multi-año
- Para comparar años: query cada periodo POR SEPARADO y unir con UNION ALL, o filtrar WHERE periodo IN ('2021','2024')
- Para remuneraciones multi-año: necesitas UNION ALL de las tablas individuales (remuneraciones_2020 UNION ALL remuneraciones_2021 etc.)
- NO asumas que todos los sostenedores existen en todos los periodos
- Para un sostenedor especifico: WHERE sost_id = 'XXXXX' reduce a miles de filas — seguro para SELECT *`;
}

/**
 * Comprehensive domain knowledge for the DataMate Education Platform.
 *
 * Extracted from official SIE documents:
 * - Propuesta_Indicadores.pdf (13 indicators, data dictionary, table relationships)
 * - Guia_tecnica_Superintendencia_Educacion.pdf (institutional context, error patterns)
 * - Fase de Configuracion Inicial con datos del SIE.pdf (hitos, metrics, compliance)
 * - Formulario_Postulacion_Desafios2025.pdf (project scope, 8 priority indicators)
 * - Carta Gantt Actualizada.pdf (timeline, etapas)
 */

// ── Shared system prompt context for all AI endpoints ──

export const DOMAIN_CONTEXT = `## Contexto Institucional
La Superintendencia de Educacion (SIE), creada en 2012 por la Ley 20.529, supervisa ~5,000 sostenedores educacionales que administran ~11,000 establecimientos con mas de 3 millones de estudiantes y un presupuesto anual de mas de USD 9,000 millones en subvenciones educativas.

La rendicion de cuentas anual ocurre entre el 1 de enero y el 31 de marzo a traves de ptf.supereduc.cl.

### Tipos de Dependencia Administrativa
- **M** = Municipal (en proceso de desmunicipalizacion, declinando)
- **CM** = Corporacion Municipal
- **SLEP** = Servicio Local de Educacion Publica (creciendo, reemplaza M)
- **PS** = Particular Subvencionado

### Patrones Historicos Clave
- Gastos remuneracionales representan 67-72% del gasto total
- Errores comunes: categorizacion (44%), brechas documentales (40%), reportes tardios (17%)
- Gasto no aceptado crecio de casi 0 en 2019 a ~$90,000M en 2022
- Tendencia de desmunicipalizacion: M disminuye, SLEP crece

### Marco Normativo
- Ley 20.529 (rendicion y uso de recursos educativos)
- DS 469 (reglamento de subvenciones)
- Ley 19.628 (proteccion de datos personales)
- Ley 21.719 (nueva ley de proteccion de datos personales)

## Base de Datos: Esquema "desafio" en Supabase

### ESCALA DE DATOS
- estado_resultado: ~22.6 millones de filas
- documentos: ~17.4 millones de filas
- remuneraciones (5 tablas anuales, 2020-2024): ~212 millones de filas combinadas
- TOTAL: ~252 millones de filas
Para consultas siempre usar filtros (periodo, sost_id, region_rbd) y agregaciones (GROUP BY, SUM, COUNT).

### Tabla 1: estado_resultado (Estados de Resultado)
Flujo anual de ingresos y gastos por RBD, subvencion y cuenta contable. ~22.6M filas. Periodos 2021-2023.
Columnas:
- PERIODO (anual, ej: "2023")
- SOST_ID (identificador del sostenedor)
- RBD (rol base de datos del establecimiento)
- REGION_RBD (region geografica)
- DEPENDENCIA_RBD (M/CM/SLEP/PS)
- SUBVENCION_ALIAS (tipo de subvencion)
- DESC_ESTADO (estado de la declaracion)
- DESC_TIPO_CUENTA ("Ingreso" o "Gasto")
- CUENTA_ALIAS (codigo de cuenta contable)
- DESC_CUENTA (descripcion de la cuenta)
- CUENTA_ALIAS_PADRE (cuenta padre en jerarquia)
- DESC_CUENTA_PADRE (descripcion cuenta padre)
- MONTO_DECLARADO (monto en pesos chilenos)

### Tabla 2: documentos (Libros de Compras y Honorarios)
Documentos de compra con fechas, proveedores y montos. ~17.4M filas. Periodos 2021-2024.
Columnas:
- ID_REGISTRO, PERIODO, SOST_ID, RUT_SOST, NOMBRE_SOST
- RBD, NOMBRE_RBD, REGION_RBD, DEPENDENCIA_RBD
- SUBVENCION_ALIAS, DESC_LIBRO
- TIPO_DOCS_ALIAS (tipo de documento)
- CUENTA_ALIAS, DESC_CUENTA, DESC_CUENTA_PADRE, CUENTA_ALIAS_PADRE
- NUMERO_DOCUMENTO, NOMBRE_DOCUMENTO, DETALLE_DOCUMENTO
- FECHA_DOCUMENTO, MONTO_TOTAL, MONTO_DECLARADO
- FECHA_PAGO_DOCUMENTO, RUT_DOCUMENTO

Tipos de documento (TIPO_DOCS_ALIAS):
BOL (boleta), BOLE (boleta electronica), BOLH (boleta honorarios), BHE (boleta honorarios electronica),
FAC (factura), FACE (factura electronica), ODE (orden de compra electronica),
BOLEC, BOLEX, BOLHE, FACEL, FACEX, FIN, BPST, BPSTE, DOCEX,
NOTACRE (nota de credito), PLANILLA, NOTADEB (nota de debito)

### Tabla 3: remuneraciones_YYYY (Libros de Remuneraciones, 2020-2024)
Planilla mensual por trabajador. RUTs anonimizados. Una tabla por ano. ~30-49M filas cada una (~212M total).
ATENCION: remuneraciones_2023 tiene columnas en MAYUSCULAS ("SOSTENEDOR", "TOTALHABER", etc.) — usar comillas dobles. Las demas tablas usan minusculas.
Columnas:
- RUT (anonimizado), PERIODO, SOSTENEDOR (=sost_id), RBD
- DGV, TIP (CPF=contrato planta fija, CI=contrata/honorarios)
- HC (horas contratadas), FEI, FUN, MES, ANIO
- HABERNOREND (haberes no renumerativos)
- TOTALHABER (total haberes)
- PRE, AAF, SAL, ASA, IMP, CCA, DIF, DIS, REJ, SCE, ANT, ODV (tipos de descuento)
- TOTALDESCUENTO (total descuentos)
- LIQUIDO (sueldo liquido)
- SUBVENCION_ALIAS, CUENTA_ALIAS, MONTO

### Relaciones entre Tablas (claves compartidas)
- estado_resultado <-> documentos: sost_id, periodo, rbd, subvencion_alias, cuenta_alias
- estado_resultado <-> remuneraciones: sost_id=sostenedor, periodo, rbd, subvencion_alias, cuenta_alias
- documentos <-> remuneraciones: sost_id=sostenedor, periodo, rbd

## 13 Indicadores Propuestos SIE

### Indicadores Sistemicos (vision global del sostenedor)
1. **Indice de Complejidad Territorial Educativa** — Mide la dificultad operativa del territorio del sostenedor (ruralidad, dispersion, acceso)
2. **Costo por alumno** — Gasto total / matricula. Permite comparar eficiencia entre sostenedores
3. **Indice de contexto territorial del gasto** — Normaliza el gasto segun condiciones del territorio (IPC regional, ruralidad)
4. **Indice de concentracion del gasto administrativo** — Proporcion gasto administrativo vs pedagogico. Alerta si administrativo > 30-35%
5. **Variacion interanual de ingresos vs matricula/asistencia** — Detecta incoherencias: si matricula baja pero ingresos suben (o viceversa)

### Indicadores Tacticos (analisis financiero detallado)
6. **Acreditacion de saldos** — Verifica que los saldos reportados coincidan con documentos de respaldo
7. **Analisis de promedios historicos de RC (AP)** — Compara rendicion de cuentas actual con promedios historicos para detectar anomalias
8. **Analisis de proyeccion de saldos (AF)** — Proyecta saldos futuros basado en tendencias para alertar riesgos de deficit
9. **Gasto remuneracional sobre ingreso depurado** — Proporcion remuneraciones / ingreso total depurado. Normal: 67-72%. Alerta si > 80%
10. **Porcentaje de gasto en innovacion pedagogica** — Gasto en cuentas 410500, 410600, 410700 sobre gasto total. Indica inversion en calidad educativa
11. **Dependencia sobre fuentes de ingreso (HHI)** — Indice Herfindahl-Hirschman de concentracion de ingresos. HHI > 0.25 indica alta dependencia de una fuente
12. **Cruce de SNED con niveles de riesgo financiero** — Contrasta rendimiento academico (SNED) con indicadores de riesgo financiero
13. **Indice de eficiencia en dotacion docente** — Relacion entre horas contratadas, matricula y gasto en remuneraciones. Detecta sobre/subdotacion

## Metricas de Impacto Economico (Fase Configuracion Inicial)
- Indicador 1: Variacion porcentual de Gastos No Aceptados (GNA)
- Indicador 2: Frecuencia de desviaciones con alerta temprana
- Indicador 3: Reduccion del monto promedio observado por categoria contable
- Indicador 4: Desviaciones prevenidas
- Indicador 5: Tiempo promedio de analisis financiero por sostenedor
- Indicador 6: Tiempo necesario para identificar inconsistencias
- Indicador 7: Tiempo de preparacion de reportes para SIE`;

// ── Table relationship definitions for cross-table queries ──

export const TABLE_RELATIONSHIPS = {
  estado_resultado_documentos: {
    leftTable: "estado_resultado",
    rightTable: "documentos",
    joinKeys: ["sost_id", "periodo", "rbd", "subvencion_alias", "cuenta_alias"],
  },
  estado_resultado_remuneraciones: {
    leftTable: "estado_resultado",
    rightTable: "remuneraciones",
    joinKeys: { left: ["sost_id", "periodo", "rbd", "subvencion_alias", "cuenta_alias"], right: ["sostenedor", "periodo", "rbd", "subvencion_alias", "cuenta_alias"] },
  },
  documentos_remuneraciones: {
    leftTable: "documentos",
    rightTable: "remuneraciones",
    joinKeys: { left: ["sost_id", "periodo", "rbd"], right: ["sostenedor", "periodo", "rbd"] },
  },
};

// ── Indicator account codes for computation ──

export const INDICATOR_ACCOUNTS = {
  innovacionPedagogica: ["410500", "410600", "410700"],
  gastoAdministrativo: ["420"],
  gastoPedagogico: ["410"],
};

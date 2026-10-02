// Un helper de lectura de valores de SAP que todavía usa el Network Analyzer.
//
// Este archivo era el juicio del Production Analyzer anterior de la suite (Error / Aviso / Nota / Bien).
// Esa lógica se retiró el 2026-10-01: el Production Analyzer usa ahora el algoritmo de v7, idéntico, en
// `production-analyzer.js`. Lo único que sigue vivo aquí es `texto`, porque `network-analysis.js`,
// `network-analyze.js` y `network-load-sap.js` lo importan de este archivo. Cuando el Network Analyzer
// se migre a v7 también, este archivo desaparece.

/** Un valor de SAP como texto limpio. */
export const texto = (valor) => String(valor ?? '').trim()

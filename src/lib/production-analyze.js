// Los tipos de material de lo ya descargado, para el recorrido de la versión anterior de los analizadores.
//
// Este archivo era el cruce de datos del Production Analyzer anterior de la suite. Esa lógica se retiró
// el 2026-10-01: el Production Analyzer lee y analiza ahora con `produccion-analizar.js`, con el
// algoritmo de v7. Lo único que sigue vivo es `tiposDeMaterial`, que usa `AnalizadorV7` (el recorrido
// que todavía tiene el Network Analyzer) para leer los tipos del maestro descargado. Cuando el Network
// Analyzer se migre a v7 también, este archivo desaparece.

import { texto } from '../../core/ibp/production-analysis.js'
import { configuracionInicial } from '../../core/ibp/production-rules.js'
import { porCursor } from './explorer-db.js'

/** Cuenta cuántos productos hay de cada tipo de material, para poder clasificarlos. */
export async function tiposDeMaterial() {
  const cuenta = {}
  await porCursor('bom_prd', (fila) => {
    const tipo = texto(fila.MATTYPEID)
    if (tipo) cuenta[tipo] = (cuenta[tipo] ?? 0) + 1
  })
  return { cuenta, configuracion: configuracionInicial(cuenta) }
}

// Production Analyzer — calidad de la configuración de producción, con la forma que tenía en v7.
//
// Portado del `tab-pa` de `index.html` de v7 y de `prodAnalyzer.js`. Los cinco pasos —mapeo, excluir
// tipos, categorizar, campos adicionales, ejecutar— los pone `AnalizadorV7`, que los comparte con el
// Network Analyzer. Aquí queda lo propio: qué análisis corre y cómo se lee su informe.
//
// Las reglas están en `core/ibp/production-rules.js`, el juicio en `production-analysis.js`,
// `location-analysis.js` y `resource-analysis.js`, y el cruce de datos en
// `src/lib/production-analyze.js`. Nada de eso vive aquí.
//
// El informe tiene tres cortes y ese orden no es casual:
//
//   1. POR PRODUCTO: si cada material tiene lo que necesita para planificarse.
//   2. POR UBICACIÓN: el mismo problema visto desde la planta. Contesta «¿esta planta está bien
//      montada?», que es la pregunta de la que alguien es dueño y la que se puede llevar a una
//      reunión.
//   3. POR RECURSO: si la máquina está de verdad en el plan.
//
// El rol de una ubicación no se lee de ningún campo de SAP: se deduce de cómo se comporta. Está en
// `location-analysis.js` con sus pruebas.

import { useState } from 'react'

import AnalizadorV7 from './AnalizadorV7.jsx'
import InformeDeCalidad from './InformeDeCalidad.jsx'
import { COLUMNAS as COLUMNAS_JERARQUIA } from '../../../core/ibp/production-analysis.js'
import { COLUMNAS as COLUMNAS_UBICACION } from '../../../core/ibp/location-analysis.js'
import { COLUMNAS as COLUMNAS_RECURSO } from '../../../core/ibp/resource-analysis.js'
import { analizar } from '../../lib/production-analyze.js'
import { analizar as analizarUbicaciones } from '../../lib/location-analyze.js'
import { analizar as analizarRecursos } from '../../lib/resource-analyze.js'

/** Los tres cortes del informe. Son pestañas del RESULTADO, no del recorrido. */
const CORTES = [
  { id: 'producto', label: 'Por producto' },
  { id: 'ubicacion', label: 'Por ubicación' },
  { id: 'recurso', label: 'Por recurso' },
]

export default function ProductionAnalyzer({ area = '', destino }) {
  const [corte, setCorte] = useState('producto')

  /**
   * Corre los tres análisis de una vez.
   *
   * Van juntos porque los tres salen de la misma clasificación: dejar uno viejo mientras los otros
   * están nuevos es la forma de que dos vistas digan cosas distintas del mismo material.
   *
   * El de recursos no recibe la clasificación: sus comprobaciones no dependen del tipo de material
   * sino de en qué tablas aparece la máquina.
   */
  async function correr(configuracion, { onAvance }) {
    const jerarquia = await analizar(configuracion, {
      onAvance: (cual) => onAvance({ ...cual, cual: 'la jerarquía' }),
    })
    const ubicaciones = await analizarUbicaciones(configuracion, {
      onAvance: (cual) => onAvance({ ...cual, cual: 'las ubicaciones' }),
    })

    // Los recursos dependen de dos tablas que son accesorias en la descarga. Si no están, se dice y
    // los otros dos informes siguen valiendo: parar los tres por esto sería desproporcionado.
    let recursos
    try {
      recursos = await analizarRecursos({
        onAvance: (cual) => onAvance({ ...cual, cual: 'los recursos' }),
      })
    } catch {
      recursos = { sinDatos: true }
    }

    return { jerarquia, ubicaciones, recursos }
  }

  return (
    <AnalizadorV7 area={area} destino={destino} grupo="arbol" correr={correr} queEs="la jerarquía">
      {({ jerarquia, ubicaciones, recursos }) => (
        <>
          <div className="tabs">
            {CORTES.map((una) => (
              <button
                key={una.id}
                type="button"
                className={`tab${corte === una.id ? ' active' : ''}`}
                onClick={() => setCorte(una.id)}
              >
                {una.label}
              </button>
            ))}
          </div>

          {corte === 'producto' && (
            <InformeDeCalidad
              tabla="pa_product_web"
              columnas={COLUMNAS_JERARQUIA}
              resumen={jerarquia.resumen}
              analizados={jerarquia.analizados}
              excluidos={jerarquia.excluidos}
              nombre={['jerarquia', area]}
            />
          )}

          {corte === 'ubicacion' && (
            <>
              <div className="notice notice-info">
                Los mismos problemas, agrupados por <b>ubicación</b>. El rol de cada una no se lee de
                ningún campo de SAP: se deduce de cómo se comporta —tener recetas la hace planta;
                mandar algo que el destino consume la hace proveedor; mandar algo que el destino NO
                consume la hace nodo de transferencia— y a cada rol se le exige lo suyo. Una ubicación
                puede tener varios roles a la vez, y entonces se le pide lo de cada uno.
              </div>
              <InformeDeCalidad
                tabla="pa_location_web"
                columnas={COLUMNAS_UBICACION}
                resumen={ubicaciones.resumen}
                analizados={ubicaciones.analizados}
                nombre={['ubicaciones', area]}
                tituloDeEstados="Roles deducidos"
              />
            </>
          )}

          {corte === 'recurso' && (
            recursos.sinDatos
              ? (
                <div className="notice notice-info">
                  Para este corte hacen falta el <b>maestro de recursos</b> y <b>Recurso por
                  ubicación</b>, que son accesorias en la descarga del paso ⑤. Vuelve a ⑤ y baja otra
                  vez: son dos tablas pequeñas.
                </div>
              )
              : (
                <>
                  <div className="notice notice-info">
                    Un recurso vive en dos tablas que nadie mira juntas: la que dice qué máquinas{' '}
                    <b>usan</b> las recetas y la que dice qué máquinas están <b>asignadas</b> a una
                    planta. Estar en una y no en la otra da un plan que no se puede ejecutar
                    —capacidad que no restringe, o capacidad que nunca se va a cargar— y SAP no lo
                    avisa.
                  </div>
                  <InformeDeCalidad
                    tabla="pa_resource_web"
                    columnas={COLUMNAS_RECURSO}
                    resumen={recursos.resumen}
                    analizados={recursos.analizados}
                    nombre={['recursos', area]}
                  />
                </>
              )
          )}
        </>
      )}
    </AnalizadorV7>
  )
}

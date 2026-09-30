// Lo que el panel «Pasos del job» necesita saber de un tipo de paso. Las pruebas de lo que usa el
// diálogo de lanzar (`nombreBase`, `tieneValor`, `pasoDesdeSecuencia`…) están en
// `job-schedule.test.js`, junto a quien lo consulta.

import { describe, it, expect } from 'vitest'

import {
  ETIQUETA_DE_PARAMETRO,
  OPERADOR_DE_SELECCION,
  ORDEN_DE_SECCIONES,
  SECCION_DE_PARAMETRO,
  etiquetaDeParametroDePaso,
  metaDeCatalogo,
  metaSinDatos,
} from './job-params.js'

/** La respuesta de `JobTemplateRead` para una secuencia con estos parámetros. */
const plantillaCon = (parametros) => ({
  d: { TemplateData: JSON.stringify({ templates: [{ sequences: [{ seq_param_val: parametros }] }] }) },
})

describe('etiquetaDeParametroDePaso', () => {
  it('usa la tabla del panel de v8', () => {
    expect(etiquetaDeParametroDePaso('P_FLTID')).toBe('Planning Filter')
  })

  // El panel y el diálogo tenían tablas distintas en v8; fusionarlas cambiaría una de las dos.
  it('no es la tabla del diálogo de lanzar', () => {
    expect(etiquetaDeParametroDePaso('P_ATTFCS')).toBe('Target Attribute for Algorithm')
    expect(ETIQUETA_DE_PARAMETRO.P_ATTFCS).toBe('Target Attribute')
    expect(etiquetaDeParametroDePaso('P_URCTX')).toBe('User Restrictions')
    expect(ETIQUETA_DE_PARAMETRO.P_URCTX).toBe('URL Context')
  })

  // v8 buscaba aquí por el nombre entero: un nombre con sufijo no se reconoce.
  it('un nombre que no conoce se muestra tal cual', () => {
    expect(etiquetaDeParametroDePaso('P_RAROXX')).toBe('P_RAROXX')
  })
})

describe('las tablas del panel', () => {
  it('las secciones van en el orden de SAP IBP', () => {
    expect(ORDEN_DE_SECCIONES).toEqual(['General', 'Control Parameters', 'Planning Start Settings', 'Planning Scope'])
  })

  it('los operadores se escriben como en v8', () => {
    expect(OPERADOR_DE_SELECCION).toMatchObject({ EQ: '=', NE: '≠', BT: '…', CP: '~' })
  })

  it('el respaldo de secciones reparte los parámetros del planning run', () => {
    expect(SECCION_DE_PARAMETRO).toMatchObject({
      P_VERS: 'General', P_PRF: 'Control Parameters', P_REFDAY: 'Planning Start Settings', S_LOCNO: 'Planning Scope',
    })
  })
})

describe('metaDeCatalogo', () => {
  it('toma etiquetas, ocultos y orden de la plantilla, y la sección de los grupos', () => {
    const meta = metaDeCatalogo({
      plantilla: plantillaCon([
        { name: 'P_VERS', label: 'Version' },
        { name: 'P_OCULTO', hidden: true },
        { name: 'P_AREA', label: 'Planning Area' },
      ]),
      parametros: [
        { JobTemplateParameterName: 'P_VERS', JobTemplateParamGroupName: 'G1' },
        { JobTemplateParameterName: 'P_AREA', JobTemplateParamGroupName: 'G2' },
      ],
      grupos: [
        { JobTemplateParamGroupName: 'G1', JobTemplateParamGroupText: 'General' },
      ],
    })

    expect(meta.hasData).toBe(true)
    expect(meta.paramOrder).toEqual(['P_VERS', 'P_AREA'])
    expect(meta.visibleParams).toEqual(['P_VERS', 'P_AREA'])
    expect(meta.labelMap).toEqual({ P_VERS: 'Version', P_AREA: 'Planning Area' })
    // Un grupo sin texto no inventa sección.
    expect(meta.groupMap).toEqual({ P_VERS: 'General' })
  })

  it('sin plantilla, el orden y los ocultos salen de JobTemplateParameterSet', () => {
    const meta = metaDeCatalogo({
      plantilla: null,
      parametros: [
        { JobTemplateParameterName: 'P_B' },
        { JobTemplateParameterName: 'P_OCULTO', JobTempParamHiddenInd: 'X' },
        { JobTemplateParameterName: 'P_A' },
      ],
    })
    expect(meta).toMatchObject({ hasData: true, paramOrder: ['P_B', 'P_A'], labelMap: {} })
  })

  // Las plantillas propias del cliente no traen nada: se muestran todos, con las secciones fijas.
  it('sin nada de SAP devuelve el respaldo', () => {
    const meta = metaDeCatalogo({ plantilla: null, parametros: [], grupos: [] })
    expect(meta).toEqual(metaSinDatos())
    expect(meta.visibleParams).toBeNull()
    expect(meta.groupMap).toEqual(SECCION_DE_PARAMETRO)
  })

  it('un TemplateData ilegible cuenta como sin plantilla', () => {
    expect(metaDeCatalogo({ plantilla: { d: { TemplateData: '{roto' } } }).hasData).toBe(false)
  })

  // El respaldo es una copia: quien lo reciba no puede estropear la tabla fija.
  it('el respaldo no comparte la tabla fija', () => {
    const uno = metaSinDatos()
    uno.groupMap.P_VERS = 'Otra'
    expect(SECCION_DE_PARAMETRO.P_VERS).toBe('General')
  })
})

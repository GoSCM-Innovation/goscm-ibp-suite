import { describe, it, expect } from 'vitest'

import {
  catalogoDesdeVsmt,
  clavesDesdeUri,
  columnasPorOmision,
  etiquetaDeCondicion,
  filasPorPagina,
  filasPorPaginaSegunCampos,
  filtroDeCondiciones,
  filtroDeDatos,
  literalOdata,
  partirValores,
  sinCamposDeSoloLectura,
  sinMetadatos,
  valorLegible,
} from './master-data-model.js'

describe('literalOdata', () => {
  it('entrecomilla el texto y duplica las comillas', () => {
    expect(literalOdata("O'Brien")).toBe("'O''Brien'")
  })

  // Comparada como texto, SAP contesta "Invalid parametertype used at function 'eq'".
  it('una fecha sale como literal de fecha, no entrecomillada', () => {
    expect(literalOdata('/Date(1753734272000+0000)/')).toBe("datetimeoffset'2025-07-28T20:24:32Z'")
  })
})

describe('valorLegible', () => {
  it('una fecha de OData se lee como fecha', () => {
    expect(valorLegible('/Date(1753734272000+0000)/')).not.toContain('/Date(')
  })

  it('lo demás se muestra tal cual', () => {
    expect(valorLegible('AS1PRODUCT')).toBe('AS1PRODUCT')
    expect(valorLegible(null)).toBe('')
  })
})

describe('partirValores', () => {
  it('parte por comas y limpia', () => {
    expect(partirValores(' A , B ,, C ')).toEqual(['A', 'B', 'C'])
  })

  it('sin nada devuelve una lista vacía', () => {
    expect(partirValores(undefined)).toEqual([])
  })
})

describe('filtroDeCondiciones', () => {
  it('un valor es una igualdad', () => {
    expect(filtroDeCondiciones([{ field: 'BRAND', op: 'in', value: 'ACME' }])).toBe("BRAND eq 'ACME'")
  })

  it('varios valores son una cadena de "o" entre paréntesis', () => {
    expect(filtroDeCondiciones([{ field: 'BRAND', op: 'in', value: 'A,B' }]))
      .toBe("(BRAND eq 'A' or BRAND eq 'B')")
  })

  it('empieza por usa la función de texto', () => {
    expect(filtroDeCondiciones([{ field: 'ID', op: 'sw', value: 'X' }])).toBe("startswith(ID,'X')")
  })

  // `ne ''` lo ignora SAP en silencio y devuelve todo; `gt ''` sí descarta los vacíos.
  it('"tiene valor" se escribe como mayor que vacío', () => {
    expect(filtroDeCondiciones([{ field: 'BRAND', op: 'nb' }])).toBe("BRAND gt ''")
  })

  it('las condiciones se unen con "y"', () => {
    expect(filtroDeCondiciones([
      { field: 'A', op: 'in', value: '1' },
      { field: 'B', op: 'nb' },
    ])).toBe("A eq '1' and B gt ''")
  })

  // Quien escribe un filtro pasa por estados a medias todo el rato.
  it('una condición incompleta se ignora en vez de romper la consulta', () => {
    expect(filtroDeCondiciones([
      { field: '', op: 'in', value: 'X' },
      { field: 'A', op: 'in', value: '  ' },
      { field: 'B', op: 'in', value: '2' },
    ])).toBe("B eq '2'")
  })

  it('sin condiciones no hay filtro', () => {
    expect(filtroDeCondiciones([])).toBe('')
    expect(filtroDeCondiciones(undefined)).toBe('')
  })
})

describe('etiquetaDeCondicion', () => {
  it('resume cada operador', () => {
    expect(etiquetaDeCondicion({ field: 'A', op: 'nb' })).toBe('A ≠ ∅')
    expect(etiquetaDeCondicion({ field: 'A', op: 'sw', value: 'X' })).toBe('A ⌐ X…')
    expect(etiquetaDeCondicion({ field: 'A', op: 'in', value: '1' })).toBe('A = 1')
    expect(etiquetaDeCondicion({ field: 'A', op: 'in', value: '1,2' })).toBe('A ∈ [1, 2]')
  })

  // Con veinte valores la etiqueta ocuparía toda la fila.
  it('con muchos valores corta y cuenta el resto', () => {
    expect(etiquetaDeCondicion({ field: 'A', op: 'in', value: '1,2,3,4,5' })).toBe('A ∈ [1, 2, 3 +2]')
  })

  it('una condición incompleta no tiene etiqueta', () => {
    expect(etiquetaDeCondicion({ field: 'A', op: 'in', value: '' })).toBeNull()
    expect(etiquetaDeCondicion({})).toBeNull()
  })
})

describe('filtroDeDatos', () => {
  it('arma el contexto de área y versión', () => {
    expect(filtroDeDatos({ planningArea: 'PA', versionId: 'V1' }))
      .toBe("PlanningAreaID eq 'PA' and VersionID eq 'V1'")
  })

  // Sin los paréntesis, un filtro con "o" dentro se ataría mal al "y" del contexto.
  it('el filtro de quien mira va entre paréntesis', () => {
    expect(filtroDeDatos({ planningArea: 'PA', extraFilter: "A eq '1' or A eq '2'" }))
      .toBe("PlanningAreaID eq 'PA' and (A eq '1' or A eq '2')")
  })

  it('sin contexto no hay filtro', () => {
    expect(filtroDeDatos({})).toBe('')
  })
})

describe('sinMetadatos y sinCamposDeSoloLectura', () => {
  it('quita el sobre de OData', () => {
    expect(sinMetadatos({ __metadata: { uri: 'x' }, A: 1 })).toEqual({ A: 1 })
  })

  it('quita lo que SAP rechaza al escribir', () => {
    expect(sinCamposDeSoloLectura([{ A: 1, PlanningAreaID: 'PA', VersionID: 'V', CREATEDDATE: 'x' }]))
      .toEqual([{ A: 1 }])
  })
})

describe('clavesDesdeUri', () => {
  it('saca las claves de negocio y deja fuera las de contexto', () => {
    expect(clavesDesdeUri("https://t/AS1UOMTO(UOMTOID='2X',PlanningAreaID='ASIBPTS',VersionID='ZP')"))
      .toEqual(['UOMTOID'])
  })

  // Sin claves se lee sin orden: peor, pero no es un error.
  it('una dirección sin claves devuelve una lista vacía', () => {
    expect(clavesDesdeUri('https://t/AS1UOMTO')).toEqual([])
    expect(clavesDesdeUri(undefined)).toEqual([])
  })
})

describe('catalogoDesdeVsmt', () => {
  const filas = [
    { PlanningAreaID: 'PB', VersionID: 'V1', MasterDataTypeID: 'T1', PlanningAreaDescr: 'Área B', VersionName: 'Base' },
    { PlanningAreaID: 'PA', VersionID: 'V2', MasterDataTypeID: 'T2', PlanningAreaDescr: 'Área A' },
    { PlanningAreaID: 'PA', VersionID: 'V2', MasterDataTypeID: 'T1' },
    { PlanningAreaID: 'PA', VersionID: 'V1', MasterDataTypeID: 'T3' },
  ]

  it('agrupa por área y versión, y ordena', () => {
    const catalogo = catalogoDesdeVsmt(filas)
    expect(Object.keys(catalogo)).toEqual(['PA', 'PB'])
    expect(catalogo.PA.versions.map((una) => una.id)).toEqual(['V1', 'V2'])
    expect(catalogo.PA.versions[1].mdts).toEqual(['T1', 'T2'])
  })

  it('usa la descripción cuando la hay y el código cuando no', () => {
    const catalogo = catalogoDesdeVsmt(filas)
    expect(catalogo.PA.desc).toBe('Área A')
    expect(catalogo.PA.versions[0].name).toBe('V1')
  })

  it('sin filas no hay catálogo', () => {
    expect(catalogoDesdeVsmt([])).toEqual({})
  })
})

describe('tamaño de página', () => {
  // Contar columnas subestima mucho las tablas de pocas columnas con valores largos.
  it('a filas más pesadas, páginas más pequeñas', () => {
    expect(filasPorPagina(100)).toBeGreaterThan(filasPorPagina(10_000))
  })

  it('nunca baja de 250 ni pasa de 5.000', () => {
    expect(filasPorPagina(10_000_000)).toBe(250)
    expect(filasPorPagina(1)).toBe(5000)
  })

  it('sin medida cae al respaldo por número de campos', () => {
    expect(filasPorPagina(0)).toBe(2000)
    expect(filasPorPaginaSegunCampos(0)).toBe(2000)
    expect(filasPorPaginaSegunCampos(62)).toBeLessThan(2000)
  })
})

describe('columnasPorOmision', () => {
  const todas = ['ID', 'A', 'B', 'C', 'D']

  it('las claves van primero', () => {
    expect(columnasPorOmision(todas, ['B'], 3)).toEqual(['B', 'ID', 'A'])
  })

  // Una tabla de sesenta columnas abierta entera no se lee.
  it('corta en el tope', () => {
    expect(columnasPorOmision(todas, [], 2)).toEqual(['ID', 'A'])
  })

  // Si las claves ya pasan el tope, se muestran igual: son lo que identifica la fila.
  it('las claves nunca se cortan', () => {
    expect(columnasPorOmision(todas, ['ID', 'A', 'B'], 2)).toEqual(['ID', 'A', 'B'])
  })

  it('una clave que no está en la tabla se ignora', () => {
    expect(columnasPorOmision(todas, ['NOEXISTE'], 2)).toEqual(['ID', 'A'])
  })
})

import { describe, it, expect } from 'vitest'

import { filtroDeCondiciones } from './master-data-model.js'
import {
  areasDesdeConjuntos,
  cifraLegible,
  conversionQueFalta,
  esCero,
  filtroDeCifra,
  filtroDeCifras,
  filtroDeFechas,
  filtroDePlanificacion,
  nivelDeAgregacion,
  parseKfMetadata,
  sinFilasEnCero,
  periodoLegible,
  selectDePlanificacion,
  sinCeros,
} from './planning-data-model.js'

describe('areasDesdeConjuntos', () => {
  // El área se llama como el conjunto; el resto son la escritura, los mensajes y dos genéricos.
  it('se queda solo con las áreas', () => {
    expect(areasDesdeConjuntos([
      'ASIBPTSMessage', 'KeyFigureDeltaDefinitionSet', 'ValueResultSet', 'ASIBPTS', 'ASIBPTSTrans',
    ])).toEqual(['ASIBPTS'])
  })

  it('un tenant con varias áreas las devuelve todas, ordenadas', () => {
    expect(areasDesdeConjuntos(['ZB', 'ZA', 'ZATrans'])).toEqual(['ZA', 'ZB'])
  })

  it('sin conjuntos no hay áreas', () => {
    expect(areasDesdeConjuntos(undefined)).toEqual([])
  })
})

describe('parseKfMetadata', () => {
  const xml = `
    <EntityType Name="OTRA"><Property Name="X" Type="Edm.String"/></EntityType>
    <EntityType Name="ASIBPTS">
      <Property Name="PRDID" Type="Edm.String" sap:label="Product ID" sap:aggregation-role="dimension"/>
      <Property Name="ADJUSTEDPRODUCTION" Type="Edm.Decimal" sap:aggregation-role="measure" sap:label="Producción ajustada"/>
      <Property Name="SINROL" Type="Edm.Decimal"/>
      <Property Name="TEXTO" Type="Edm.String"/>
    </EntityType>`

  it('separa dimensiones de cifras por el rol de agregación', () => {
    const leido = parseKfMetadata(xml, 'ASIBPTS')
    expect(leido.dims).toContain('PRDID')
    expect(leido.cifras).toContain('ADJUSTEDPRODUCTION')
  })

  // Hay tenants que no marcan el rol; un decimal sin rol es una cifra.
  it('sin rol, un decimal es cifra y un texto es dimensión', () => {
    const leido = parseKfMetadata(xml, 'ASIBPTS')
    expect(leido.cifras).toContain('SINROL')
    expect(leido.dims).toContain('TEXTO')
  })

  it('guarda las etiquetas y cae al nombre si no hay', () => {
    const leido = parseKfMetadata(xml, 'ASIBPTS')
    expect(leido.etiquetas.PRDID).toBe('Product ID')
    expect(leido.etiquetas.TEXTO).toBe('TEXTO')
  })

  it('un área que no está devuelve null', () => {
    expect(parseKfMetadata(xml, 'NOEXISTE')).toBeNull()
  })
})

describe('filtroDeCifra', () => {
  // Sin filtro 1.594 filas; con `ne 0` las MISMAS 1.594 y la primera vale 0,000000; con `gt 0`, 235.
  it('no usa "ne 0", que SAP ignora en silencio', () => {
    expect(filtroDeCifra('KF')).toBe('(KF gt 0 or KF lt 0)')
    expect(filtroDeCifra('KF')).not.toContain('ne')
  })

  it('sin cifra no hay filtro', () => {
    expect(filtroDeCifra('')).toBe('')
  })
})

describe('filtroDeFechas', () => {
  it('el literal es el de OData v2', () => {
    expect(filtroDeFechas('PERIODID4_TSTAMP', '2026-01-01', '2026-03-31')).toBe(
      "PERIODID4_TSTAMP ge datetime'2026-01-01T00:00:00' and PERIODID4_TSTAMP le datetime'2026-03-31T23:59:59'",
    )
  })

  // Sin T23:59:59 el ultimo dia se queda fuera: un periodo con hora distinta de medianoche ya es
  // mayor que 2026-03-31T00:00:00.
  it('el extremo de arriba llega al final del dia', () => {
    expect(filtroDeFechas('P', '', '2026-03-31')).toContain("T23:59:59")
  })

  it('cualquiera de los dos extremos puede ir solo', () => {
    expect(filtroDeFechas('P', '2026-01-01', '')).toBe("P ge datetime'2026-01-01T00:00:00'")
    expect(filtroDeFechas('P', '', '2026-01-01')).toBe("P le datetime'2026-01-01T23:59:59'")
  })

  it('sin campo de tiempo no hay filtro que poner', () => {
    expect(filtroDeFechas('', '2026-01-01', '2026-03-31')).toBe('')
  })

  it('sin fechas no filtra', () => {
    expect(filtroDeFechas('P')).toBe('')
  })
})

describe('filtroDePlanificacion con tramo de tiempo', () => {
  it('el tramo se une al resto con and', () => {
    const filtro = filtroDePlanificacion({
      conversiones: { UOMTOID: 'KG' },
      campoDeTiempo: 'PERIODID4_TSTAMP',
      desde: '2026-01-01',
    })
    expect(filtro).toContain("UOMTOID eq 'KG'")
    expect(filtro).toContain("PERIODID4_TSTAMP ge datetime'2026-01-01T00:00:00'")
    expect(filtro).toContain(' and ')
  })

  it('sin tramo, el filtro es el de siempre', () => {
    expect(filtroDePlanificacion({ conversiones: { UOMTOID: 'KG' } })).toBe("UOMTOID eq 'KG'")
  })
})

describe('filtroDePlanificacion', () => {
  it('pone los atributos de conversión que la cifra exige', () => {
    expect(filtroDePlanificacion({ conversiones: { UOMTOID: 'KG', CURRTOID: 'USD' } }))
      .toBe("UOMTOID eq 'KG' and CURRTOID eq 'USD'")
  })

  it('suma las condiciones de quien mira', () => {
    expect(filtroDePlanificacion({
      conversiones: { UOMTOID: 'KG' },
      condiciones: [{ field: 'PRDID', op: 'in', value: 'A,B' }],
    })).toBe("UOMTOID eq 'KG' and (PRDID eq 'A' or PRDID eq 'B')")
  })

  it('los operadores se escriben como en dato maestro', () => {
    expect(filtroDePlanificacion({ condiciones: [{ field: 'BRAND', op: 'nb' }] })).toBe("BRAND gt ''")
    expect(filtroDePlanificacion({ condiciones: [{ field: 'PRDID', op: 'sw', value: '10' }] }))
      .toBe("startswith(PRDID,'10')")
  })

  it('"solo con valor" añade el filtro de la cifra', () => {
    expect(filtroDePlanificacion({ conversiones: { UOMTOID: 'KG' }, cifra: 'KF', soloConValor: true }))
      .toBe("UOMTOID eq 'KG' and (KF gt 0 or KF lt 0)")
  })

  it('una condición incompleta se ignora', () => {
    expect(filtroDePlanificacion({ condiciones: [{ field: 'A', op: 'in', value: ' ' }, { op: 'in', value: 'x' }] }))
      .toBe('')
  })

  it('escapa las comillas', () => {
    expect(filtroDePlanificacion({ condiciones: [{ field: 'A', op: 'in', value: "O'Brien" }] }))
      .toBe("A eq 'O''Brien'")
  })
})

describe('esCero y sinCeros', () => {
  it('reconoce el cero que SAP manda como texto', () => {
    expect(esCero('0.000000')).toBe(true)
    expect(esCero('200.000000')).toBe(false)
  })

  it('descarta las filas sin valor', () => {
    const filas = [{ KF: '0.000000' }, { KF: '200.000000' }]
    expect(sinCeros(filas, 'KF')).toEqual([{ KF: '200.000000' }])
  })

  it('sin filas no revienta', () => {
    expect(sinCeros(undefined, 'KF')).toEqual([])
  })
})

describe('nivelDeAgregacion y selectDePlanificacion', () => {
  // El mismo dato: solo producto 1.594 filas; con periodo 90.713; con ubicación y periodo 106.996.
  it('el nivel se ordena para que la misma consulta sea siempre la misma', () => {
    expect(nivelDeAgregacion(['PERIODID4_TSTAMP', 'PRDID'])).toEqual(['PERIODID4_TSTAMP', 'PRDID'])
    expect(nivelDeAgregacion(['PRDID', 'LOCID'])).toEqual(['LOCID', 'PRDID'])
  })

  it('la cifra va al final del select', () => {
    expect(selectDePlanificacion(['PRDID'], 'KF')).toEqual(['PRDID', 'KF'])
  })

  it('sin cifra se puede pedir solo el nivel', () => {
    expect(selectDePlanificacion(['PRDID'], '')).toEqual(['PRDID'])
  })

  it('las dimensiones vacías no ensucian el nivel', () => {
    expect(nivelDeAgregacion(['PRDID', '', null])).toEqual(['PRDID'])
  })
})

describe('periodoLegible y cifraLegible', () => {
  it('una fecha de OData se lee como fecha', () => {
    expect(periodoLegible('/Date(1799020800000)/')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('lo que no es fecha se devuelve tal cual', () => {
    expect(periodoLegible('2026-01')).toBe('2026-01')
  })

  // SAP manda seis decimales; "200.000000" en una tabla no se lee.
  it('un número sale sin los seis decimales', () => {
    expect(cifraLegible('200.000000')).toBe('200')
    expect(cifraLegible('0.000000')).toBe('0')
  })

  it('lo que no es un número se devuelve tal cual', () => {
    expect(cifraLegible('')).toBe('')
  })
})

describe('conversionQueFalta', () => {
  it('reconoce el atributo que SAP nombra', () => {
    expect(conversionQueFalta('Add property UOMTOID to a filter condition in $filter')).toBe('UOMTOID')
    expect(conversionQueFalta("requires conversion attribute '(CURRTOID)Target Currency'")).toBe('CURRTOID')
  })

  // Tragarse otro error escondería el problema real detrás de una detección incompleta.
  it('un error de otra cosa no es una conversión', () => {
    expect(conversionQueFalta('You must pass at least one attribute')).toBeNull()
    expect(conversionQueFalta(undefined)).toBeNull()
  })
})

// Un nivel de planificación es casi todo ceros, y la copia de cifras clave lo lee acotado a las que
// tienen valor. `ne 0` no sirve: SAP lo ignora en silencio.
describe('filtroDeCifras', () => {
  it('pide los dos lados de cada cifra, unidos con or', () => {
    expect(filtroDeCifras(['KFA', 'KFB']))
      .toBe('(KFA gt 0 or KFA lt 0 or KFB gt 0 or KFB lt 0)')
  })

  it('una sola cifra queda igual que con filtroDeCifra', () => {
    expect(filtroDeCifras(['KFA'])).toBe(filtroDeCifra('KFA'))
    expect(filtroDeCifras(['KFA'])).toBe('(KFA gt 0 or KFA lt 0)')
  })

  it('sin cifras no hay filtro, y no un paréntesis vacío', () => {
    expect(filtroDeCifras([])).toBe('')
    expect(filtroDeCifras(null)).toBe('')
    expect(filtroDeCifras([null, ''])).toBe('')
    expect(filtroDeCifra('')).toBe('')
  })

  it('el filtro de planificación acepta varias cifras a la vez', () => {
    const salida = filtroDePlanificacion({ cifras: ['KFA', 'KFB'], soloConValor: true })
    expect(salida).toBe('(KFA gt 0 or KFA lt 0 or KFB gt 0 or KFB lt 0)')
  })

  it('sin soloConValor no se acota por valor aunque se pasen cifras', () => {
    expect(filtroDePlanificacion({ cifras: ['KFA'] })).toBe('')
  })
})

describe('sinFilasEnCero', () => {
  const fila = (a, b) => ({ KFA: a, KFB: b })

  it('descarta las filas donde TODAS las cifras valen cero', () => {
    const filas = [fila('0', '0.000000'), fila('0', '7'), fila('-3', '0')]
    expect(sinFilasEnCero(filas, ['KFA', 'KFB'])).toEqual([fila('0', '7'), fila('-3', '0')])
  })

  it('sin cifras no descarta nada: no hay contra qué juzgar', () => {
    const filas = [fila('0', '0')]
    expect(sinFilasEnCero(filas, [])).toEqual(filas)
    expect(sinFilasEnCero(filas, null)).toEqual(filas)
  })

  it('aguanta que no venga nada', () => {
    expect(sinFilasEnCero(null, ['KFA'])).toEqual([])
  })
})

// En v8 el constructor de condiciones era UNO para dato maestro y para cifras (`filterUtils.js`).
// Aquí había dos copias, y la de cifras entrecomillaba siempre: una condición sobre un campo de fecha
// salía como texto y SAP la rechazaba con «Invalid parametertype used at function 'eq'».
describe('las condiciones de una consulta de cifras', () => {
  it('un valor de fecha sale como literal de fecha, no entrecomillado', () => {
    const salida = filtroDePlanificacion({
      condiciones: [{ field: 'VALIDFROM', op: 'in', value: '/Date(1753734272000+0000)/' }],
    })
    expect(salida).toBe("VALIDFROM eq datetimeoffset'2025-07-28T20:24:32Z'")
  })

  it('un valor de texto sigue entrecomillado, con la comilla duplicada', () => {
    expect(filtroDePlanificacion({ condiciones: [{ field: 'PRDID', op: 'in', value: "O'HARA" }] }))
      .toBe("PRDID eq 'O''HARA'")
  })

  it('varios valores se unen con or, y las condiciones entre sí con and', () => {
    const salida = filtroDePlanificacion({
      condiciones: [
        { field: 'PRDID', op: 'in', value: 'A, B' },
        { field: 'LOCID', op: 'sw', value: 'PL' },
        { field: 'BRAND', op: 'nb' },
      ],
    })
    expect(salida).toBe("(PRDID eq 'A' or PRDID eq 'B') and startswith(LOCID,'PL') and BRAND gt ''")
  })

  it('da lo mismo que el constructor del dato maestro', () => {
    const condiciones = [{ field: 'PRDID', op: 'in', value: 'A,B' }, { field: 'BRAND', op: 'nb' }]
    expect(filtroDePlanificacion({ condiciones })).toBe(filtroDeCondiciones(condiciones))
  })
})

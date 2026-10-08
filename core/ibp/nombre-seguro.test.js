import { describe, expect, it } from 'vitest'

import { esNombreSeguro } from './nombre-seguro.js'

describe('esNombreSeguro', () => {
  it('acepta letras, números y guion bajo', () => {
    expect(esNombreSeguro('SBPRODUCT')).toBe(true)
    expect(esNombreSeguro('MASTER_DATA_API_SRV')).toBe(true)
    expect(esNombreSeguro('Z_CAMPO1')).toBe(true)
  })

  it('rechaza lo que cambiaría la ruta o armaría otra consulta', () => {
    for (const malo of ['../PLANNING_DATA_API_SRV/X', 'A/B', 'A?$expand=B', 'A&B=1', 'A B', "A'", 'A;B', '']) {
      expect(esNombreSeguro(malo), malo).toBe(false)
    }
  })

  it('lo que no es un texto no es un nombre', () => {
    for (const raro of [undefined, null, 12, {}, ['A']]) expect(esNombreSeguro(raro)).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'

import { explicarFallo } from './explicar-fallo.js'

/** Un fallo del transporte, con el código que devolvió SAP. */
const fallo = (status, message = `SAP devolvió ${status}`) => Object.assign(new Error(message), { status })

describe('los códigos que hablan de permisos', () => {
  // Es el caso que lo motivó: la pantalla de recursos decía «✕ SAP devolvió 403» y no había nada que
  // hacer con eso.
  it('un 403 dice qué acuerdo se usó y qué revisar', () => {
    const dicho = explicarFallo(fallo(403), 'SAP_COM_0068')

    expect(dicho).toContain('SAP devolvió 403')
    expect(dicho).toContain('SAP_COM_0068')
    expect(dicho).toContain('no tiene permiso para este servicio')
    expect(dicho).toContain('acuerdo de comunicación')
  })

  // Un 401 y un 403 no se arreglan igual: uno es la contraseña y el otro los permisos.
  it('un 401 habla de la contraseña, no de los permisos', () => {
    const dicho = explicarFallo(fallo(401), 'SAP_COM_0326')

    expect(dicho).toContain('contraseña')
    expect(dicho).not.toContain('no tiene permiso para este servicio')
  })

  // Nombrar solo el primero mandaría al consultor a revisar el acuerdo que no falló.
  it('con varios acuerdos posibles los nombra todos', () => {
    const dicho = explicarFallo(fallo(403), ['SAP_COM_0720', 'SAP_COM_0326'])

    expect(dicho).toContain('SAP_COM_0720 o SAP_COM_0326')
  })
})

describe('lo que no es de permisos se deja como está', () => {
  // Un 404 o un fallo de memoria de SAP ya dicen lo suyo; añadirles una explicación inventada los
  // haría peores.
  it.each([404, 400, 500, 501])('un %i no se toca', (status) => {
    expect(explicarFallo(fallo(status), 'SAP_COM_0068')).toBe(`SAP devolvió ${status}`)
  })

  it('un fallo sin código tampoco', () => {
    expect(explicarFallo(new Error('se cayó la red'), 'SAP_COM_0068')).toBe('se cayó la red')
  })

  it('sin saber el acuerdo no se inventa cuál es', () => {
    expect(explicarFallo(fallo(403), [])).toBe('SAP devolvió 403')
    expect(explicarFallo(fallo(403), null)).toBe('SAP devolvió 403')
  })

  it('aguanta que no venga nada', () => {
    expect(explicarFallo(null, 'SAP_COM_0068')).toBe('Falló la llamada a SAP.')
  })
})

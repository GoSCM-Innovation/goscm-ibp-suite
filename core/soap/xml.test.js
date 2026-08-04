import { describe, it, expect } from 'vitest'
import { escapeXml, parseFault, redactSessionId, xmlAll, xmlAttribute, xmlText, xmlValue } from './xml.js'

describe('escapeXml', () => {
  it('escapa los caracteres que romperían el XML', () => {
    expect(escapeXml('a & b < c > d "e"')).toBe('a &amp; b &lt; c &gt; d &quot;e&quot;')
  })

  it.each([null, undefined])('devuelve cadena vacía con %s', (value) => {
    expect(escapeXml(value)).toBe('')
  })
})

describe('xmlValue', () => {
  it('encuentra la etiqueta sin importar el prefijo del espacio de nombres', () => {
    expect(xmlValue('<ns2:taskName>Carga</ns2:taskName>', 'taskName')).toBe('Carga')
    expect(xmlValue('<taskName>Carga</taskName>', 'taskName')).toBe('Carga')
  })

  it('encuentra la etiqueta aunque traiga atributos', () => {
    expect(xmlValue('<message xml:lang="es">Hola</message>', 'message')).toBe('Hola')
  })

  it('devuelve null si no está', () => {
    expect(xmlValue('<a>1</a>', 'b')).toBeNull()
  })

  it('rechaza un nombre de etiqueta que no es un nombre', () => {
    expect(() => xmlValue('<a>1</a>', 'a|b')).toThrow(/no válido/)
  })
})

describe('xmlAll', () => {
  it('devuelve todas las apariciones como trozos de XML', () => {
    const xml = '<projects><name>A</name></projects><ns:projects><name>B</name></ns:projects>'
    const trozos = xmlAll(xml, 'projects')
    expect(trozos).toHaveLength(2)
    expect(xmlValue(trozos[1], 'name')).toBe('B')
  })

  it('devuelve lista vacía si no hay ninguna', () => {
    expect(xmlAll('<a/>', 'projects')).toEqual([])
  })
})

describe('xmlAttribute', () => {
  it('lee un atributo de la apertura de la etiqueta', () => {
    expect(xmlAttribute('<runId jobId="J-1" statusCode="TASK:SUCCESS">99</runId>', 'runId', 'jobId')).toBe('J-1')
  })

  it('devuelve null si el atributo no está', () => {
    expect(xmlAttribute('<runId>99</runId>', 'runId', 'jobId')).toBeNull()
  })
})

describe('xmlText', () => {
  it('quita etiquetas y secciones CDATA', () => {
    expect(xmlText('<a><![CDATA[texto]]></a>')).toBe('texto')
  })
})

describe('parseFault', () => {
  it('reconoce un error con detalle y lo junta en un mensaje', () => {
    const xml = `<soapenv:Fault>
      <faultcode>soapenv:Server</faultcode>
      <faultstring>Task not found</faultstring>
      <detail><message>El identificador no existe</message></detail>
    </soapenv:Fault>`
    expect(parseFault(xml)).toEqual({
      faultCode: 'soapenv:Server',
      faultString: 'Task not found — El identificador no existe',
    })
  })

  it('reconoce el error sin detalle', () => {
    expect(parseFault('<faultstring>Algo falló</faultstring>')?.faultString).toBe('Algo falló')
  })

  it('acepta las dos formas de escribir las etiquetas', () => {
    expect(parseFault('<faultCode>X</faultCode>')?.faultCode).toBe('X')
  })

  it('devuelve null cuando la respuesta es buena', () => {
    expect(parseFault('<response><ok/></response>')).toBeNull()
  })
})

describe('redactSessionId', () => {
  it('tapa el identificador de sesión, que vale tanto como una contraseña', () => {
    const xml = '<soapenv:Header><SessionId>abc-123-secreto</SessionId></soapenv:Header>'
    const tapado = redactSessionId(xml)
    expect(tapado).not.toContain('abc-123-secreto')
    expect(tapado).toContain('[oculto]')
  })

  it('tapa también cuando lleva prefijo de espacio de nombres', () => {
    expect(redactSessionId('<web:SessionId>secreto</web:SessionId>')).not.toContain('secreto')
  })

  it('deja el resto del XML intacto', () => {
    expect(redactSessionId('<a>1</a>')).toBe('<a>1</a>')
  })
})

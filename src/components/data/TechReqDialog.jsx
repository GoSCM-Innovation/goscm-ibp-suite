// Qué hay que tener configurado en SAP IBP para que estas aplicaciones puedan leer algo.
//
// Portado del diálogo `#techReqDialog` de `index.html` de v7, con sus cuatro pestañas y su guía
// descargable. Es documentación, no una pantalla que haga nada, y por eso vive en el pie del menú.
//
// Vale la pena tenerlo: la mitad de los tropiezos de un arranque no son de la herramienta, son de un
// acuerdo de comunicación que no está creado o que no tiene habilitada el área. Que la respuesta esté
// a un clic del sitio donde falla ahorra un correo y dos días.
//
// La pestaña «Conexión» es la única que cambió de contenido: en v7 explicaba qué escribir en el
// formulario de credenciales; aquí las credenciales las da de alta el administrador y viven cifradas,
// así que explica eso.

import { useState } from 'react'

import Modal from '../ui/Modal.jsx'

const PESTANAS = [
  { id: 'conexion', label: 'Conexión' },
  { id: 'usuario', label: 'Usuario SAP IBP' },
  { id: 'comm', label: 'Acceso a SAP IBP' },
  { id: 'entidades', label: 'Datos por aplicación' },
]

/** El encabezado naranja en versalitas que v7 usa para cada bloque del diálogo. */
const Titulo = ({ children }) => (
  <div style={{
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--accent)',
    textTransform: 'uppercase',
    letterSpacing: '.08em',
    marginBottom: 8,
  }}
  >
    {children}
  </div>
)

/** Una lista de puntos, como las de v7: sin viñeta de sistema, con su propio símbolo. */
const Lista = ({ items }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: 'var(--text2)' }}>
    {items.map((texto, indice) => <div key={indice}>{texto}</div>)}
  </div>
)

/** El recuadro verde de un escenario de comunicación. */
const Escenario = ({ codigo, descripcion, color = 'var(--green)' }) => (
  <div style={{
    background: 'var(--surface-glass-soft)',
    border: '1px solid var(--border)',
    borderLeft: `3px solid ${color}`,
    borderRadius: 4,
    padding: '6px 8px',
  }}
  >
    <div style={{ fontFamily: 'var(--mono)', color, fontSize: 10, marginBottom: 2 }}>{codigo}</div>
    <div style={{ color: 'var(--text3)', fontSize: 10 }}>{descripcion}</div>
  </div>
)

/** Una tarjeta de aplicación con los escenarios que necesita. */
const Tarjeta = ({ titulo, children }) => (
  <div style={{
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: 12,
  }}
  >
    <div style={{ color: 'var(--cyan)', fontWeight: 600, marginBottom: 8, fontSize: 11 }}>{titulo}</div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{children}</div>
  </div>
)

const SIN_CONEXION = (
  <div style={{
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 4,
    padding: '6px 8px',
    color: 'var(--text3)',
    fontSize: 10,
  }}
  >
    Sin conexión a SAP IBP
  </div>
)

/** Las entidades que consume cada aplicación, tal como las lista v7. */
const ENTIDADES = [
  {
    titulo: '📦 Production Visualizer',
    items: ['Production Source Header', 'Production Source Item', 'Production Source Resource',
      'Product (maestro)', 'Location (maestro)', 'Resource (maestro)'],
  },
  {
    titulo: '🔬 Production Analyzer',
    items: ['Production Source Header', 'Production Source Item', 'Production Source Resource',
      'Product (maestro)', 'Location (maestro)', 'Resource (maestro)', 'Location Product',
      'Location Source'],
  },
  {
    titulo: '🔭 Network Visualizer',
    items: ['Production Source Header', 'Production Source Item', 'Location Source',
      'Customer Source', 'Location Product', 'Customer Product', 'Product (maestro)',
      'Location (maestro)', 'Customer (maestro)'],
  },
  {
    titulo: '🌐 Network Analyzer',
    items: ['Production Source Header', 'Production Source Item', 'Location Source',
      'Customer Source', 'Location Product', 'Customer Product', 'Product (maestro)',
      'Location (maestro)', 'Customer (maestro)'],
  },
  {
    titulo: '📖 Glosario Analyzers',
    items: ['No consume ninguna entidad: explica los informes de los dos analizadores.'],
  },
  {
    titulo: '📑 Planning Area Documenter',
    items: ['Generación — sin conexión: solo los CSV del Download Configuration File',
      'Enriquecimiento (si hay conexión): Master Data Types del área (volumetría)',
      'JobTemplateSet', 'JobTemplateSequenceSet'],
  },
]

export default function TechReqDialog({ onClose }) {
  const [pestana, setPestana] = useState('conexion')

  return (
    <Modal title="Requisitos técnicos" onClose={onClose} wide>
      <div className="tabs modal-tabs">
        {PESTANAS.map((una) => (
          <button
            key={una.id}
            type="button"
            className={`tab${pestana === una.id ? ' active' : ''}`}
            onClick={() => setPestana(una.id)}
          >
            {una.label}
          </button>
        ))}
      </div>

      {pestana === 'conexion' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <div>
            <Titulo>Dirección de tu sistema SAP IBP</Titulo>
            <div style={{
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: '10px 14px',
              fontFamily: 'var(--mono)',
              fontSize: 12,
              color: 'var(--cyan)',
            }}
            >
              https://&#123;instancia&#125;-api.scmibp.ondemand.com
            </div>
            <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 6 }}>
              Donde <code style={{ color: 'var(--accent)', fontFamily: 'var(--mono)' }}>&#123;instancia&#125;</code>
              {' '}es el identificador de tu tenant. La dirección, el usuario y la contraseña las da de
              alta quien administra la cuenta en <b>Administración → Conexiones</b>, y quedan cifradas
              en el servidor: no llegan nunca al navegador.
            </div>
          </div>
          <div>
            <Titulo>Qué necesitas tener listo</Titulo>
            <Lista items={[
              '✓  Usuario y contraseña de acceso a la API',
              '✓  Planning Area configurada en SAP IBP',
              '✓  Versión (opcional — la versión base es el dato maestro del área)',
              '✓  Acceso habilitado en SAP IBP (ver la pestaña «Acceso a SAP IBP»)',
            ]}
            />
          </div>
        </div>
      )}

      {pestana === 'usuario' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <div>
            <Titulo>Tipo de usuario requerido</Titulo>
            <Lista items={[
              '✓  Debe ser un Communication User — un usuario dedicado a la integración con sistemas externos, distinto al usuario de negocio habitual',
              '✓  Debe tener permisos de lectura sobre los datos de planificación',
              '✓  La contraseña no debe estar vencida',
              '✓  Debe estar vinculado al escenario de integración configurado',
            ]}
            />
          </div>
          <div>
            <Titulo>Cómo crearlo en SAP IBP</Titulo>
            <Lista items={[
              '1.  Ir a SAP IBP → Administration',
              '2.  Communication Users → New',
              '3.  Tipo: Communication User',
              '4.  Asignar contraseña segura',
              '5.  Asignar rol: IBP Administrator',
            ]}
            />
          </div>
        </div>
      )}

      {pestana === 'comm' && (
        <>
          <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 14, lineHeight: 1.6 }}>
            Cada aplicación necesita que SAP IBP tenga habilitado un <b>escenario de integración</b>
            {' '}concreto. Estos escenarios controlan a qué datos puede acceder la aplicación. Un área
            debe habilitarse <b>por separado en cada servicio</b> del escenario: tenerla en uno no la
            habilita en los demás, y ese es el fallo que más veces se confunde con un problema de
            permisos.
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
            <Tarjeta titulo="📦 Production Visualizer">
              <Escenario codigo="SAP_COM_0720" descripcion="Acceso a datos de producción y maestros IBP" />
            </Tarjeta>
            <Tarjeta titulo="🔬 Production Analyzer">
              <Escenario codigo="SAP_COM_0720" descripcion="Acceso a datos de producción y maestros IBP" />
            </Tarjeta>
            <Tarjeta titulo="🔭 Network Visualizer">
              <Escenario codigo="SAP_COM_0720" descripcion="Acceso a datos de producción y maestros IBP" />
            </Tarjeta>
            <Tarjeta titulo="🌐 Network Analyzer">
              <Escenario codigo="SAP_COM_0720" descripcion="Acceso a datos de producción y maestros IBP" />
            </Tarjeta>
            <Tarjeta titulo="📖 Glosario Analyzers">{SIN_CONEXION}</Tarjeta>
            <Tarjeta titulo="📑 Planning Area Documenter">
              <div>
                <div style={{ color: 'var(--text3)', fontStyle: 'italic', fontSize: 10, marginBottom: 3 }}>
                  Generación (sin conexión)
                </div>
                {SIN_CONEXION}
              </div>
              <div>
                <div style={{ color: 'var(--text3)', fontStyle: 'italic', fontSize: 10, margin: '3px 0' }}>
                  Enriquecimiento opcional
                </div>
                <Escenario codigo="SAP_COM_0720" descripcion="Volumetría de datos maestros" />
                <div style={{ height: 4 }} />
                <Escenario codigo="SAP_COM_0326" descripcion="Acceso a los Application Jobs de IBP" color="var(--purple)" />
              </div>
            </Tarjeta>
          </div>

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            <Titulo>Cómo configurar el acceso en SAP IBP</Titulo>
            <Lista items={[
              '1.  Crear un sistema de comunicación en SAP IBP',
              '2.  Asignarle el Communication User',
              '3.  Crear un acuerdo de integración (Communication Arrangement)',
              '4.  Seleccionar el escenario que corresponde a tu aplicación',
              '5.  Habilitar el área de planificación en CADA servicio del escenario',
            ]}
            />
          </div>
        </>
      )}

      {pestana === 'entidades' && (
        <>
          <Titulo>Entidades OData consumidas por aplicación</Titulo>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, fontSize: 11 }}>
            {ENTIDADES.map((una) => (
              <div key={una.titulo}>
                <div style={{ color: 'var(--cyan)', fontWeight: 600, marginBottom: 6 }}>{una.titulo}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, color: 'var(--text2)' }}>
                  {una.items.map((que) => <div key={que}>• {que}</div>)}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <div style={{
        borderTop: '1px solid var(--border)',
        marginTop: 16,
        paddingTop: 14,
        display: 'flex',
        justifyContent: 'flex-end',
      }}
      >
        <a
          className="btn btn-primary btn-sm"
          href="/guia-communication-arrangements.png"
          download="Guia-Communication-Arrangements-SAP-IBP.png"
          style={{ textDecoration: 'none' }}
        >
          ⬇ Descargar guía de configuración
        </a>
      </div>
    </Modal>
  )
}

// Documentar un área de planificación: de los CSV de SAP a un Word que se entrega al cliente.
//
// Portado de `paDoc.js` de v7. El modelo está en `core/ibp/pa-doc-model.js` y el armado en
// `src/lib/pa-doc.js` y `docx.js`.
//
// Por qué los datos vienen de archivos y no de la API: la configuración de un área —los niveles de
// planificación, las definiciones de cálculo, los operadores— no está expuesta en los servicios de
// comunicación de IBP. Se exporta desde la pantalla de configuración del área. Es una limitación de
// SAP, y la herramienta lo dice en vez de dejar al consultor buscando el botón que no existe.
//
// Lo que sí se lee en vivo son los trabajos programados, que tienen API: así el documento dice además
// con qué se carga y se ejecuta el área.

import { lazy, Suspense, useMemo, useState } from 'react'

import { loRecibido, seccionesQueFaltan, SECCIONES } from '../../../core/ibp/pa-doc-model.js'
import { fetchJobTemplates, nombreDeJob } from '../../lib/ibp.js'
import {
  descargarDocumento, generarDocumento, ingerirArchivos, leerImagen,
} from '../../lib/pa-doc.js'

const FileDropzone = lazy(() => import('../ui/FileDropzone.jsx'))

const numero = (valor) => Number(valor ?? 0).toLocaleString('es')

export default function PlanningAreaDoc({ conexionId = '', tenant = '', area = '' }) {
  // El área elegida arriba sirve de respaldo: si la exportación no trae `GENERAL_INFO`, el documento
  // se queda sin nombre de área y esta es la única otra fuente que hay.
  const [archivos, setArchivos] = useState([])
  const [datos, setDatos] = useState({})
  const [noReconocidos, setNoReconocidos] = useState([])
  const [error, setError] = useState('')

  const [cliente, setCliente] = useState('')
  const [logo, setLogo] = useState(null)
  const [conTrabajos, setConTrabajos] = useState(true)

  const [generando, setGenerando] = useState('')
  const [hecho, setHecho] = useState(null)

  const recibido = useMemo(() => loRecibido(datos), [datos])
  const faltan = useMemo(() => seccionesQueFaltan(datos), [datos])
  const conAlgo = Object.keys(datos).length > 0

  async function recibirArchivos(leidos) {
    setArchivos(leidos)
    setError('')
    setHecho(null)
    try {
      const { default: JSZip } = await import('jszip')
      const leido = await ingerirArchivos(leidos, { JSZip })
      setDatos(leido.datos)
      setNoReconocidos(leido.noReconocidos)
    } catch (fallo) {
      setError(fallo.message)
    }
  }

  async function elegirLogo(archivos) {
    if (!archivos?.[0]) return
    try {
      setLogo(await leerImagen(archivos[0]))
    } catch (fallo) {
      setError(`No se pudo leer la imagen: ${fallo.message}`)
    }
  }

  async function generar() {
    setError('')
    setHecho(null)
    setGenerando('armando')

    try {
      let trabajos = null

      if (conTrabajos && conexionId) {
        setGenerando('trabajos')
        try {
          const plantillas = await fetchJobTemplates(conexionId)
          // Las plantillas estándar de SAP empiezan por `/IBP/`; el documento es del cliente, así que
          // se queda con las suyas: en el tenant de prueba son 203 de 331.
          trabajos = (plantillas ?? [])
            .filter((una) => !String(una.JobTemplateName ?? '').startsWith('/IBP/'))
            .map((una) => ({
              nombre: nombreDeJob(una) || una.JobTemplateName || '',
              tipo: una.JobTemplateName ?? '',
              pasos: '',
            }))
        } catch (fallo) {
          // Que el tenant no conteste no debe impedir el documento: se dice y se sigue.
          setError(`Los trabajos no se pudieron leer (${fallo.message}); el documento sale sin ellos.`)
        }
      }

      setGenerando('armando')
      const salida = await generarDocumento({
        datos,
        trabajos,
        meta: { cliente, tenant, logo, area },
      })

      descargarDocumento(salida.buffer, salida.nombre)
      setHecho({ nombre: salida.nombre, resumen: salida.resumen })
    } catch (fallo) {
      setError(fallo.message)
    } finally {
      setGenerando('')
    }
  }

  return (
    <div className="module-body">
      {error && <div className="notice notice-error">✕ {error}</div>}

      <div className="notice notice-info">
        La configuración de un área de planificación no se puede leer por API: SAP no la expone en los
        servicios de comunicación. Se exporta desde la pantalla de configuración del área —sale una
        carpeta de CSV— y se suelta aquí, comprimida o suelta. Los <b>trabajos programados</b> sí se leen
        en vivo del tenant.
      </div>

      <div className="tablero">
        <div className="card">
          <div className="card-label">Los archivos del área</div>
          <Suspense fallback={<div className="page-hint">Cargando…</div>}>
            <FileDropzone
              archivos={archivos}
              onCambiar={recibirArchivos}
              accept=".zip,.csv"
              titulo="Soltá el ZIP de la exportación, o los CSV"
              ayuda="Se reconocen por su nombre: ÁREA_KEYFIGURES.csv, ÁREA_PLEVELS_ATTRS.csv…"
            />
          </Suspense>

          {noReconocidos.length > 0 && (
            <div className="exp-sub" style={{ color: 'var(--accent)' }}>
              No se reconocieron: {noReconocidos.slice(0, 5).join(', ')}
              {noReconocidos.length > 5 && ` y ${noReconocidos.length - 5} más`}.
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-label">La portada</div>

          <label className="exp-enriq">
            <span className="exp-k">Cliente</span>
            <input
              className="input input-sm"
              value={cliente}
              onChange={(evento) => setCliente(evento.target.value)}
              placeholder="Nombre del cliente"
            />
          </label>

          <label className="exp-enriq">
            <span className="exp-k">Logo</span>
            <input
              type="file"
              className="input input-sm"
              accept="image/*"
              onChange={(evento) => elegirLogo(evento.target.files)}
              aria-label="Logo del cliente"
            />
          </label>
          {logo && (
            <div className="exp-sub">✓ {logo.ancho}×{logo.alto} px</div>
          )}

          <label className="exp-enriq">
            <input
              type="checkbox"
              checked={conTrabajos}
              onChange={(evento) => setConTrabajos(evento.target.checked)}
            />
            <span>
              Incluir los trabajos programados, leídos del tenant
              {tenant && <span className="exp-sub"> ({tenant})</span>}
            </span>
          </label>
        </div>
      </div>

      {conAlgo && (
        <div className="table-scroll">
          <table className="table-dense">
            <thead>
              <tr><th>Sección</th><th>Registros</th><th>Archivo</th><th>Hace falta</th></tr>
            </thead>
            <tbody>
              {recibido.map((una) => (
                <tr key={una.id} className={una.filas === 0 && una.esencial ? 'pa-red' : undefined}>
                  <td>{una.titulo}</td>
                  <td>{una.filas > 0 ? numero(una.filas) : '—'}</td>
                  <td className="exp-sub">{una.archivo || 'no vino'}</td>
                  <td className="exp-sub">{una.esencial ? 'sí' : 'opcional'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {conAlgo && faltan.length > 0 && (
        <div className="notice notice-info">
          Faltan {faltan.length} {faltan.length === 1 ? 'sección' : 'secciones'} de las que hacen que el
          documento diga algo: {faltan.join(', ')}. Se puede generar igual —cada sección que falte sale
          marcada como no incluida—, pero el resumen va a quedar corto.
        </div>
      )}

      <div className="monitor-bar">
        <button
          type="button"
          className="btn btn-sm btn-primary"
          onClick={generar}
          disabled={!conAlgo || Boolean(generando)}
        >
          {generando === 'trabajos' ? 'Leyendo los trabajos…'
            : generando ? 'Armando el documento…'
              : 'Generar el documento'}
        </button>

        {conAlgo && (
          <span className="page-hint">
            {numero(recibido.filter((una) => una.filas > 0).length)} de {SECCIONES.length} secciones
          </span>
        )}

        {hecho && (
          <span className="page-hint">
            ✓ {hecho.nombre} · {numero(hecho.resumen.cifras)} cifras clave,{' '}
            {numero(hecho.resumen.nivelesDePlanificacion)} niveles
            {hecho.resumen.modulos.length > 0 && ` · ${hecho.resumen.modulos.join(', ')}`}
          </span>
        )}
      </div>

      {hecho && (
        <div className="notice notice-ok">
          ✓ El documento lleva un índice que Word rellena al abrirlo. Si sale en blanco, haz clic
          derecho sobre él y «Actualizar campos».
        </div>
      )}
    </div>
  )
}

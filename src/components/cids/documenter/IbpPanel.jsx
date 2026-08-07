// Elegir el tenant de IBP del que sale el enriquecimiento, y en modo Jobs, qué trabajos documentar.
//
// La conexión es opcional: sin ella el documento sale igual, con las dos columnas de IBP vacías.
// Lo que aporta es la etiqueta de cada campo, su tipo de dato y un valor de ejemplo real.

import { useEffect, useState } from 'react'

import { fetchJobTemplates, listIbpConnections, nombreDeJob } from '../../../lib/ibp.js'

export default function IbpPanel({
  conexionId,
  onConexion,
  planArea,
  onPlanArea,
  planAreas,
  catalogo,
  cargandoCatalogo,
  errorCatalogo,
  modoJobs,
  jobsElegidos,
  onJobsElegidos,
}) {
  const [conexiones, setConexiones] = useState(null)
  // Los trabajos se guardan junto al tenant del que salieron, por el mismo motivo que el catálogo:
  // al cambiar de conexión no hay nada que limpiar y nunca se ven los del tenant anterior.
  const [leidos, setLeidos] = useState(null)
  const [busqueda, setBusqueda] = useState('')

  useEffect(() => {
    let abandonado = false
    listIbpConnections()
      .then((lista) => { if (!abandonado) setConexiones(lista) })
      .catch(() => { if (!abandonado) setConexiones([]) })
    return () => { abandonado = true }
  }, [])

  // Los trabajos se piden solo en modo Jobs y solo al cambiar de tenant: son una consulta cara.
  useEffect(() => {
    if (!modoJobs || !conexionId || leidos?.conexionId === conexionId) return undefined

    let abandonado = false
    const guardar = (resultado) => { if (!abandonado) setLeidos({ conexionId, ...resultado }) }

    fetchJobTemplates(conexionId)
      .then((lista) => guardar({ jobs: lista, error: '' }))
      .catch((error) => guardar({ jobs: [], error: error.message }))

    return () => { abandonado = true }
  }, [modoJobs, conexionId, leidos])

  const delTenant = leidos?.conexionId === conexionId ? leidos : null
  const jobs = delTenant?.jobs ?? null
  const errorJobs = delTenant?.error ?? ''
  const cargandoJobs = modoJobs && Boolean(conexionId) && !delTenant

  if (conexiones === null) return <div className="page-hint">Cargando conexiones de IBP…</div>

  if (conexiones.length === 0) {
    return (
      <div className="notice notice-info">
        No hay ninguna conexión a IBP configurada para tu empresa. El documento se puede generar
        igual: las columnas de tipo de dato y ejemplo quedan vacías. Para llenarlas, pedile a quien
        administra la cuenta que dé de alta la conexión en Administración → Conexiones.
      </div>
    )
  }

  const visibles = (jobs ?? []).filter((uno) => (
    nombreDeJob(uno).toLowerCase().includes(busqueda.trim().toLowerCase())
  ))

  function alternarJob(job) {
    const clave = job.JobTemplateName
    onJobsElegidos(jobsElegidos.some((uno) => uno.JobTemplateName === clave)
      ? jobsElegidos.filter((uno) => uno.JobTemplateName !== clave)
      : [...jobsElegidos, job])
  }

  return (
    <div className="card exp-upload">
      <div className="card-title">🔗 Tenant de IBP {!modoJobs && <span className="tag tag-muted">opcional</span>}</div>
      <div className="card-hint">
        {modoJobs
          ? 'El documento sale en el orden en que IBP corre los trabajos que elijas.'
          : 'Completa la etiqueta de cada campo, su tipo de dato y un ejemplo real. Sin tenant, esas columnas quedan vacías.'}
      </div>

      <div className="exp-toolbar-row">
        <select
          className="select input-sm"
          value={conexionId}
          onChange={(evento) => onConexion(evento.target.value)}
          aria-label="Conexión a IBP"
        >
          <option value="">Sin conexión</option>
          {conexiones.map((una) => (
            <option key={una.id} value={una.id}>{una.name}</option>
          ))}
        </select>

        {cargandoCatalogo && <span className="page-hint">Leyendo el catálogo del tenant…</span>}

        {catalogo && (
          <>
            <select
              className="select input-sm"
              value={planArea}
              onChange={(evento) => onPlanArea(evento.target.value)}
              aria-label="Área de planificación"
            >
              <option value="">Área según cada integración</option>
              {planAreas.map((una) => <option key={una} value={una}>{una}</option>)}
            </select>
            <span className="page-hint">
              {Object.keys(catalogo.descs).length} campos en el catálogo
            </span>
          </>
        )}
      </div>

      {errorCatalogo && (
        <div className="notice notice-error">
          ✕ No se pudo leer el catálogo: {errorCatalogo}. El documento se puede generar igual, sin
          las columnas de IBP.
        </div>
      )}

      {catalogo?.fallados?.length > 0 && (
        <div className="notice notice-info">
          Este tenant no contestó por {catalogo.fallados.join(' ni ')}. Se usa lo que devolvieron
          los demás servicios.
        </div>
      )}

      {modoJobs && conexionId && (
        <>
          {errorJobs && <div className="notice notice-error">✕ {errorJobs}</div>}
          {cargandoJobs && <div className="page-hint">Buscando los Application Jobs…</div>}

          {jobs && jobs.length > 0 && (
            <>
              <div className="exp-toolbar-row">
                <input
                  className="input input-sm exp-search"
                  placeholder="🔍 Buscar un trabajo…"
                  value={busqueda}
                  onChange={(evento) => setBusqueda(evento.target.value)}
                />
                <span className="exp-counter">{jobsElegidos.length} de {jobs.length} elegidos</span>
              </div>

              <div className="table-scroll doc-list">
                <table className="table-dense">
                  <thead>
                    <tr><th className="doc-check" /><th>Trabajo</th><th>Plantilla</th><th>Versión</th></tr>
                  </thead>
                  <tbody>
                    {visibles.map((uno) => (
                      <tr key={`${uno.JobTemplateName}-${uno.JobTemplateVersion}`}>
                        <td className="doc-check">
                          <input
                            type="checkbox"
                            checked={jobsElegidos.some((otro) => otro.JobTemplateName === uno.JobTemplateName)}
                            onChange={() => alternarJob(uno)}
                            aria-label={`Documentar ${nombreDeJob(uno)}`}
                          />
                        </td>
                        <td>{nombreDeJob(uno)}</td>
                        <td>{uno.JobTemplateName}</td>
                        <td>{uno.JobTemplateVersion}</td>
                      </tr>
                    ))}
                    {visibles.length === 0 && (
                      <tr><td colSpan={4} className="table-empty">No hay ningún trabajo que coincida.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {jobs && jobs.length === 0 && !errorJobs && (
            <div className="notice notice-info">Este tenant no devolvió ninguna plantilla de trabajo.</div>
          )}
        </>
      )}
    </div>
  )
}

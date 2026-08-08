// Las plantillas de Application Job del tenant: qué se puede lanzar.
//
// Portado de `Jobs.jsx` de v8. Es la mitad de LECTURA de esa pantalla; el diálogo para programar una
// —que es lo único que ESCRIBE en el tenant— va aparte y todavía no está.
//
// Reutiliza el endpoint que ya existía para el documentador de mapeos, así que esta pantalla no
// añadió nada al servidor.
//
// No se muestra el número de pasos: SAP lo devuelve a cero en TODAS las plantillas de este listado
// —comprobado contra un tenant real, 331 de 331— y una columna de ceros diría "sin pasos", que es
// falso. El recuento de verdad está en cada ejecución, en el monitor.

import { useEffect, useMemo, useState } from 'react'

import { formatODataDate } from '../../lib/dates.js'
import { fetchJobTemplates, nombreDeJob } from '../../lib/ibp.js'

/**
 * Las plantillas estándar de SAP empiezan por `/IBP/`; las del cliente, no.
 *
 * La distinción importa: en el tenant de prueba hay 331 plantillas y solo 203 son del cliente. Quien
 * entra a buscar "su" trabajo no quiere leer las 128 de SAP.
 */
const esDeSap = (plantilla) => String(plantilla.JobTemplateName ?? '').startsWith('/IBP/')

export default function JobTemplates({ conexionId, zona }) {
  const [plantillas, setPlantillas] = useState(null)
  const [error, setError] = useState('')
  const [texto, setTexto] = useState('')
  const [incluirDeSap, setIncluirDeSap] = useState(false)

  useEffect(() => {
    let abandonado = false
    fetchJobTemplates(conexionId)
      .then((lista) => { if (!abandonado) setPlantillas(lista) })
      .catch((fallo) => { if (!abandonado) { setError(fallo.message); setPlantillas([]) } })
    return () => { abandonado = true }
  }, [conexionId])

  const visibles = useMemo(() => {
    const buscado = texto.trim().toLowerCase()
    return (plantillas ?? [])
      .filter((una) => incluirDeSap || !esDeSap(una))
      .filter((una) => !buscado || `${nombreDeJob(una)} ${una.JobTemplateName}`.toLowerCase().includes(buscado))
      .sort((a, b) => nombreDeJob(a).localeCompare(nombreDeJob(b)))
  }, [plantillas, texto, incluirDeSap])

  const delCliente = (plantillas ?? []).filter((una) => !esDeSap(una)).length

  if (plantillas === null) return <div className="page-hint">Cargando las plantillas…</div>

  return (
    <div className="module-body">
      <div className="monitor-bar">
        <input
          className="input input-sm exp-search"
          placeholder="🔍 Buscar por nombre…"
          value={texto}
          onChange={(evento) => setTexto(evento.target.value)}
        />
        <label className="exp-check">
          <input
            type="checkbox"
            checked={incluirDeSap}
            onChange={(evento) => setIncluirDeSap(evento.target.checked)}
          />
          Incluir las plantillas estándar de SAP
        </label>
        <span className="page-hint">
          {visibles.length} de {incluirDeSap ? plantillas.length : delCliente}
        </span>
      </div>

      {error && <div className="notice notice-error">✕ {error}</div>}

      <div className="notice notice-info">
        Por ahora esta pantalla solo consulta. Programar un trabajo desde aquí llega en la próxima
        entrega: es lo único de IBP Tools que crea algo en tu tenant y conviene estrenarlo contigo
        delante.
      </div>

      <div className="table-scroll">
        <table className="table-dense">
          <thead>
            <tr>
              <th>Trabajo</th>
              <th>Nombre técnico</th>
              <th>Versión</th>
              <th>Creada</th>
              <th>Última modificación</th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((una) => (
              <tr key={`${una.JobTemplateName}|${una.JobTemplateVersion}`}>
                <td>
                  {nombreDeJob(una)}
                  {esDeSap(una) && <span className="tag tag-muted">estándar</span>}
                </td>
                <td className="mono exp-sub">{una.JobTemplateName}</td>
                <td>{una.JobTemplateVersion ?? '—'}</td>
                <td className="exp-sub">{formatODataDate(una.CreationDateTime, zona)}</td>
                <td className="exp-sub">
                  {formatODataDate(una.LastChangeDateTime, zona)}
                  {una.LastChangeFormattedName && <div>{una.LastChangeFormattedName}</div>}
                </td>
              </tr>
            ))}
            {visibles.length === 0 && (
              <tr><td colSpan={5} className="table-empty">No hay ninguna plantilla que coincida.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

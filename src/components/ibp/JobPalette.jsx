// Las plantillas de trabajo del tenant, para agregarlas a una orquestación.
//
// Es la contraparte de `TaskPalette` de CI-DS: lo ÚNICO que cambia entre orquestar tareas de CI-DS y
// orquestar Application Jobs es de dónde salen los pasos. La lista, el lienzo, las dependencias, los
// grupos y los reintentos son los mismos, y por eso la pantalla se comparte.
//
// Entrega los DATOS del paso, no la plantilla: el lienzo no tiene por qué saber de qué SAP viene.
//
// Sin proyectos que abrir, a diferencia de la de CI-DS: las plantillas de IBP son una lista plana y
// llegan todas de una, así que el buscador es toda la navegación que hace falta.

import { useEffect, useMemo, useState } from 'react'

import { fetchJobTemplates, nombreDeJob } from '../../lib/ibp.js'

export default function JobPalette({ destino, onAgregar, onAgregarGrupo }) {
  const [plantillas, setPlantillas] = useState(null)
  const [error, setError] = useState('')
  const [busqueda, setBusqueda] = useState('')

  useEffect(() => {
    let abandonado = false
    fetchJobTemplates(destino.connectionId)
      .then((lista) => { if (!abandonado) setPlantillas(lista) })
      .catch((fallo) => {
        if (abandonado) return
        setError(fallo.message)
        setPlantillas([])
      })
    return () => { abandonado = true }
  }, [destino.connectionId])

  // Un tenant puede tener trescientas plantillas y la lista no se lee entera: se corta y se busca.
  const visibles = useMemo(() => {
    const texto = busqueda.trim().toUpperCase()
    const todas = plantillas ?? []
    if (!texto) return todas.slice(0, 100)
    return todas
      .filter((una) => `${nombreDeJob(una)} ${una.JobTemplateName}`.toUpperCase().includes(texto))
      .slice(0, 100)
  }, [plantillas, busqueda])

  return (
    <div className="paleta">
      <div className="paleta-cabeza">
        <span className="filtro-titulo">Trabajos</span>
        {onAgregarGrupo && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onAgregarGrupo}
            title="Agregar un grupo: los pasos que metas dentro corren juntos"
          >
            + Grupo
          </button>
        )}
      </div>

      <div className="paleta-buscar">
        <input
          className="input input-sm"
          value={busqueda}
          onChange={(evento) => setBusqueda(evento.target.value)}
          placeholder="Buscar una plantilla"
        />
      </div>

      <div className="paleta-cuerpo">
        {error && <div className="notice notice-error">✕ {error}</div>}
        {plantillas === null && <div className="page-hint">Cargando plantillas…</div>}

        {visibles.map((una) => (
          <button
            type="button"
            className="paleta-proyecto"
            key={una.JobTemplateName}
            title={una.JobTemplateName}
            onClick={() => onAgregar({
              templateName: una.JobTemplateName,
              jobText: nombreDeJob(una),
              label: nombreDeJob(una),
            })}
          >
            <span className="paleta-proyecto-nombre">{nombreDeJob(una)}</span>
          </button>
        ))}

        {plantillas !== null && visibles.length === 0 && (
          <div className="page-hint">
            {busqueda ? `Nada coincide con «${busqueda}».` : 'Este tenant no tiene plantillas de trabajo.'}
          </div>
        )}

        {plantillas !== null && plantillas.length > visibles.length && (
          <div className="page-hint">
            y {plantillas.length - visibles.length} más; afiná la búsqueda para verlas.
          </div>
        )}
      </div>
    </div>
  )
}

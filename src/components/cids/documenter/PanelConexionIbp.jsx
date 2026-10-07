// La conexión a SAP IBP del documentador: «🔌 Conexión SAP IBP (opcional · solo para modos con Jobs)».
//
// Es el primer panel de la pantalla, encima del selector de modo, como en v9. Lo que aporta es la
// etiqueta de cada campo, su tipo de dato, un valor de ejemplo real, y —en los modos con Jobs— los
// Application Jobs.
//
// DESVÍO DELIBERADO DE v9, POR SEGURIDAD. El panel de v9 pedía la URL de la API, el Communication
// User y la contraseña, y los guardaba en el navegador. Aquí las credenciales de SAP viven cifradas en
// Postgres y solo el servidor las descifra, así que en lugar de tres campos de texto se ELIGE una de
// las conexiones dadas de alta en Administración → Conexiones, y «Usar conexión» la carga. El navegador
// nunca ve una contraseña. El resto del panel —el título, el selector de Planning Area con su
// etiqueta y sus estados, los mensajes de estado y el botón— es el de v9.

import { useEffect, useState } from 'react'

import { listIbpConnections } from '../../../lib/ibp.js'
import SelectorDeLista from '../../ui/SelectorDeLista.jsx'

export default function PanelConexionIbp({
  conexionId,
  onConexionElegida,
  usada,
  onUsar,
  cargando,
  catalogo,
  errorCatalogo,
  planArea,
  onPlanArea,
}) {
  const [conexiones, setConexiones] = useState(null)
  const [sinElegir, setSinElegir] = useState(false)

  useEffect(() => {
    let abandonado = false
    listIbpConnections()
      .then((lista) => { if (!abandonado) setConexiones(lista) })
      .catch(() => { if (!abandonado) setConexiones([]) })
    return () => { abandonado = true }
  }, [])

  const planAreas = catalogo?.planAreas ?? []
  const elegida = conexiones?.find((una) => una.id === conexionId) ?? null
  const usadaSeleccion = conexiones?.find((una) => una.id === usada) ?? null

  // Los estados del selector de Planning Area, con las palabras de v9.
  let opcionVacia = '— conecta para cargar —'
  if (cargando) opcionVacia = '— cargando… —'
  else if (usada && catalogo) opcionVacia = planAreas.length > 0 ? '— elegir —' : '— sin planning areas —'

  let estado = null
  if (usada && !cargando && !errorCatalogo && usadaSeleccion) {
    estado = (
      <span className="es-bien">
        ✓ Conexión cargada para {usadaSeleccion.name}.
        {catalogo && planAreas.length > 0 && ` ${planAreas.length} planning areas cargadas — elige una para los ejemplos.`}
        {catalogo && planAreas.length === 0 && ' No se pudieron cargar planning areas; se usará la $G_PLAN_AREA de cada integración.'}
      </span>
    )
  }

  return (
    <div className="card exp-upload">
      <div className="card-title">
        🔌 Conexión SAP IBP{' '}
        <span className="docs-opcional">(opcional · solo para modos con Jobs)</span>
      </div>

      {conexiones === null && <div className="page-hint">Cargando conexiones de IBP…</div>}

      {conexiones !== null && conexiones.length === 0 && (
        <div className="notice notice-info">
          No hay ninguna conexión a IBP configurada para tu empresa. El documento se puede generar
          igual: las columnas de tipo de dato y ejemplo quedan vacías. Para llenarlas, pídele a quien
          administra la cuenta que dé de alta la conexión en Administración → Conexiones.
        </div>
      )}

      {conexiones !== null && conexiones.length > 0 && (
        <div className="docs-conexion-rejilla">
          <label className="docs-campo">
            <span>Conexión</span>
            <SelectorDeLista
              className="select input-sm"
              value={conexionId}
              titulo="Conexión"
              placeholder="— elegir —"
              onChange={(valor) => { setSinElegir(false); onConexionElegida(valor) }}
              options={[
                { value: '', label: '— elegir —' },
                ...conexiones.map((una) => ({ value: una.id, label: una.name })),
              ]}
            />
          </label>

          <label className="docs-campo">
            <span>
              Planning Area <span className="docs-opcional">(para los ejemplos de datos)</span>
            </span>
            <SelectorDeLista
              className="select input-sm"
              value={planArea}
              titulo="Planning Area"
              placeholder={opcionVacia}
              disabled={!catalogo || planAreas.length === 0}
              onChange={onPlanArea}
              options={[
                { value: '', label: opcionVacia },
                ...planAreas.map((una) => ({ value: una, label: una })),
              ]}
            />
          </label>

          <div className="docs-campo">
            <button
              type="button"
              className="btn btn-primary"
              disabled={cargando}
              onClick={() => { if (!elegida) { setSinElegir(true); return } setSinElegir(false); onUsar(elegida) }}
            >
              Usar conexión
            </button>
          </div>
        </div>
      )}

      <div className="docs-conexion-estado">
        {sinElegir && <span className="es-mal">Elige una conexión.</span>}
        {estado}
        {errorCatalogo && (
          <span className="es-mal">
            ✕ No se pudo leer el catálogo: {errorCatalogo}. El documento se puede generar igual, sin
            las columnas de IBP.
          </span>
        )}
        {catalogo?.fallados?.length > 0 && (
          <span className="es-aviso">
            {' '}Este tenant no contestó por {catalogo.fallados.join(' ni ')}. Se usa lo que devolvieron
            los demás servicios.
          </span>
        )}
      </div>
    </div>
  )
}

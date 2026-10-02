// El cuerpo del paso ④ «Campos adicionales de datos maestros»: un botón por tabla y, al pulsarlo, un
// diálogo donde se eligen los campos EXTRA que irán al Excel además de los obligatorios.
//
// Portado de `extraFields.js` de v7 (`efRenderEntityButtons`, `efOpenModal`, `_efRenderList`,
// `efToggleField`, `efModalSave`) y del `<dialog id="efModal">` de su `index.html`.
//
// Es de presentación pura y genérico: no sabe qué tablas hay, qué campos son obligatorios ni dónde se
// guarda la selección —todo llega por props—, así lo usan igual el Production Analyzer y el Network
// Analyzer. En v7 esos datos estaban en tablas globales (`EF_MAND_VISIBLE`, `EF_SEL`…) y se leían del
// DOM (el valor del selector de cada entidad); aquí el que lo monta los resuelve y los pasa.
//
// POR QUÉ `<dialog>` NATIVO Y NO `ui/Modal.jsx`. `#efModal` de v7 es un `<dialog>` con showModal(), y es
// lo que más se le parece: capa superior del navegador, foco atrapado y Escape gratis, sin pelearse con
// el `z-index` del resto. `Modal.jsx` es una superposición con otra estructura (cabecera, cuerpo que
// se desplaza, pie) y otro ancho; adaptarla obligaría a rehacer el diseño del diálogo que ya se
// conoce. Como v7, si el navegador no trae `showModal` se abre con `open = true`.

import { useEffect, useRef, useState } from 'react'

/** v7: el filtro compara en mayúsculas contra el id y contra la descripción, si la hay. */
function coincide(id, descripcion, consulta) {
  if (!consulta) return true
  return id.toUpperCase().includes(consulta) || Boolean(descripcion && descripcion.toUpperCase().includes(consulta))
}

function FilaDeCampo({ campo, descripcion, interruptor, insignia = null }) {
  return (
    <div className="ef-field-item">
      {interruptor}
      <div className="ef-field-info">
        <span className="ef-field-name">{campo}</span>
        {descripcion && <span className="ef-field-desc">{descripcion}</span>}
      </div>
      {insignia}
    </div>
  )
}

/**
 * El diálogo de una tabla. Se monta al abrirse y se desmonta al cerrarse (con `key` = la tabla), así
 * la selección TEMPORAL y el buscador nacen limpios cada vez, igual que `efOpenModal` los reiniciaba.
 */
function DialogoDeCampos({ entidad, obligatorios, ocultos, descripciones, inicial, onGuardar, onCerrar }) {
  const dialogo = useRef(null)
  const [filtro, setFiltro] = useState('')
  // Lo que se va marcando mientras el diálogo está abierto. «Cerrar» lo descarta; «Guardar» lo entrega.
  const [temporal, setTemporal] = useState(() => [...inicial])

  useEffect(() => {
    const el = dialogo.current
    if (!el || el.open) return
    if (typeof el.showModal === 'function') el.showModal()
    else el.open = true
  }, [])

  const reservados = [...obligatorios, ...ocultos]
  const opcionales = (entidad.campos ?? []).filter((campo) => !reservados.includes(campo))

  // v7: `q = filter.trim().toUpperCase()`. El mensaje de «sin resultados» cita el filtro tal cual se escribió.
  const consulta = filtro.trim().toUpperCase()
  const visiblesOpcionales = opcionales.filter((campo) => coincide(campo, descripciones[campo] || '', consulta))

  function alternar(campo, marcado) {
    setTemporal((actual) => {
      const hay = actual.includes(campo)
      if (marcado && !hay) return [...actual, campo]
      if (!marcado && hay) return actual.filter((otro) => otro !== campo)
      return actual
    })
  }

  return (
    // `onClose` se dispara cuando el navegador cierra el diálogo por su cuenta (Escape): hay que
    // desmontarlo también, o el estado de aquí diría «abierto» sobre un diálogo ya cerrado.
    <dialog id="efModal" ref={dialogo} className="connect-dialog ef-fields-dialog" onClose={onCerrar}>
      <div className="connect-dialog-header">
        <span className="connect-dialog-title" id="efModalTitle">{entidad.etiqueta}</span>
        <button type="button" className="dialog-close-btn" onClick={onCerrar} aria-label="Cerrar">✕</button>
      </div>
      <div className="ef-fields-dialog-body">
        <div className="ef-fields-search-wrap">
          <input
            id="efModalSearch"
            type="text"
            placeholder="Buscar por ID o descripción..."
            className="ef-fields-search"
            value={filtro}
            onChange={(evento) => setFiltro(evento.target.value)}
          />
        </div>

        <div id="efModalList" className="ef-fields-list">
          {obligatorios.length > 0 && (
            <>
              <div className="ef-section-label">Campos obligatorios</div>
              {/* v7 aplica el buscador también a los obligatorios. */}
              {obligatorios
                .filter((campo) => coincide(campo, descripciones[campo] || '', consulta))
                .map((campo) => (
                  <FilaDeCampo
                    key={campo}
                    campo={campo}
                    descripcion={descripciones[campo]}
                    interruptor={(
                      <label className="ef-toggle-wrap locked">
                        <input type="checkbox" checked disabled readOnly />
                        <span className="ef-toggle-slider" />
                      </label>
                    )}
                    insignia={<span className="ef-mandatory-badge">Obligatorio</span>}
                  />
                ))}
            </>
          )}

          {visiblesOpcionales.length > 0 && (
            <>
              <div className="ef-section-label">Campos adicionales disponibles</div>
              {visiblesOpcionales.map((campo) => (
                <FilaDeCampo
                  key={campo}
                  campo={campo}
                  descripcion={descripciones[campo]}
                  interruptor={(
                    <label className="ef-toggle-wrap">
                      <input
                        type="checkbox"
                        checked={temporal.includes(campo)}
                        onChange={(evento) => alternar(campo, evento.target.checked)}
                      />
                      <span className="ef-toggle-slider" />
                    </label>
                  )}
                />
              ))}
            </>
          )}
          {visiblesOpcionales.length === 0 && consulta && (
            <p style={{ fontSize: '12px', color: 'var(--text2)', padding: '8px 0' }}>Sin resultados para "{filtro}".</p>
          )}
        </div>

        <div className="ef-fields-footer">
          {/* Cuenta TODA la selección temporal, también lo que el buscador esconde: es lo que se guarda. */}
          <span id="efModalCount" className="ef-fields-count">
            {temporal.length > 0 ? `${temporal.length} campo(s) adicional(es) seleccionado(s)` : ''}
          </span>
          <div className="btn-row" style={{ margin: 0 }}>
            <button type="button" className="btn btn-secondary" onClick={onCerrar}>Cancelar</button>
            <button type="button" className="btn btn-primary" onClick={() => onGuardar(temporal)}>Guardar</button>
          </div>
        </div>
      </div>
    </dialog>
  )
}

/**
 * @param {object} props
 * @param {Array<{ clave: string, etiqueta: string, campos: string[] | null }>} props.entidades
 *        `campos` = todos los campos de la tabla en el tenant; `null` si la entidad no está mapeada
 *        (v7 solo dibujaba el botón de las que tenían selector lleno).
 * @param {Record<string, string[]>} props.obligatorios  Campos obligatorios visibles, por entidad.
 * @param {Record<string, string[]>} props.ocultos       Campos técnicos: siempre se piden, nunca se muestran.
 * @param {Record<string, string>}   props.descripciones Descripción de cada campo, si se conoce.
 * @param {Record<string, string[]>} props.seleccion     Los extras ya elegidos, por entidad.
 * @param {(clave: string, campos: string[]) => void} props.onGuardar
 */
export default function CamposAdicionales({
  entidades,
  obligatorios = {},
  ocultos = {},
  descripciones = {},
  seleccion = {},
  onGuardar,
}) {
  // La clave de la entidad cuyo diálogo está abierto, o `null`.
  const [abierta, setAbierta] = useState(null)

  const conCampos = (entidades ?? []).filter((entidad) => entidad.campos)
  const entidadAbierta = conCampos.find((entidad) => entidad.clave === abierta)

  return (
    <>
      <div className="ef-entity-buttons">
        {conCampos.length === 0 ? (
          <p style={{ fontSize: '12px', color: 'var(--text2)' }}>Configura las entidades en el paso ① para habilitar la selección de campos.</p>
        ) : (
          conCampos.map((entidad) => {
            const extras = (seleccion[entidad.clave] ?? []).length
            return (
              <button
                key={entidad.clave}
                type="button"
                className="btn btn-secondary btn-small"
                onClick={() => setAbierta(entidad.clave)}
              >
                {entidad.etiqueta}
                {extras > 0 && <span className="ef-count-badge">{extras} extra</span>}
              </button>
            )
          })
        )}
      </div>

      {entidadAbierta && (
        <DialogoDeCampos
          key={entidadAbierta.clave}
          entidad={entidadAbierta}
          obligatorios={obligatorios[entidadAbierta.clave] ?? []}
          ocultos={ocultos[entidadAbierta.clave] ?? []}
          descripciones={descripciones}
          inicial={seleccion[entidadAbierta.clave] ?? []}
          onGuardar={(campos) => { onGuardar(entidadAbierta.clave, campos); setAbierta(null) }}
          onCerrar={() => setAbierta(null)}
        />
      )}
    </>
  )
}

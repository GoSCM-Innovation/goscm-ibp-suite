// Lo que trae un archivo de orquestaciones, para revisarlo ANTES de crear nada.
//
// Portado de `ImportOrchestrationsModal.jsx` de v9: las píldoras de resumen, una fila por
// orquestación con su etiqueta, las entradas omitidas con su motivo y el botón «Importar N».
//
// Diferencias, a propósito:
//   - Allí una orquestación repetida podía REEMPLAZAR a la que ya estaba. Aquí nada se pisa nunca:
//     una orquestación se configura una vez y sobrescribirla es una pérdida que no se deshace. La
//     repetida se omite o se trae con un número detrás, y la etiqueta lo dice (OMITIR / RENOMBRAR).
//   - Falta el aviso de «Tenant SAP distinto»: el archivo que escribe esta plataforma no lleva el
//     origen, para que una exportación de pruebas no pueda apuntar en silencio al repositorio
//     productivo. Lo que sí se dice es dónde van a nacer.

import { useMemo, useState } from 'react'
import { clasificarImportacion } from '../../../lib/orchestration-file.js'
import Modal from '../../ui/Modal.jsx'
import './lista.css'

function Pildora({ tono, children }) {
  return <span className={`orq-pildora ${tono}`}>{children}</span>
}

function Etiqueta({ repetida, traerRepetidas }) {
  if (!repetida) return <Pildora tono="ok">NUEVA</Pildora>
  return traerRepetidas
    ? <Pildora tono="aviso">RENOMBRAR</Pildora>
    : <Pildora tono="gris">OMITIR</Pildora>
}

export default function ImportOrchestrationsModal({ parsed, existing, fileName, destino, onConfirm, onCancel }) {
  const [traerRepetidas, setTraerRepetidas] = useState(false)

  // Las filas en el orden del archivo, que es como las espera ver quien lo escribió.
  const filas = useMemo(() => {
    const { nuevas, repetidas } = clasificarImportacion(
      parsed.orchestrations.map((una, indice) => ({ ...una, indice })),
      existing,
    )
    return [
      ...nuevas.map((una) => ({ ...una, repetida: false })),
      ...repetidas.map((una) => ({ ...una, repetida: true })),
    ].sort((a, b) => a.indice - b.indice)
  }, [parsed.orchestrations, existing])

  const nuevas = filas.filter((una) => !una.repetida).length
  const repetidas = filas.length - nuevas
  const entran = nuevas + (traerRepetidas ? repetidas : 0)
  const invalidas = parsed.invalid ?? []

  return (
    <Modal
      wide
      title="Importar orquestaciones"
      subtitle={fileName ? `${fileName}${parsed.sourceConnection?.name ? ` · origen: ${parsed.sourceConnection.name}` : ''}` : undefined}
      onClose={onCancel}
      footer={(
        <>
          <div className="modal-foot-info" />
          <button type="button" className="btn btn-sm" onClick={onCancel}>Cancelar</button>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={() => onConfirm(
              filas.filter((una) => traerRepetidas || !una.repetida),
              traerRepetidas ? 0 : repetidas,
            )}
            disabled={entran === 0}
          >
            {entran > 0 ? `Importar ${entran}` : 'Importar'}
          </button>
        </>
      )}
    >
      <div className="orq-imp-pildoras">
        <Pildora tono="info">{filas.length} en archivo</Pildora>
        <Pildora tono="ok">{nuevas} nuevas</Pildora>
        <Pildora tono="aviso">{repetidas} ya existen</Pildora>
        {invalidas.length > 0 && <Pildora tono="error">{invalidas.length} inválidas</Pildora>}
      </div>

      {filas.length === 0 ? (
        <div className="orq-imp-vacio">El archivo no contiene orquestaciones válidas</div>
      ) : filas.map((una) => (
        <div className="orq-imp-fila" key={una.indice}>
          <div className="orq-imp-que">
            <div className="orq-imp-nombre">{una.name}</div>
            <div className="orq-imp-detalle">
              {una.pasos} nodo{una.pasos === 1 ? '' : 's'} · {una.uniones} conexion{una.uniones === 1 ? '' : 'es'}
            </div>
          </div>
          <Etiqueta repetida={una.repetida} traerRepetidas={traerRepetidas} />
        </div>
      ))}

      {invalidas.length > 0 && (
        <div className="orq-imp-omitidas">
          <div className="orq-imp-omitidas-titulo">Entradas omitidas ({invalidas.length})</div>
          {invalidas.slice(0, 5).map((entrada) => (
            <div className="orq-imp-omitidas-fila" key={entrada.index}>
              #{entrada.index + 1}: {entrada.reason}
            </div>
          ))}
          {invalidas.length > 5 && (
            <div className="orq-imp-omitidas-fila" style={{ marginTop: 2 }}>…y {invalidas.length - 5} más</div>
          )}
        </div>
      )}

      {repetidas > 0 && (
        <div className="orq-imp-estrategia">
          <label>
            <input
              type="checkbox"
              checked={traerRepetidas}
              onChange={(evento) => setTraerRepetidas(evento.target.checked)}
            />
            <span>
              Traer también las {repetidas} repetida{repetidas === 1 ? '' : 's'}, con un número detrás del
              nombre. Lo que ya está <b>no se pisa</b> nunca: una orquestación se configura una vez.
            </span>
          </label>
          <div className="orq-imp-estrategia-ayuda">
            Si está desmarcado, las repetidas se omiten y se conservan las actuales
          </div>
        </div>
      )}

      {/* El archivo no lleva de qué repositorio salió, a propósito: así no puede apuntar en
          silencio al equivocado. Por eso el aviso es de dónde van a caer, no de dónde vienen. */}
      <p className="page-hint" style={{ marginTop: 12 }}>
        Van a nacer en el repositorio donde estás parado
        {destino?.production ? ' — el PRODUCTIVO' : ''}, con identificadores nuevos.
      </p>
    </Modal>
  )
}

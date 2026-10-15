// Editar una integración: su nombre, su carpeta y su body, como formulario o como JSON.
//
// Guardar es EXPLÍCITO (botón «Guardar»), a diferencia de las orquestaciones, que se guardan solas: lo que se
// guarda aquí es lo que se envía a IBP, y que un cambio a medio escribir se guarde sin que nadie lo decida no
// es aceptable. Por la misma razón «Ejecutar» exige tener todo guardado: se ejecuta LO GUARDADO, y el
// historial se refiere a ello.

import { useEffect, useState } from 'react'
import { leerBody, resumenDeBody } from '../../../core/ci/body.js'
import { TEXTOS_DE_CARPETA, opcionesDeCarpeta } from '../../lib/ci.js'
import CampoConLista from './CampoConLista.jsx'
import BarraIbp from './BarraIbp.jsx'
import FormularioDeBloque from './FormularioDeBloque.jsx'
import RevisionIbp from './RevisionIbp.jsx'
import { useIbpDelBody } from './useIbpDelBody.js'

export default function EditorDeIntegracion({
  integracion,
  carpetas = [],
  catalogo = null,
  nivelesDeTiempo = [],
  guardando = false,
  error = '',
  onGuardar,
  onDuplicar,
  onBorrar,
  onEjecutar,
  onSinGuardar,
}) {
  const [nombre, setNombre] = useState(integracion.name)
  const [carpeta, setCarpeta] = useState(integracion.folder)
  const [texto, setTexto] = useState(integracion.body)
  const [vista, setVista] = useState('formulario')

  const leido = leerBody(texto)
  const resumen = resumenDeBody(texto)
  const sucio = nombre !== integracion.name || carpeta !== integracion.folder || texto !== integracion.body
  // Lo que IBP dice de lo que está escrito ahora (no de lo guardado): el aviso aparece mientras se edita.
  const ibp = useIbpDelBody(catalogo, texto)
  const puedeGuardar = sucio && leido.ok && nombre.trim() !== '' && !guardando

  // Avisa al armazón de que hay cambios sin guardar, para que pregunte antes de tirarlos.
  useEffect(() => {
    onSinGuardar?.(sucio)
    return () => onSinGuardar?.(false)
  }, [sucio, onSinGuardar])

  function darFormato() {
    if (!leido.ok) return
    setTexto(JSON.stringify(leido.objeto, null, 2))
  }

  function guardar() {
    onGuardar({
      ...(nombre !== integracion.name ? { name: nombre } : {}),
      ...(carpeta !== integracion.folder ? { folder: carpeta } : {}),
      ...(texto !== integracion.body ? { body: texto } : {}),
    })
  }

  return (
    <div className="ci-editor">
      <div className="ci-editor-cabeza">
        <div className="ci-editor-nombres">
          <div className="field">
            <label htmlFor="ci-nombre">Nombre</label>
            <input id="ci-nombre" className="input" value={nombre} onChange={(evento) => setNombre(evento.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="ci-carpeta">Carpeta</label>
            <CampoConLista
              id="ci-carpeta"
              valor={carpeta}
              opciones={opcionesDeCarpeta(carpetas)}
              textos={TEXTOS_DE_CARPETA}
              titulo="Carpeta"
              onCambiar={setCarpeta}
            />
          </div>
        </div>

        <div className="ci-editor-acciones">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => onEjecutar(ibp?.avisos ?? [])}
            disabled={sucio || !leido.ok}
            title={sucio ? 'Guarda los cambios antes de ejecutar: se ejecuta lo guardado.' : 'Ejecutar esta integración'}
          >
            ▶ Ejecutar
          </button>
          <button type="button" className="btn" onClick={guardar} disabled={!puedeGuardar}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onDuplicar} disabled={sucio} title="Duplicar">
            Duplicar
          </button>
          <button type="button" className="btn btn-ghost btn-danger" onClick={onBorrar} title="Eliminar">
            Eliminar
          </button>
        </div>
      </div>

      {error && <div className="notice notice-error" role="alert">✕ {error}</div>}

      {sucio && <div className="ci-sin-guardar">Cambios sin guardar</div>}

      {resumen.valido && resumen.variables.length > 0 && (
        <div className="ci-variables-usadas">
          <span className="card-hint">Variables (se piden al ejecutar):</span>
          {resumen.variables.map((variable) => <code key={variable} className="mono ci-variable">{`{{${variable}}}`}</code>)}
        </div>
      )}

      <BarraIbp catalogo={catalogo} />
      <RevisionIbp avisos={ibp?.avisos} />

      <div className="tabs ci-tabs-editor" role="tablist">
        {[['formulario', 'Formulario'], ['json', 'JSON']].map(([id, etiqueta]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={vista === id}
            className={`tab${vista === id ? ' active' : ''}`}
            onClick={() => setVista(id)}
          >
            {etiqueta}
          </button>
        ))}
      </div>

      {vista === 'formulario' ? (
        <FormularioDeBloque texto={texto} onCambiar={setTexto} ibp={ibp} nivelesDeTiempo={nivelesDeTiempo} />
      ) : (
        <div className="ci-json">
          <textarea
            className="input mono ci-json-texto"
            spellCheck={false}
            value={texto}
            aria-label="Body en JSON"
            onChange={(evento) => setTexto(evento.target.value)}
          />
          <div className="ci-json-pie">
            {leido.ok
              ? <span className="ci-json-ok">✓ JSON válido · bloque «{leido.clave}»</span>
              : <span className="ci-json-mal" role="alert">✕ {leido.error}</span>}
            <button type="button" className="btn btn-ghost btn-sm" onClick={darFormato} disabled={!leido.ok}>
              Dar formato
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// La paleta del orquestador: las integraciones de la conexión, para agregarlas a la secuencia o al grupo que se está
// llenando. Es la paleta de plantillas del orquestador de IBP (`TemplatePalette`) con las integraciones de CI Tools: el
// buscador, el aviso del «modo grupo», la lista con su «+» y «⊞ Nuevo grupo paralelo» al pie.
//
// Las integraciones se enseñan por carpeta, que es como se organizan en la pestaña «Integraciones». Cada una dice su
// nombre y, debajo, a qué carga y con qué comando: con cuarenta integraciones, el nombre solo no alcanza para distinguirlas.

import { useState } from 'react'
import { arbolDeCarpetas, detalleDeIntegracion } from '../../lib/ci.js'

/** Las carpetas con integraciones, una detrás de otra: la raíz («Sin carpeta») primero y después cada ruta. */
function carpetasPlanas(nodo, salida = []) {
  if (nodo.integraciones.length > 0) salida.push({ ruta: nodo.ruta, integraciones: nodo.integraciones })
  nodo.carpetas.forEach((hija) => carpetasPlanas(hija, salida))
  return salida
}

export default function PaletaDeIntegraciones({ integraciones, onAgregar, onAgregarGrupo, grupoActivo, onCancelarGrupo }) {
  const [buscado, setBuscado] = useState('')
  const carpetas = carpetasPlanas(arbolDeCarpetas(integraciones, buscado))
  const conTitulos = carpetas.length > 1 || carpetas.some((una) => una.ruta !== '')

  return (
    <div className="ci-orq-paleta">
      <div className="ci-orq-paleta-cabeza">
        <div className="ci-orq-titulo">Integraciones</div>
        <input
          type="text"
          className="input ci-orq-buscar"
          placeholder="Buscar integración…"
          aria-label="Buscar integración"
          value={buscado}
          onChange={(evento) => setBuscado(evento.target.value)}
        />
      </div>

      {grupoActivo && (
        <div className="ci-orq-modo-grupo" role="status">
          <span>
            🎯 <strong>Modo grupo activo</strong><br />
            Haz clic en «+» para añadir al grupo
          </span>
          <button type="button" className="ci-orq-mini" onClick={onCancelarGrupo}>✕ Cancelar</button>
        </div>
      )}

      <div className="ci-orq-paleta-cuerpo">
        {integraciones.length === 0 && (
          <div className="ci-orq-paleta-vacia">Todavía no hay integraciones en esta conexión: créalas en la pestaña «Integraciones».</div>
        )}
        {integraciones.length > 0 && carpetas.length === 0 && <div className="ci-orq-paleta-vacia">Sin coincidencias</div>}

        {carpetas.map((carpeta) => (
          <div key={carpeta.ruta}>
            {conTitulos && <div className="ci-orq-paleta-carpeta">{carpeta.ruta || 'Sin carpeta'}</div>}
            {carpeta.integraciones.map((integracion) => (
              <div key={integracion.id} className="ci-orq-paleta-fila">
                <div className="ci-orq-paleta-texto">
                  <div className="ci-orq-paleta-nombre" title={integracion.name}>{integracion.name}</div>
                  <div className="ci-orq-paleta-detalle" title={detalleDeIntegracion(integracion)}>{detalleDeIntegracion(integracion)}</div>
                </div>
                <button
                  type="button"
                  className={`ci-orq-agregar${grupoActivo ? ' en-grupo' : ''}`}
                  aria-label={`${grupoActivo ? 'Agregar al grupo' : 'Agregar a la secuencia'}: ${integracion.name}`}
                  title={grupoActivo ? 'Agregar al grupo seleccionado' : 'Agregar a la secuencia'}
                  onClick={() => onAgregar(integracion)}
                >
                  +
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="ci-orq-paleta-pie">
        <button type="button" className="ci-orq-nuevo-grupo" onClick={onAgregarGrupo}>⊞ Nuevo grupo paralelo</button>
      </div>
    </div>
  )
}

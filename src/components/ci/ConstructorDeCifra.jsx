// Armar la tabla de campos de una carga de cifras clave a partir de lo que IBP dice del área.
//
// Se elige la cifra y las dimensiones del nivel en que se carga, y se genera la tabla:
//
//     PRDID → PRDID      cada dimensión elegida
//     KEYFIGUREDATE → KEYFIGUREDATE   la fecha del periodo (campo de la carga, no de IBP)
//     KFVALUE → ZFACTURAS             el valor, hacia la cifra elegida
//
// Reemplaza la tabla actual (lo dice el botón): es un punto de partida, y el origen de cada dimensión se ajusta
// después en la tabla si en el sistema de origen se llama distinto. Qué dimensiones lleva una carga lo decide
// quien la configura: IBP dice cuáles tiene el área, no en qué nivel se quiere cargar.

import { useState } from 'react'
import { filasDeCifra, leerCifraDeFilas } from '../../lib/ci-ibp.js'
import Modal from '../ui/Modal.jsx'
import SelectorDeLista from '../ui/SelectorDeLista.jsx'

/** Más que esto y la lista de dimensiones lleva buscador. */
const DIMENSIONES_SIN_BUSCADOR = 12

const nombreConEtiqueta = (uno) => (uno.etiqueta ? `${uno.campo} — ${uno.etiqueta}` : uno.campo)

export default function ConstructorDeCifra({ cifras, filas, area, onAplicar, onCerrar }) {
  const [{ cifra: cifraInicial, dimensiones: dimensionesIniciales }] = useState(() => leerCifraDeFilas(filas, cifras))
  const [cifra, setCifra] = useState(cifraInicial)
  const [dimensiones, setDimensiones] = useState(dimensionesIniciales)
  const [buscado, setBuscado] = useState('')

  const consulta = buscado.trim().toUpperCase()
  const visibles = cifras.dims.filter((uno) => !consulta || nombreConEtiqueta(uno).toUpperCase().includes(consulta))

  const alternar = (campo) => setDimensiones((actuales) => (
    actuales.includes(campo) ? actuales.filter((otro) => otro !== campo) : [...actuales, campo]
  ))

  return (
    <Modal
      title="Armar desde las cifras de IBP"
      subtitle={area}
      onClose={onCerrar}
      footer={(
        <>
          <button type="button" className="btn btn-ghost" onClick={onCerrar}>Cancelar</button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={cifra === ''}
            onClick={() => onAplicar(filasDeCifra({ dimensiones, cifra }))}
          >
            Reemplazar la tabla
          </button>
        </>
      )}
    >
      <div className="ci-constructor-cifra">
        <div className="field">
          <label htmlFor="ci-cifra">Cifra clave</label>
          <SelectorDeLista
            id="ci-cifra"
            value={cifra}
            onChange={setCifra}
            titulo="Cifra clave"
            options={[
              { value: '', label: '— Elige una cifra —' },
              ...cifras.cifras.map((una) => ({ value: una.campo, label: nombreConEtiqueta(una) })),
            ]}
          />
        </div>

        <div className="field">
          <span className="ci-etiqueta">Dimensiones del nivel de carga</span>
          {cifras.dims.length > DIMENSIONES_SIN_BUSCADOR && (
            <input
              className="input input-sm"
              value={buscado}
              placeholder="Buscar dimensión…"
              aria-label="Buscar dimensión"
              onChange={(evento) => setBuscado(evento.target.value)}
            />
          )}
          <div className="ci-dimensiones">
            {visibles.map((una) => (
              <label key={una.campo} className="ci-opcion">
                <input type="checkbox" checked={dimensiones.includes(una.campo)} onChange={() => alternar(una.campo)} />
                <span className="mono">{una.campo}</span>
                {una.etiqueta && <span className="card-hint">{una.etiqueta}</span>}
              </label>
            ))}
            {visibles.length === 0 && <span className="card-hint">Sin resultados.</span>}
          </div>
        </div>

        <p className="card-hint">
          Se genera una fila por dimensión elegida, la fecha del periodo (KEYFIGUREDATE) y el valor (KFVALUE) hacia la
          cifra. Reemplaza la tabla de campos actual.
        </p>
      </div>
    </Modal>
  )
}

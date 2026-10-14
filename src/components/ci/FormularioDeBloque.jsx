// El formulario de una integración: los campos del body como controles, en vez de JSON a mano.
//
// Lee el texto del body y devuelve el texto nuevo en cada cambio (`onCambiar`). No guarda estado propio: el
// body es la única fuente, y lo que aquí se ve sale de él. Así el formulario y la pestaña JSON nunca pueden
// decir cosas distintas.
//
// Qué conserva, a propósito:
//   - El orden de las claves: un campo que se edita se cambia en su sitio, y uno nuevo se agrega al final.
//   - Los campos que el formulario no conoce: salen en «Otros campos», se pueden editar y quitar. Si el iFlow
//     acepta uno que aquí no se conoce, no se pierde ni se bloquea.
//   - Los valores que no son texto (un número, una lista) se muestran pero no se editan aquí: se tocan en JSON.

import { leerBody } from '../../../core/ci/body.js'
import { CAMPOS_ESPECIALES, NOMBRES_CON_CONTROL, TIPOS_DE_DATO, camposDe } from '../../../core/ci/campos.js'
import ConstructorDeFiltro from './ConstructorDeFiltro.jsx'
import TablaDeMapeo from './TablaDeMapeo.jsx'

/** Pone un campo en el bloque, en su sitio si ya estaba y al final si es nuevo. No modifica el original. */
function conCampo(bloque, campo, valor) {
  if (Object.hasOwn(bloque, campo)) return Object.fromEntries(Object.entries(bloque).map(([clave, actual]) => [clave, clave === campo ? valor : actual]))
  return { ...bloque, [campo]: valor }
}

/** Pone varios campos a la vez. */
const conCampos = (bloque, campos) => Object.entries(campos).reduce((acumulado, [campo, valor]) => conCampo(acumulado, campo, valor), bloque)

const sinCampo = (bloque, campo) => Object.fromEntries(Object.entries(bloque).filter(([clave]) => clave !== campo))

export default function FormularioDeBloque({ texto, onCambiar, deshabilitado = false }) {
  const leido = leerBody(texto)

  if (!leido.ok) {
    return (
      <div className="notice notice-error" role="alert">
        El body no se puede mostrar como formulario: {leido.error} Corrígelo en la pestaña «JSON».
      </div>
    )
  }

  const { clave, bloque } = leido
  const tipo = typeof bloque.TypeOfData === 'string' ? bloque.TypeOfData : ''
  const textoDe = (campo) => (typeof bloque[campo] === 'string' ? bloque[campo] : '')

  const emitir = (nuevoBloque, nuevaClave = clave) => onCambiar(JSON.stringify({ [nuevaClave]: nuevoBloque }, null, 2))
  const poner = (campo, valor) => emitir(conCampo(bloque, campo, valor))

  const generales = camposDe(tipo).filter((campo) => !campo.fijo)
  const otros = Object.keys(bloque).filter((campo) => !NOMBRES_CON_CONTROL.has(campo))
  // Los que sí tienen control pero no valen para este tipo (por ejemplo `FileName` en un maestro): se editan
  // como «otros» para no esconderlos.
  const deOtraFamilia = Object.keys(bloque).filter((campo) => (
    NOMBRES_CON_CONTROL.has(campo) && !CAMPOS_ESPECIALES.includes(campo) && campo !== 'TypeOfData'
    && !generales.some((una) => una.campo === campo)
  ))

  return (
    <div className="ci-formulario">
      <div className="ci-form-grid">
        <div className="field">
          <label htmlFor="ci-clave">Nombre del bloque</label>
          <input
            id="ci-clave"
            className="input mono"
            value={clave}
            disabled={deshabilitado}
            onChange={(evento) => {
              // Una clave vacía deja el body inválido; se ignora hasta que haya algo.
              const nueva = evento.target.value
              if (nueva.trim() !== '') emitir(bloque, nueva)
            }}
          />
          <span className="card-hint">La clave de primer nivel del body (PRODUCT, KEYFIGURE…). Se envía tal cual.</span>
        </div>

        <div className="field">
          <label htmlFor="ci-tipo">Tipo de dato</label>
          <input
            id="ci-tipo"
            className="input mono"
            list="ci-tipos-de-dato"
            value={tipo}
            disabled={deshabilitado}
            onChange={(evento) => poner('TypeOfData', evento.target.value)}
          />
          <datalist id="ci-tipos-de-dato">
            {Object.entries(TIPOS_DE_DATO).map(([valor, nombre]) => <option key={valor} value={valor}>{nombre}</option>)}
          </datalist>
          <span className="card-hint">Decide qué campos se muestran: {Object.keys(TIPOS_DE_DATO).join(' o ')}.</span>
        </div>
      </div>

      <section className="ci-seccion">
        <h3 className="ci-seccion-titulo">Datos generales</h3>
        <div className="ci-form-grid">
          {generales.map((campo) => (
            <div className="field" key={campo.campo}>
              <label htmlFor={`ci-${campo.campo}`}>{campo.etiqueta}</label>
              <input
                id={`ci-${campo.campo}`}
                className="input mono"
                list={campo.sugerencias ? `ci-sug-${campo.campo}` : undefined}
                value={textoDe(campo.campo)}
                disabled={deshabilitado}
                onChange={(evento) => poner(campo.campo, evento.target.value)}
              />
              {campo.sugerencias && (
                <datalist id={`ci-sug-${campo.campo}`}>
                  {campo.sugerencias.map((valor) => <option key={valor} value={valor} />)}
                </datalist>
              )}
              <span className="card-hint mono">{campo.campo}{campo.ayuda ? ` · ${campo.ayuda}` : ''}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="ci-seccion">
        <h3 className="ci-seccion-titulo">Campos y mapeo</h3>
        <TablaDeMapeo
          bloque={bloque}
          deshabilitado={deshabilitado}
          onCambiar={(listas) => emitir(conCampos(bloque, listas))}
        />
      </section>

      <section className="ci-seccion">
        <h3 className="ci-seccion-titulo">Filtro de la fuente de datos</h3>
        <ConstructorDeFiltro
          valor={textoDe('FilterForTheDataSource')}
          deshabilitado={deshabilitado}
          onCambiar={(filtro) => poner('FilterForTheDataSource', filtro)}
        />
        <p className="card-hint">
          Los valores pueden ser una variable, como {'{{FECHA_DESDE}}'}: se pide su valor al ejecutar.
        </p>
      </section>

      {(otros.length > 0 || deOtraFamilia.length > 0 || !deshabilitado) && (
        <section className="ci-seccion">
          <h3 className="ci-seccion-titulo">Otros campos</h3>
          {[...deOtraFamilia, ...otros].map((campo) => (
            <div className="ci-otro" key={campo}>
              <code className="mono ci-otro-nombre">{campo}</code>
              {typeof bloque[campo] === 'string' ? (
                <input
                  className="input input-sm mono"
                  value={bloque[campo]}
                  disabled={deshabilitado}
                  aria-label={campo}
                  onChange={(evento) => poner(campo, evento.target.value)}
                />
              ) : (
                <code className="mono ci-otro-valor" title="No es texto: se edita en la pestaña JSON">
                  {JSON.stringify(bloque[campo])}
                </code>
              )}
              {!deshabilitado && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm ci-quitar"
                  onClick={() => emitir(sinCampo(bloque, campo))}
                  title="Quitar el campo"
                  aria-label={`Quitar ${campo}`}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          {!deshabilitado && <CampoNuevo existentes={Object.keys(bloque)} onAgregar={(campo) => poner(campo, '')} />}
        </section>
      )}
    </div>
  )
}

/** Agrega un campo que el formulario no conoce. */
function CampoNuevo({ existentes, onAgregar }) {
  function agregar(evento) {
    evento.preventDefault()
    const campo = new FormData(evento.currentTarget).get('campo')?.toString().trim()
    if (!campo || existentes.includes(campo)) return
    onAgregar(campo)
    evento.currentTarget.reset()
  }

  return (
    <form className="ci-otro-nuevo" onSubmit={agregar}>
      <input name="campo" className="input input-sm mono" placeholder="NombreDelCampo" aria-label="Nombre del campo nuevo" />
      <button type="submit" className="btn btn-sm">+ Agregar campo</button>
    </form>
  )
}

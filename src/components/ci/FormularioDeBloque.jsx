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
//
// Con `ibp` (lo que IBP dice de este body, ver `useIbpDelBody`) el área, la versión y la tabla se eligen de las de
// IBP, los campos se eligen de la tabla o del área y los valores del filtro se sugieren. Todo sigue siendo
// editable a mano: sin `ibp` el formulario es el de siempre.

import { leerBody } from '../../../core/ci/body.js'
import { CAMPOS_ESPECIALES, NOMBRES_CON_CONTROL, TIPOS_DE_DATO, camposDe } from '../../../core/ci/campos.js'
import { CAMPO_DE_PERIODO, componerTipo, descomponerTipo } from '../../../core/ci/ibp-nombres.js'
import { conValorActual, opcionesDeAreas, opcionesDeTablas, opcionesDeVersiones, tablasDeVersion, esVariable } from '../../lib/ci-ibp.js'
import SelectorDeLista from '../ui/SelectorDeLista.jsx'
import CampoConIbp from './CampoConIbp.jsx'
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

export default function FormularioDeBloque({ texto, onCambiar, deshabilitado = false, ibp = null, nivelesDeTiempo = [] }) {
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

  // Lo que se elige de IBP. El área manda: sin ella (o con una que IBP no tiene) no hay versiones ni tablas que ofrecer.
  const area = ibp?.area ?? null
  const tablasDelArea = area ? tablasDeVersion(area, esVariable(textoDe('PlanningAreaVersion')) ? '' : textoDe('PlanningAreaVersion')) : []
  const tablaActual = componerTipo(textoDe('MasterDataPrefix'), textoDe('MasterDataType'))

  /** El control de un campo general: el de IBP si lo hay, y si no el cuadro de texto de siempre. */
  function controlDe(campo) {
    const id = `ci-${campo.campo}`

    if (ibp && campo.campo === 'PlanningArea' && ibp.areas.length > 0) {
      return (
        <CampoConIbp
          id={id}
          valor={textoDe('PlanningArea')}
          opciones={opcionesDeAreas(ibp.areas)}
          deshabilitado={deshabilitado}
          titulo="Área de planificación"
          onCambiar={(valor) => poner('PlanningArea', valor)}
        />
      )
    }

    if (ibp && campo.campo === 'PlanningAreaVersion' && area) {
      return (
        <CampoConIbp
          id={id}
          valor={textoDe('PlanningAreaVersion')}
          opciones={opcionesDeVersiones(area)}
          deshabilitado={deshabilitado}
          titulo="Versión"
          onCambiar={(valor) => poner('PlanningAreaVersion', valor)}
        />
      )
    }

    const sugerencias = campo.campo === 'TargetTimeProfileLevelinSAPIBP' && nivelesDeTiempo.length > 0
      ? nivelesDeTiempo
      : campo.sugerencias
    return (
      <>
        <input
          id={id}
          className="input mono"
          list={sugerencias ? `ci-sug-${campo.campo}` : undefined}
          value={textoDe(campo.campo)}
          disabled={deshabilitado}
          onChange={(evento) => poner(campo.campo, evento.target.value)}
        />
        {sugerencias && (
          <datalist id={`ci-sug-${campo.campo}`}>
            {sugerencias.map((valor) => <option key={valor} value={valor} />)}
          </datalist>
        )}
      </>
    )
  }

  /** Elegir la tabla de IBP rellena el prefijo y el tipo, que en el body van aparte. */
  function elegirTabla(tabla) {
    if (tabla === '') return
    const { prefijo, tipo: tipoDeMaestro } = descomponerTipo(tabla, area.prefijo)
    emitir(conCampos(bloque, { MasterDataPrefix: prefijo, MasterDataType: tipoDeMaestro }))
  }

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
              {controlDe(campo)}
              <span className="card-hint mono">
                {campo.campo}{campo.ayuda ? ` · ${campo.ayuda}` : ''}
                {campo.campo === 'TargetTimeProfileLevelinSAPIBP' && nivelesDeTiempo.length > 0 && ' · se sugieren los que ya usan otras integraciones de esta conexión'}
              </span>
            </div>
          ))}

          {ibp && tipo === 'MASTERDATA' && area && (
            <div className="field">
              <label htmlFor="ci-tabla-ibp">Tabla de IBP</label>
              <SelectorDeLista
                id="ci-tabla-ibp"
                className="select"
                value={tablaActual}
                options={conValorActual(opcionesDeTablas(tablasDelArea), tablaActual)}
                disabled={deshabilitado}
                titulo="Tabla de dato maestro"
                onChange={elegirTabla}
              />
              <span className="card-hint">Rellena el prefijo y el tipo de maestro, que también se pueden escribir a mano.</span>
            </div>
          )}
        </div>
      </section>

      <section className="ci-seccion">
        <h3 className="ci-seccion-titulo">Campos y mapeo</h3>
        <TablaDeMapeo
          bloque={bloque}
          deshabilitado={deshabilitado}
          ibp={ibp && {
            tipo: ibp.tipo,
            area: area?.id ?? '',
            entidad: ibp.tabla,
            campos: ibp.campos,
            cifras: ibp.cifras,
            cargando: ibp.cargando,
            error: ibp.error,
          }}
          onCambiar={(listas) => emitir(conCampos(bloque, listas))}
        />
      </section>

      <section className="ci-seccion">
        <h3 className="ci-seccion-titulo">Filtro de la fuente de datos</h3>
        <ConstructorDeFiltro
          valor={textoDe('FilterForTheDataSource')}
          deshabilitado={deshabilitado}
          ibp={ibp && valoresDeIbp(ibp)}
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

/**
 * Cómo el filtro pide a IBP los valores de un campo.
 *
 * `puede` dice si vale la pena ofrecerlo: `false` si el campo seguro no es de IBP, `null` si no se sabe (se ofrece y
 * el servidor dice qué hay). En dato maestro se pregunta a la tabla elegida; en cifras clave, al área, que busca el
 * campo en sus tablas de atributos. La fecha del periodo nunca: es un rango, no una lista.
 */
function valoresDeIbp(ibp) {
  return {
    puede: (campo) => {
      if (campo.toUpperCase() === CAMPO_DE_PERIODO) return false
      if (ibp.tipo === 'MASTERDATA') {
        if (!ibp.tabla) return false
        return ibp.campos ? ibp.campos.some((uno) => uno.campo.toUpperCase() === campo.toUpperCase()) : null
      }
      return ibp.tipo === 'KEYFIGURES' && ibp.area ? null : false
    },
    leer: (campo) => ibp.leer('valores', ibp.tipo === 'MASTERDATA' ? { entidad: ibp.tabla, campo } : { area: ibp.area.id, campo }),
  }
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

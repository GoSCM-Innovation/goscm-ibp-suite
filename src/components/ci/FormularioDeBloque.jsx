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
// El tipo de dato manda sobre qué campos tiene el formulario: al cambiarlo se quitan los campos que solo valen para
// el otro tipo y aparecen, vacíos, los del nuevo (con confirmación si lo que se quita tiene valor).
//
// Con `ibp` (lo que IBP dice de este body, ver `useIbpDelBody`) el área, la versión y el tipo de maestro se eligen de
// los de IBP, los campos se eligen de la tabla o del área y los valores del filtro se sugieren. Elegir otro tipo de
// maestro de la lista también ajusta el mapeo a los campos de esa tabla. Todo sigue siendo editable a mano: sin `ibp`
// el formulario es el de siempre.

import { useEffect, useRef, useState } from 'react'
import { leerBody } from '../../../core/ci/body.js'
import { CAMPOS_CONOCIDOS, CAMPOS_ESPECIALES, NOMBRES_CON_CONTROL, TIPOS_DE_DATO, camposDe } from '../../../core/ci/campos.js'
import { CAMPO_DE_PERIODO, componerTipo } from '../../../core/ci/ibp-nombres.js'
import { escribirMapeo, leerMapeo } from '../../../core/ci/mapping.js'
import { esVariable, mapeoParaTabla, opcionesDeAreas, opcionesDeTipos, opcionesDeVersiones } from '../../lib/ci-ibp.js'
import CampoConLista from './CampoConLista.jsx'
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

/** Lo que dicen los controles cuya lista sale de IBP. */
const TEXTOS_DE_IBP = { lista: 'Elegir de IBP', aviso: 'No está en IBP.', sufijo: 'no está en IBP' }

/** Las opciones del tipo de dato: las dos familias, con su nombre y el valor que se envía. */
const OPCIONES_DE_TIPO_DE_DATO = [
  { value: '', label: '— Elige un tipo —' },
  ...Object.entries(TIPOS_DE_DATO).map(([valor, nombre]) => ({ value: valor, label: `${nombre} (${valor})` })),
]

/** Las opciones de un campo con lista de sugerencias: la lista, con «sin elegir» primero. */
const opcionesDeSugerencias = (sugerencias, sinElegir) => [
  { value: '', label: sinElegir },
  ...sugerencias.map((valor) => ({ value: valor, label: valor })),
]

/**
 * El bloque con otro tipo de dato: se quitan los campos que solo valen para los otros tipos, el tipo cambia y los
 * campos propios del nuevo tipo que no estaban se agregan vacíos justo después de `TypeOfData`. Lo demás no se toca.
 */
function conTipoDeDato(bloque, nuevo, quitar, agregar) {
  const resultado = {}
  const nuevos = Object.fromEntries(agregar.map((campo) => [campo, '']))
  let puesto = false
  for (const [clave, valor] of Object.entries(bloque)) {
    if (quitar.includes(clave)) continue
    resultado[clave] = clave === 'TypeOfData' ? nuevo : valor
    if (clave === 'TypeOfData') {
      Object.assign(resultado, nuevos)
      puesto = true
    }
  }
  if (!puesto) Object.assign(resultado, { TypeOfData: nuevo }, nuevos)
  return resultado
}

export default function FormularioDeBloque({ texto, onCambiar, deshabilitado = false, ibp = null, nivelesDeTiempo = [] }) {
  // Elegir un tipo de maestro lee los campos de su tabla antes de cambiar nada, y mientras tanto la persona puede seguir
  // escribiendo. Por eso lo que se cambia al volver se aplica sobre el texto de AHORA y no sobre el de cuando se pulsó
  // (`textoActual`), y una elección que ya no es la última, o que se quedó sin pantalla, se descarta (`eleccion`).
  const [leyendoTabla, setLeyendoTabla] = useState('')
  const textoActual = useRef(texto)
  const eleccion = useRef(0)
  useEffect(() => { textoActual.current = texto })
  useEffect(() => () => { eleccion.current += 1 }, [])

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
  const tiposDelArea = area ? opcionesDeTipos(area, esVariable(textoDe('PlanningAreaVersion')) ? '' : textoDe('PlanningAreaVersion')) : []

  /** La explicación de un campo, para el cursor: lo que dice el campo y, si hay IBP, lo que hace elegir de la lista. */
  const ayudaDe = (campo) => [
    campo.ayuda,
    ibp && campo.campo === 'MasterDataType' && tiposDelArea.length > 1
      ? 'Al elegir de la lista se rellenan también el prefijo y los campos del mapeo.' : '',
    campo.campo === 'TargetTimeProfileLevelinSAPIBP' && nivelesDeTiempo.length > 0
      ? 'La lista trae los que ya usan otras integraciones de esta conexión.' : '',
  ].filter(Boolean).join(' ') || undefined

  /** El control de un campo general: el de IBP si lo hay, y si no el cuadro de texto de siempre. */
  function controlDe(campo) {
    const id = `ci-${campo.campo}`

    if (ibp && campo.campo === 'PlanningArea' && ibp.areas.length > 0) {
      return (
        <CampoConLista
          id={id}
          valor={textoDe('PlanningArea')}
          opciones={opcionesDeAreas(ibp.areas)}
          deshabilitado={deshabilitado}
          textos={TEXTOS_DE_IBP}
          titulo="Área de planificación"
          onCambiar={(valor) => poner('PlanningArea', valor)}
        />
      )
    }

    if (ibp && campo.campo === 'PlanningAreaVersion' && area) {
      return (
        <CampoConLista
          id={id}
          valor={textoDe('PlanningAreaVersion')}
          opciones={opcionesDeVersiones(area)}
          deshabilitado={deshabilitado}
          textos={TEXTOS_DE_IBP}
          titulo="Versión"
          onCambiar={(valor) => poner('PlanningAreaVersion', valor)}
        />
      )
    }

    // El tipo de maestro es la tabla de IBP: se elige de las que se pueden cargar en esa versión del área, y elegirla
    // rellena también el prefijo. Escribirlo a mano sigue siendo posible y no toca el prefijo.
    if (ibp && campo.campo === 'MasterDataType' && tiposDelArea.length > 1) {
      return (
        <CampoConLista
          id={id}
          valor={textoDe('MasterDataType')}
          opciones={tiposDelArea}
          deshabilitado={deshabilitado}
          textos={TEXTOS_DE_IBP}
          titulo="Tipo de maestro"
          onCambiar={(valor) => poner('MasterDataType', valor)}
          alElegir={elegirTipo}
        />
      )
    }

    // Un campo con lista de valores (el comando, el nivel de tiempo) se elige de la lista COMPLETA. Un cuadro de texto
    // con sugerencias del navegador filtra por lo que ya está escrito y esconde las demás opciones.
    if (campo.campo === 'BatchCommand' && campo.sugerencias) {
      return (
        <CampoConLista
          id={id}
          valor={textoDe('BatchCommand')}
          opciones={opcionesDeSugerencias(campo.sugerencias, '— Elige un comando —')}
          deshabilitado={deshabilitado}
          textos={{ aviso: 'No es uno de los comandos conocidos.' }}
          titulo="Comando"
          onCambiar={(valor) => poner('BatchCommand', valor)}
        />
      )
    }

    // El nivel de tiempo es libre: un valor que ninguna otra integración usa es válido, así que no se avisa.
    if (campo.campo === 'TargetTimeProfileLevelinSAPIBP' && nivelesDeTiempo.length > 0) {
      return (
        <CampoConLista
          id={id}
          valor={textoDe('TargetTimeProfileLevelinSAPIBP')}
          opciones={opcionesDeSugerencias(nivelesDeTiempo, '— Elige un nivel —')}
          deshabilitado={deshabilitado}
          textos={{ aviso: '', sufijo: 'no lo usa otra integración' }}
          titulo="Nivel del perfil de tiempo"
          onCambiar={(valor) => poner('TargetTimeProfileLevelinSAPIBP', valor)}
        />
      )
    }

    return (
      <input
        id={id}
        className="input mono"
        value={textoDe(campo.campo)}
        disabled={deshabilitado}
        onChange={(evento) => poner(campo.campo, evento.target.value)}
      />
    )
  }

  /**
   * Cambiar el tipo de dato cambia los campos del formulario: se quitan los que solo valen para el otro tipo y
   * aparecen vacíos los del nuevo. Si lo que se quita tiene valor se pregunta antes: nada se guarda hasta «Guardar»,
   * pero un clic suelto no debería borrar lo escrito.
   */
  function cambiarTipoDeDato(nuevo) {
    if (nuevo === '' || nuevo === tipo) return
    const aQuitar = CAMPOS_CONOCIDOS.filter((una) => una.solo && una.solo !== nuevo && Object.hasOwn(bloque, una.campo))
    const conValor = aQuitar.filter((una) => bloque[una.campo] !== '')
    if (conValor.length > 0) {
      const lista = conValor.map((una) => una.campo).join(', ')
      if (!window.confirm(`Al cambiar a «${TIPOS_DE_DATO[nuevo]}» se quitan estos campos, que tienen valor: ${lista}. ¿Cambiar?`)) return
    }
    const aAgregar = CAMPOS_CONOCIDOS.filter((una) => una.solo === nuevo && !Object.hasOwn(bloque, una.campo))
    emitir(conTipoDeDato(bloque, nuevo, aQuitar.map((una) => una.campo), aAgregar.map((una) => una.campo)))
  }

  /**
   * Elegir el tipo de la lista de IBP rellena también el prefijo, que en el body va aparte, y ajusta el mapeo a los
   * campos de la nueva tabla (ver `mapeoParaTabla`). Todo en un solo cambio.
   *
   * Si los campos no se pueden leer, o las tres listas del mapeo no coinciden entre sí (no se sabe cuál era la buena, y
   * no se arregla solo), solo cambian el tipo y el prefijo.
   */
  async function elegirTipo(tipoDeMaestro) {
    const opcion = tiposDelArea.find((una) => una.value === tipoDeMaestro)
    if (!opcion || opcion.value === '') return

    const tabla = componerTipo(opcion.prefijo, opcion.value)
    const esta = eleccion.current + 1
    eleccion.current = esta
    setLeyendoTabla(tabla)

    let campos = null
    try {
      campos = (await ibp.leer('campos-maestro', { entidad: tabla })).campos
    } catch {
      // Sin los campos de la tabla solo cambia el tipo: el mapeo se queda y la revisión avisa de lo que no cuadre.
    }
    if (eleccion.current !== esta) return
    setLeyendoTabla('')

    const ahora = leerBody(textoActual.current)
    if (!ahora.ok) return
    const cambios = { MasterDataPrefix: opcion.prefijo, MasterDataType: opcion.value }
    const mapeo = leerMapeo(ahora.bloque)
    const tablaDeAhora = componerTipo(
      typeof ahora.bloque.MasterDataPrefix === 'string' ? ahora.bloque.MasterDataPrefix.trim() : '',
      typeof ahora.bloque.MasterDataType === 'string' ? ahora.bloque.MasterDataType.trim() : '',
    )
    if (campos && mapeo.coherente && tablaDeAhora.toUpperCase() !== tabla.toUpperCase()) {
      Object.assign(cambios, escribirMapeo(mapeoParaTabla(mapeo.filas, campos)))
    }
    onCambiar(JSON.stringify({ [ahora.clave]: conCampos(ahora.bloque, cambios) }, null, 2))
  }

  return (
    <div className="ci-formulario">
      <div className="ci-form-grid">
        <div className="field">
          <label htmlFor="ci-clave" title="La clave de primer nivel del body (PRODUCT, KEYFIGURE…). Se envía tal cual.">Nombre del bloque</label>
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
        </div>

        <div className="field">
          <label htmlFor="ci-tipo" title="Al cambiarlo, el formulario cambia los campos que corresponden a ese tipo.">Tipo de dato</label>
          <CampoConLista
            id="ci-tipo"
            valor={tipo}
            opciones={OPCIONES_DE_TIPO_DE_DATO}
            deshabilitado={deshabilitado}
            textos={{ aviso: 'No es uno de los tipos conocidos.' }}
            titulo="Tipo de dato"
            onCambiar={(valor) => poner('TypeOfData', valor)}
            alElegir={cambiarTipoDeDato}
          />
        </div>
      </div>

      <section className="ci-seccion">
        <h3 className="ci-seccion-titulo">Datos generales</h3>
        <div className="ci-form-grid">
          {generales.map((campo) => (
            <div className="field" key={campo.campo}>
              {/* El nombre técnico va en la propia etiqueta y la explicación, al pasar el cursor: una línea de ayuda
                  bajo cada campo hacía el formulario el doble de alto. */}
              <label htmlFor={`ci-${campo.campo}`} title={ayudaDe(campo)}>
                {campo.etiqueta}
                <span className="ci-campo-tecnico">{campo.campo}</span>
              </label>
              {controlDe(campo)}
              {campo.campo === 'MasterDataType' && leyendoTabla && (
                <span className="card-hint">Leyendo los campos de {leyendoTabla}…</span>
              )}
            </div>
          ))}
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

      {(otros.length > 0 || deOtraFamilia.length > 0) && (
        <section className="ci-seccion">
          <h3 className="ci-seccion-titulo">Otros campos</h3>
          <p className="card-hint">Campos del body que este formulario no conoce. Se conservan y se envían tal cual.</p>
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

      {/* Sin campos extra no hay sección: solo el enlace, para agregar uno a mano sin pasar por el JSON. */}
      {otros.length === 0 && deOtraFamilia.length === 0 && !deshabilitado && (
        <AgregarCampoExtra existentes={Object.keys(bloque)} onAgregar={(campo) => poner(campo, '')} />
      )}
    </div>
  )
}

/** El enlace que abre el formulario para agregar un campo que el formulario no conoce, cuando todavía no hay ninguno. */
function AgregarCampoExtra({ existentes, onAgregar }) {
  const [abierto, setAbierto] = useState(false)
  if (!abierto) {
    return (
      <div>
        <button type="button" className="ci-enlace" onClick={() => setAbierto(true)}>
          + Agregar un campo que no está en el formulario
        </button>
      </div>
    )
  }
  return (
    <section className="ci-seccion">
      <h3 className="ci-seccion-titulo">Campo extra</h3>
      <p className="card-hint">Escribe el nombre exacto del campo, como lo espera el iFlow. Después le pones el valor.</p>
      <CampoNuevo existentes={existentes} onAgregar={onAgregar} />
    </section>
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

// Planning Area Documenter: de los CSV del «Download Configuration File» de SAP IBP a un Word.
//
// Portado de la pestaña `tab-padoc` de v7 (`index.html`) y de la sección 9 («UI») de `paDoc.js`, y es
// la MISMA pantalla: cuatro paneles —archivos, portada, datos en vivo, generar— con sus mismos títulos,
// textos, controles y mensajes de registro. Decisión del usuario del 2026-10-01: «Data Tools tiene que
// ser idéntico a v7». Los textos están en español neutro y los de v7 que ya lo eran se copian tal cual.
//
// Por qué los datos vienen de archivos y no de la API: la configuración de un área —niveles de
// planificación, definiciones de cálculo, operadores— no está expuesta en los servicios de comunicación
// de IBP. Se exporta con «Download Configuration File». Es una limitación de SAP.
//
// Lo que sí se lee en vivo, si hay conexión y se pide, es la volumetría de los datos maestros
// (SAP_COM_0720) y los Application Jobs (SAP_COM_0326). Las llamadas salen del servidor.
//
// Lo cargado vive en `pa-doc-sesion.js` y no en el estado de este componente, para que sobreviva a
// cambiar de aplicación, como en v7. Ver allí.

import { useEffect, useRef, useState } from 'react'

import { estadoDeSecciones } from '../../../core/ibp/pa-doc-model.js'
import { estaConectado, useConexionActiva } from '../../lib/conexion-activa.js'
import {
  cargarMarca, descargarDocumento, generarDocumento, ingerirArchivos, leerLogo,
} from '../../lib/pa-doc.js'
import { enriquecerDocumento } from '../../lib/pa-doc-enriquecer.js'
import {
  cambiar, guardarMarca, limpiar, marcaGoscm, registrar, sesionPaDoc, useSesionPaDoc,
} from '../../lib/pa-doc-sesion.js'
import { IDIOMA_DEL_DOCUMENTO } from '../../lib/pa-doc-textos.js'

/** Dónde está el logo de GoSCM que se incrusta en la portada. */
const URL_DE_LA_MARCA = `${import.meta.env.BASE_URL}logo-goscm.png`

export default function PlanningAreaDoc() {
  const sesion = useSesionPaDoc()
  const conexion = useConexionActiva()
  const conectado = estaConectado(conexion)

  const [encima, setEncima] = useState(false)
  const entradaDeCsv = useRef(null)
  const entradaDeLogo = useRef(null)
  const registroEl = useRef(null)

  const { estado, logo, lineas, generando } = sesion
  const hayDatos = Object.keys(estado.datos).length > 0

  // Sin conexión el interruptor se desmarca, como `updateEnrichUI` de v7. Mientras el efecto no corre,
  // `marcado` ya lo da por desmarcado, así que no hay un dibujo con el interruptor marcado y deshabilitado.
  useEffect(() => {
    if (!conectado) cambiar({ enriquecer: false })
  }, [conectado])
  const marcado = conectado && sesion.enriquecer

  // El registro siempre enseña lo último.
  useEffect(() => {
    if (registroEl.current) registroEl.current.scrollTop = registroEl.current.scrollHeight
  }, [lineas])

  async function recibirArchivos(lista) {
    const { default: JSZip } = await import('jszip')
    await ingerirArchivos(lista, {
      JSZip,
      obtenerEstado: () => sesionPaDoc().estado,
      guardarEstado: (nuevo) => cambiar({ estado: nuevo }),
      registro: registrar,
    })
  }

  async function elegirLogo(archivo) {
    if (!archivo) { cambiar({ logo: null }); return }
    try {
      const leido = await leerLogo(archivo)
      if (!leido) {
        // v7 aceptaba cualquier cosa y la metía como PNG; una imagen de otro formato sale rota en Word.
        registrar('err', 'Logo no válido: solo se admite PNG o JPG.')
        if (entradaDeLogo.current) entradaDeLogo.current.value = ''
        return
      }
      cambiar({ logo: leido })
    } catch (fallo) {
      registrar('err', `Error con ${archivo.name}: ${fallo.message}`)
    }
  }

  function quitarLogo() {
    cambiar({ logo: null })
    if (entradaDeLogo.current) entradaDeLogo.current.value = ''
  }

  function limpiarTodo() {
    limpiar()
    if (entradaDeCsv.current) entradaDeCsv.current.value = ''
    if (entradaDeLogo.current) entradaDeLogo.current.value = ''
  }

  async function generar() {
    const actual = sesionPaDoc()
    if (Object.keys(actual.estado.datos).length === 0) {
      registrar('err', 'Carga primero los CSV del Download Configuration File.')
      return
    }

    cambiar({ generando: true })
    try {
      // Datos en vivo opcionales: cada fuente es independiente y su fallo no aborta la generación.
      const enriquecimiento = marcado
        ? await enriquecerDocumento({
          conexionId: conexion.connectionId, datos: actual.estado.datos, registro: registrar,
        })
        : null

      if (!marcaGoscm()) guardarMarca(await cargarMarca(URL_DE_LA_MARCA))

      registrar('info', `Construyendo documento (${IDIOMA_DEL_DOCUMENTO})…`)
      const { buffer, nombre } = await generarDocumento({
        estado: sesionPaDoc().estado,
        meta: { cliente: actual.cliente, autor: actual.autor, version: actual.version },
        enriquecimiento,
        logo: sesionPaDoc().logo,
        marca: marcaGoscm(),
      })

      descargarDocumento(buffer, nombre)
      registrar('ok', 'Documento generado y descargado.')
    } catch (fallo) {
      registrar('err', `Error al generar: ${fallo.message}`)
      console.error('[PADoc]', fallo)
    } finally {
      cambiar({ generando: false })
    }
  }

  return (
    <div className="padoc-pantalla">
      {/* 1. Carga de CSV */}
      <div className="panel">
        <div className="panel-title">📥 Archivos de configuración (CSV)</div>
        <p className="panel-desc">
          En SAP IBP, dentro del Planning Area, usa <b>Download Configuration File</b> y arrastra aquí
          los CSV resultantes (o un ZIP que los contenga).
        </p>

        <div
          className={`drop-zone${encima ? ' drag-over' : ''}`}
          onDragOver={(evento) => { evento.preventDefault(); setEncima(true) }}
          onDragLeave={() => setEncima(false)}
          onDrop={(evento) => {
            evento.preventDefault()
            setEncima(false)
            recibirArchivos([...evento.dataTransfer.files])
          }}
        >
          <input
            ref={entradaDeCsv}
            type="file"
            accept=".csv,.zip"
            multiple
            aria-label="Archivos de configuración"
            onChange={(evento) => {
              const lista = [...evento.target.files]
              evento.target.value = ''
              recibirArchivos(lista)
            }}
          />
          <span className="drop-icon">🗂️</span>
          <p className="drop-title">Arrastra los CSV aquí</p>
          <p className="drop-hint">o haz click para seleccionar &nbsp;·&nbsp; <b>Múltiples archivos</b> permitidos</p>
        </div>

        <div className="padoc-status">
          <div className="padoc-status-head">
            {estado.paId
              ? <><b>Planning Area:</b> {estado.paId}</>
              : <span className="padoc-muted">Sin PA detectado aún</span>}
            {' '}
            {logo ? `· Logo cargado (${logo.ancho}×${logo.alto})` : ''}
          </div>
          <div className="padoc-chk-grid">
            {estadoDeSecciones(estado.datos).map((una) => (
              <div key={una.id} className={`padoc-chk ${una.presente ? 'on' : 'off'}`} title={una.id}>
                <span className="padoc-chk-ico">{una.presente ? '✓' : '·'}</span>
                <span className="padoc-chk-name">{una.id}</span>
                <em>{una.texto}</em>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 2. Portada */}
      <div className="panel">
        <div className="panel-title">🎨 Portada del documento</div>
        <div className="padoc-form">
          <label className="padoc-field">
            <span>Cliente</span>
            <input
              type="text"
              placeholder="Ej: Claro Colombia"
              value={sesion.cliente}
              onChange={(evento) => cambiar({ cliente: evento.target.value })}
            />
          </label>
          <label className="padoc-field">
            <span>Autor</span>
            <input
              type="text"
              placeholder="Nombre / área"
              value={sesion.autor}
              onChange={(evento) => cambiar({ autor: evento.target.value })}
            />
          </label>
          <label className="padoc-field">
            <span>Versión del documento</span>
            <input
              type="text"
              value={sesion.version}
              onChange={(evento) => cambiar({ version: evento.target.value })}
            />
          </label>
          <label className="padoc-field padoc-field-logo">
            <span>Logo del cliente</span>
            <div className={`padoc-logo-ctl${logo ? ' has-logo' : ''}`}>
              {logo ? (
                <>
                  <img
                    className="padoc-logo-thumb"
                    src={`data:image/${logo.extension};base64,${logo.base64}`}
                    alt="logo"
                  />
                  <span className="padoc-logo-meta">
                    <b>{logo.nombre || 'Logo cargado'}</b>
                    <em>{logo.ancho}×{logo.alto} px</em>
                  </span>
                  <button
                    type="button"
                    className="padoc-logo-clear"
                    title="Quitar logo"
                    onClick={(evento) => { evento.preventDefault(); quitarLogo() }}
                  >
                    ✕
                  </button>
                </>
              ) : (
                <>
                  <span className="padoc-logo-ico">🖼️</span>
                  <span className="padoc-logo-cta">
                    <b>Subir logo del cliente</b>
                    <em>PNG o JPG · click para elegir</em>
                  </span>
                </>
              )}
            </div>
            <input
              ref={entradaDeLogo}
              type="file"
              accept="image/png,image/jpeg"
              aria-label="Logo del cliente"
              onChange={(evento) => elegirLogo(evento.target.files[0])}
            />
          </label>
        </div>
      </div>

      {/* 3. Enriquecimiento en vivo */}
      <div className={`panel padoc-phase2${conectado ? ' on' : ''}`}>
        <div className="panel-title">🔌 Enriquecer con datos en vivo · SAP IBP</div>
        <p className="panel-desc">
          Con una conexión activa a SAP IBP se añaden al documento la <b>volumetría real</b> de los datos
          maestros (SAP_COM_0720: registros por tipo) y los <b>Application Jobs</b> del tenant
          (SAP_COM_0326): plantillas de proceso y sus pasos, marcando los de integración CI-DS.
        </p>
        <label className="padoc-toggle">
          <input
            type="checkbox"
            checked={marcado}
            disabled={!conectado}
            onChange={(evento) => cambiar({ enriquecer: evento.target.checked })}
          />
          {' '}Añadir datos en vivo (volumetría + Application Jobs)
        </label>
        <div className={`padoc-enrich-hint${conectado ? ' ok' : ''}`}>
          {conectado
            ? 'Conectado a SAP IBP: los Application Jobs se leerán al generar.'
            : 'Requiere conexión a SAP IBP (pestaña Conexión).'}
        </div>
      </div>

      {/* 4. Generar */}
      <div className="panel">
        <div className="btn-row">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!hayDatos || generando}
            onClick={generar}
          >
            {generando ? '⏳ …' : '📝 Generar documento Word'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={limpiarTodo}>
            🗑️ Limpiar
          </button>
        </div>
        <div ref={registroEl} className="log-area padoc-log">
          {lineas.map((una, i) => (
            <div key={i} className={una.clase}>{una.hora} · {una.mensaje}</div>
          ))}
        </div>
      </div>
    </div>
  )
}

// Elegir archivos del equipo, arrastrándolos o con el explorador.
//
// Lo usan el explorador de integraciones y el documentador. Los archivos se leen en el navegador y
// no se suben a ningún lado: un export de CI-DS lleva las definiciones de integración del cliente.

import { useRef, useState } from 'react'

/** Un tamaño legible: los exports van de unos pocos kB a decenas de MB. */
function tamanioLegible(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Cuánto ocupa un archivo ya leído, sea buffer o texto. */
const pesoDe = (archivo) => archivo.data?.byteLength ?? archivo.text?.length ?? 0

export default function FileDropzone({
  archivos,
  onCambiar,
  accept,
  como = 'buffer',
  titulo,
  ayuda,
  icono = '🗂️',
}) {
  const entrada = useRef(null)
  const [encima, setEncima] = useState(false)

  const extensiones = accept.split(',').map((una) => una.trim().toLowerCase())
  const aceptado = (nombre) => extensiones.some((una) => nombre.toLowerCase().endsWith(una))

  const leer = async (archivo) => (como === 'texto'
    ? { name: archivo.name, text: await archivo.text() }
    : { name: archivo.name, data: await archivo.arrayBuffer() })

  function agregar(lista) {
    const validos = [...lista].filter((uno) => aceptado(uno.name))
    if (validos.length === 0) return

    Promise.all(validos.map(leer)).then((leidos) => {
      // Volver a soltar un archivo con el mismo nombre es querer la versión nueva, no tener las dos.
      const porNombre = new Map(archivos.map((uno) => [uno.name, uno]))
      for (const uno of leidos) porNombre.set(uno.name, uno)
      onCambiar([...porNombre.values()])
    })
  }

  return (
    <div className="exp-dropzone-block">
      <button
        type="button"
        className={`exp-dropzone${encima ? ' over' : ''}`}
        onClick={() => entrada.current?.click()}
        onDragOver={(evento) => { evento.preventDefault(); setEncima(true) }}
        onDragLeave={() => setEncima(false)}
        onDrop={(evento) => {
          evento.preventDefault()
          setEncima(false)
          agregar(evento.dataTransfer.files)
        }}
      >
        <span className="exp-drop-icon">{icono}</span>
        <span className="exp-drop-title">{titulo}</span>
        <span className="exp-drop-hint">{ayuda}</span>
      </button>

      <input
        ref={entrada}
        type="file"
        accept={accept}
        multiple
        className="exp-file-input"
        onChange={(evento) => { agregar(evento.target.files); evento.target.value = '' }}
      />

      {archivos.length > 0 && (
        <ul className="exp-file-list">
          {archivos.map((uno) => (
            <li key={uno.name}>
              <span className="exp-file-name">{uno.name}</span>
              <span className="exp-file-size">{tamanioLegible(pesoDe(uno))}</span>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={() => onCambiar(archivos.filter((otro) => otro.name !== uno.name))}
                aria-label={`Quitar ${uno.name}`}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

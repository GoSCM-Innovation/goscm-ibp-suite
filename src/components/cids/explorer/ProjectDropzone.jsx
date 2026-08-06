// Elegir los ZIP de export de CI-DS que se van a explorar.
//
// Los archivos se leen en el navegador y no se suben a ningún lado: un export lleva las
// definiciones de integración del cliente y no hay ninguna razón para que salgan del equipo.

import { useRef, useState } from 'react'

/** Lee un `File` a memoria. El parser de ZIP trabaja sobre el buffer, no sobre el `File`. */
const leer = async (archivo) => ({ name: archivo.name, data: await archivo.arrayBuffer() })

/** Un tamaño legible: los exports van de unos pocos kB a decenas de MB. */
function tamanio(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function ProjectDropzone({ archivos, onCambiar, onExplorar, analizando }) {
  const entrada = useRef(null)
  const [encima, setEncima] = useState(false)

  function agregar(lista) {
    const zips = [...lista].filter((uno) => /\.zip$/i.test(uno.name))
    if (zips.length === 0) return
    Promise.all(zips.map(leer)).then((leidos) => {
      // Se reemplaza el que ya estaba con el mismo nombre: volver a soltar un ZIP es querer la
      // versión nueva, no tener las dos.
      const porNombre = new Map(archivos.map((uno) => [uno.name, uno]))
      for (const uno of leidos) porNombre.set(uno.name, uno)
      onCambiar([...porNombre.values()])
    })
  }

  return (
    <div className="card exp-upload">
      <div className="card-title">📦 Exports de proyecto de CI-DS</div>
      <div className="card-hint">
        Los ZIP se leen acá mismo, en tu navegador. No se suben a ningún servidor.
      </div>

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
        <span className="exp-drop-icon">🗂️</span>
        <span className="exp-drop-title">Arrastrá los ZIP acá, o hacé clic para elegirlos</span>
        <span className="exp-drop-hint">Podés cargar varios proyectos a la vez</span>
      </button>

      <input
        ref={entrada}
        type="file"
        accept=".zip"
        multiple
        className="exp-file-input"
        onChange={(evento) => { agregar(evento.target.files); evento.target.value = '' }}
      />

      {archivos.length > 0 && (
        <ul className="exp-file-list">
          {archivos.map((uno) => (
            <li key={uno.name}>
              <span className="exp-file-name">{uno.name}</span>
              <span className="exp-file-size">{tamanio(uno.data.byteLength)}</span>
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

      <div className="exp-upload-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={archivos.length === 0 || analizando}
          onClick={onExplorar}
        >
          {analizando ? 'Analizando…' : '🔬 Explorar integraciones'}
        </button>
      </div>
    </div>
  )
}

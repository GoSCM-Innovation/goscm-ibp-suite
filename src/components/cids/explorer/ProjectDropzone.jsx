// El panel de carga del explorador: los ZIP de export y el botón para analizarlos.

import FileDropzone from '../../ui/FileDropzone.jsx'

export default function ProjectDropzone({ archivos, onCambiar, atls, onAtls, onExplorar, analizando }) {
  return (
    <>
      <div className="card exp-upload">
        <div className="card-title">📦 Exports de proyecto de CI-DS</div>
        <div className="card-hint">
          Los ZIP se leen acá mismo, en tu navegador. No se suben a ningún servidor.
        </div>

        <FileDropzone
          archivos={archivos}
          onCambiar={onCambiar}
          accept=".zip"
          titulo="Arrastrá los ZIP acá, o hacé clic para elegirlos"
          ayuda="Podés cargar varios proyectos a la vez"
        />
      </div>

      <div className="card exp-upload">
        <div className="card-title">📄 Archivos ATL <span className="tag tag-muted">opcional</span></div>
        <div className="card-hint">
          Dicen en qué orden corre CI-DS cada dataflow y cuáles van en paralelo. Con eso, el
          explorador puede avisar cuándo una integración lee datos de la corrida anterior porque el
          proceso la ejecuta antes que a su origen.
        </div>

        <FileDropzone
          archivos={atls}
          onCambiar={onAtls}
          accept=".atl,.txt"
          como="texto"
          icono="📄"
          titulo="Arrastrá los ATL acá, o hacé clic para elegirlos"
          ayuda="Se emparejan con los dataflows por su identificador"
        />
      </div>

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
    </>
  )
}

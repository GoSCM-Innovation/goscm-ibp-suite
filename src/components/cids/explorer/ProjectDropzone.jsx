// El panel de carga del explorador: los ZIP de export y el botón para analizarlos.

import FileDropzone from '../../ui/FileDropzone.jsx'

export default function ProjectDropzone({ archivos, onCambiar, onExplorar, analizando }) {
  return (
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

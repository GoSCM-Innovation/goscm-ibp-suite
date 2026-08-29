// Un paso del acordeón de v7: plegado enseña un resumen de una línea; abierto, su contenido.
//
// Portado de los paneles `mattype-panel` de `index.html` de v7 —② excluir tipos, ③ categorizar,
// ④ campos adicionales— y del `mattypeTogglePanel` de `mattype-config.js`.
//
// POR QUÉ UN ACORDEÓN Y NO PESTAÑAS. Las pestañas dicen «hay cinco sitios, ve al que quieras»; un
// acordeón dice «esto va en este orden, y ya vas por el tercero». Cuando el paso ③ solo tiene sentido
// después del ②, las pestañas obligan a descubrir el orden a base de errores. Y el resumen plegado
// —«Todos los tipos incluidos — sin configurar»— contesta sin abrir nada la pregunta que uno se hace
// al volver: ¿esto lo llegué a tocar?
//
// `oculto` es el `hidden` de v7: el paso siguiente no existe hasta que el anterior se confirma. No se
// deshabilita, no se ve en gris — no está. Un botón deshabilitado invita a preguntarse qué falta.

export default function PasoPlegable({
  numero,
  titulo,
  opcional = false,
  resumen = '',
  onRestablecer = null,
  abierto,
  onAlternar,
  oculto = false,
  children,
}) {
  if (oculto) return null

  return (
    <div className="mattype-panel">
      <button type="button" className="mattype-panel-header" onClick={onAlternar} aria-expanded={abierto}>
        <div className="mattype-panel-title">
          <span>{numero} {titulo}</span>
          {opcional && <span className="mattype-optional-badge">Opcional</span>}
        </div>
        <div className="mattype-panel-actions">
          {resumen && <span className="mattype-summary">{resumen}</span>}
          {onRestablecer && (
            <span
              role="button"
              tabIndex={0}
              className="mattype-reset-btn"
              onClick={(evento) => { evento.stopPropagation(); onRestablecer() }}
              onKeyDown={(evento) => {
                if (evento.key !== 'Enter' && evento.key !== ' ') return
                evento.stopPropagation()
                evento.preventDefault()
                onRestablecer()
              }}
            >
              Restablecer
            </span>
          )}
          <span className="mattype-arr">{abierto ? '▼' : '▶'}</span>
        </div>
      </button>

      {abierto && <div className="mattype-panel-body">{children}</div>}
    </div>
  )
}

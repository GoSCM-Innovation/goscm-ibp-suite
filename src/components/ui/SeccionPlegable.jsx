// Una sección de configuración que se pliega para dar aire a la tabla.
//
// Portada de `DataViewer/CollapsibleSection.jsx` de v8.
//
// Para qué sirve, que no es ahorrar espacio por ahorrarlo: los visores de datos tienen arriba dos
// bloques de configuración —qué se mira y con qué columnas y filtros— que juntos ocupan media
// pantalla. Una vez elegidos, lo que se quiere ver es la TABLA. Plegarlos la deja al doble de alto.
//
// Dos detalles de v8 que son los que hacen que funcione:
//
//   - Plegada enseña un RESUMEN de lo que hay dentro, así que no se pierde el contexto. Una sección
//     cerrada que no dice qué tiene obliga a abrirla para acordarse.
//   - Los BOTONES de la sección siguen visibles plegada o no. Es lo que permite pulsar «Mostrar
//     datos» sin volver a abrir nada.

export default function SeccionPlegable({ titulo, plegada, onAlternar, resumen, acciones, children }) {
  return (
    <div className="seccion-plegable">
      <div className="seccion-plegable-cabecera">
        <div
          role="button"
          tabIndex={0}
          className="seccion-plegable-titulo"
          onClick={onAlternar}
          onKeyDown={(evento) => {
            if (evento.key === 'Enter' || evento.key === ' ') { evento.preventDefault(); onAlternar() }
          }}
          aria-expanded={!plegada}
        >
          <span className={`seccion-plegable-flecha${plegada ? ' plegada' : ''}`}>▾</span>
          <span className="seccion-plegable-nombre">{titulo}</span>
          {plegada && resumen != null && <span className="seccion-plegable-resumen">{resumen}</span>}
        </div>
        {acciones}
      </div>
      {!plegada && <div className="seccion-plegable-cuerpo">{children}</div>}
    </div>
  )
}

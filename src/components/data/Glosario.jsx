// La guía de lectura de los informes de calidad: qué significa cada cosa y qué hacer con ella.
//
// Portado de `glosario.js` de v7, con un cambio que es la mitad del valor: v7 tenía el glosario escrito
// a mano en HTML, en paralelo a las reglas del analizador. Dos textos que hablan de lo mismo y que nadie
// mantiene a la vez: se cambia una regla, el glosario sigue explicando la vieja, y el consultor le
// explica al cliente algo que la herramienta ya no hace.
//
// Aquí el glosario se DERIVA del código: la matriz, los textos de las comprobaciones y las categorías
// salen de `core/ibp/production-rules.js`, que es el mismo módulo que juzga. Si mañana una comprobación
// cambia de rojo a aviso, esta pantalla lo dice sin que nadie la toque.

import { useMemo, useState } from 'react'

import { CATEGORIAS, IDS_DE_CATEGORIA, MATRIZ, TEXTOS, reglasDe } from '../../../core/ibp/production-rules.js'
import { COLUMNAS as COLUMNAS_JERARQUIA } from '../../../core/ibp/production-analysis.js'
import { COLUMNAS as COLUMNAS_RED, estadoEsperado } from '../../../core/ibp/network-analysis.js'

/** Cómo se lee cada severidad, y qué hacer con ella. */
const SEVERIDADES = [
  {
    id: 'red',
    icono: '🔴',
    nombre: 'Error',
    que: 'Le falta algo que SAP necesita para planificar con este material.',
    hacer: 'Hay que arreglarlo antes de dar el dato por bueno.',
  },
  {
    id: 'yel',
    icono: '🟡',
    nombre: 'Aviso',
    que: 'Puede funcionar así, pero es raro o depende de una decisión que nadie tomó.',
    hacer: 'Revisar y decidir. Muchos avisos son tipos de material sin clasificar.',
  },
  {
    id: 'ok',
    icono: '🟢',
    nombre: 'Bien',
    que: 'Tiene lo que le corresponde según lo que es.',
    hacer: 'Nada.',
  },
]

/** Qué quiere decir cada casilla de la matriz. */
const QUE_SIGNIFICA = {
  red: { texto: 'Error', nota: 'se exige' },
  yel: { texto: 'Aviso', nota: 'se mira' },
  none: { texto: '—', nota: 'no se le pide' },
  info: { texto: 'Nota', nota: 'se informa' },
}

/** Los estados de la red, con lo que significan. */
const ESTADOS_DE_RED = [
  ['Red completa', 'Se fabrica y desde su planta se llega a un cliente. Es lo que se busca.'],
  ['Sin distribución', 'Se fabrica y no tiene ningún arco de salida.'],
  ['Sin entrega a cliente', 'Sale de la planta pero no llega a ningún cliente.'],
  ['Distribución sin ruta completa', 'Hay arcos a clientes, pero desde la planta no se llega a ninguno.'],
  ['Abastecimiento completo', 'Un material comprado que llega a una planta que lo usa.'],
  ['Abastecimiento parcial', 'Llega a algún sitio, pero no a una planta que lo fabrique.'],
  ['Sin abastecimiento', 'Un material comprado del que no hay arco de entrada.'],
  ['Abastecimiento sin consumo en receta', 'Entra al sistema y ninguna receta lo usa.'],
  ['Semiterminado local', 'Se fabrica y se consume en la misma planta. Correcto.'],
  ['Semiterminado con transferencia', 'Se fabrica en una planta y se transfiere a otra.'],
  ['Semiterminado local con transferencia', 'Las dos cosas. Correcto.'],
  ['Semiterminado sin transferencia', 'Se fabrica y no se consume ni se transfiere. Es un problema.'],
  ['Solo distribución y entrega', 'Mercadería que se compra y se revende. Correcto para ese tipo.'],
  ['Solo distribución', 'Mercadería que entra y no se entrega a nadie.'],
  ['Solo entrega', 'Se entrega y no se sabe de dónde sale.'],
  ['Huérfano', 'Está en el maestro de productos y no aparece en ninguna otra parte.'],
  ['Sin producción', 'Se espera que se fabrique y no tiene receta.'],
  ['Sin consumo en ninguna receta', 'Un semiterminado que ninguna receta lleva.'],
  ['Sin arcos de red', 'No aparece en ninguna tabla de la red.'],
]

/** Los hallazgos de grafo, que son los que no se ven mirando una tabla. */
const HALLAZGOS = [
  {
    nombre: 'Bodega que recibe y no reenvía',
    que: 'Le llega producto y no tiene ningún arco de salida: ni a otra ubicación ni a un cliente.',
    porque: 'El producto entra y se queda. O falta el arco de salida, o esa bodega no debería recibirlo.',
  },
  {
    nombre: 'Producto que entra en una bodega sin salida útil',
    que: 'La bodega tiene arcos de salida, pero siguiéndolos no se llega a ningún cliente.',
    porque: 'Es el más difícil de ver a mano: todo parece configurado y el producto no puede terminar '
      + 'en una venta. Falta cerrar la cadena en algún punto más adelante.',
  },
  {
    nombre: 'Planta sin salida hacia ningún cliente',
    que: 'Se fabrica ahí y desde ahí no se llega a nadie.',
    porque: 'O falta el arco de transporte, o falta el arco a cliente del destino.',
  },
  {
    nombre: 'Ciclo en la red',
    que: 'A manda a B, B manda a C y C vuelve a A.',
    porque: 'SAP puede quedarse dando vueltas al calcular la ruta. Casi siempre es un arco de más.',
  },
]

export default function Glosario() {
  const [abierta, setAbierta] = useState('severidades')

  /** La matriz, ya resuelta por categoría, tal como la aplica el analizador. */
  const filas = useMemo(() => Object.keys(MATRIZ).map((comprobacion) => ({
    comprobacion,
    texto: TEXTOS[comprobacion] ?? comprobacion,
    porCategoria: IDS_DE_CATEGORIA.map((cat) => reglasDe([cat])[comprobacion]),
    sinClasificar: reglasDe([])[comprobacion],
  })), [])

  const seccion = (id, titulo, contenido) => (
    <div className="card">
      <button
        type="button"
        className="glos-titulo"
        onClick={() => setAbierta(abierta === id ? '' : id)}
        aria-expanded={abierta === id}
      >
        {abierta === id ? '▾' : '▸'} {titulo}
      </button>
      {abierta === id && <div className="glos-cuerpo">{contenido}</div>}
    </div>
  )

  return (
    <div className="module-body">
      <div className="notice notice-info">
        Esta guía sale del <b>mismo código</b> que juzga los informes: la matriz de abajo no es una copia
        escrita a mano, es la que se aplica. Si una comprobación cambia, esta pantalla cambia con ella.
      </div>

      {seccion('severidades', 'Los tres estados de una fila', (
        <table className="table-dense">
          <thead><tr><th>Estado</th><th>Qué quiere decir</th><th>Qué hacer</th></tr></thead>
          <tbody>
            {SEVERIDADES.map((una) => (
              <tr key={una.id}>
                <td>{una.icono} {una.nombre}</td>
                <td>{una.que}</td>
                <td className="exp-sub">{una.hacer}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}

      {seccion('categorias', 'Las cuatro categorías de material', (
        <>
          <p className="exp-sub">
            Es lo primero que hay que decir y lo único que la herramienta no puede adivinar: los tipos de
            material son del cliente. De esta decisión depende todo lo demás.
          </p>
          <div className="tablero">
            {CATEGORIAS.map((una) => (
              <div key={una.id}>
                <div className="card-label">{una.etiqueta}</div>
                <p className="exp-sub">{una.descripcion}</p>
                <ul className="pa-exige">{una.exige.map((que) => <li key={que}>{que}</li>)}</ul>
              </div>
            ))}
          </div>
        </>
      ))}

      {seccion('matriz', 'Qué se le exige a cada categoría', (
        <>
          <p className="exp-sub">
            «—» quiere decir que a ese tipo de material NO se le pide eso, y es tan importante como el
            error: es lo que evita que una materia prima salga con veinte errores por no tener receta.
            Un tipo en dos categorías se queda con la exigencia más suave.
          </p>
          <div className="table-scroll">
            <table className="table-dense">
              <thead>
                <tr>
                  <th>Comprobación</th>
                  {CATEGORIAS.map((una) => <th key={una.id}>{una.etiqueta}</th>)}
                  <th>Sin clasificar</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((una) => (
                  <tr key={una.comprobacion}>
                    <td>{una.texto}</td>
                    {una.porCategoria.map((severidad, indice) => (
                      <td key={IDS_DE_CATEGORIA[indice]} title={QUE_SIGNIFICA[severidad]?.nota}>
                        {QUE_SIGNIFICA[severidad]?.texto ?? severidad}
                      </td>
                    ))}
                    <td className="exp-sub">{QUE_SIGNIFICA[una.sinClasificar]?.texto}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ))}

      {seccion('hallazgos', 'Los hallazgos de la red', (
        <table className="table-dense">
          <thead><tr><th>Hallazgo</th><th>Qué es</th><th>Por qué importa</th></tr></thead>
          <tbody>
            {HALLAZGOS.map((uno) => (
              <tr key={uno.nombre}>
                <td>{uno.nombre}</td>
                <td>{uno.que}</td>
                <td className="exp-sub">{uno.porque}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}

      {seccion('estados', 'Los estados de la red', (
        <>
          <p className="exp-sub">
            Cada tipo de material tiene un estado que se considera correcto, y no es el mismo para todos:
            {' '}{IDS_DE_CATEGORIA.map((cat) => {
              const etiqueta = CATEGORIAS.find((una) => una.id === cat)?.etiqueta
              return `${etiqueta} espera «${estadoEsperado([cat])[0]}»`
            }).join('; ')}.
          </p>
          <div className="table-scroll table-alta">
            <table className="table-dense">
              <thead><tr><th>Estado</th><th>Qué quiere decir</th></tr></thead>
              <tbody>
                {ESTADOS_DE_RED.map(([estado, que]) => (
                  <tr key={estado}><td>{estado}</td><td>{que}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ))}

      {seccion('columnas', 'Las columnas de los informes', (
        <div className="tablero">
          <div>
            <div className="card-label">Informe de la jerarquía</div>
            <ol className="pa-frecuentes">
              {COLUMNAS_JERARQUIA.map((una) => <li key={una}>{una}</li>)}
            </ol>
          </div>
          <div>
            <div className="card-label">Informe de la red</div>
            <ol className="pa-frecuentes">
              {COLUMNAS_RED.map((una) => <li key={una}>{una}</li>)}
            </ol>
          </div>
        </div>
      ))}
    </div>
  )
}

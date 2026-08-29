// Network Analyzer — calidad de la red logística, con la forma que tenía en v7.
//
// Portado del `tab-network` de `index.html` de v7 y de `analyzer.js` + `snWebView.js`. Sus cinco
// pasos son los mismos del Production Analyzer y los pone `AnalizadorV7`; aquí queda lo propio.
//
// Contesta una pregunta distinta de la del otro analizador, y por eso son dos aplicaciones y no una
// pestaña: el de producción pregunta «¿a este material le falta algo para poder fabricarse?»; este
// pregunta «¿lo que se fabrica llega a alguien?». Un material perfectamente configurado cuya planta
// no tiene arco a ninguna ubicación pasa el primero y falla el segundo.
//
// Las reglas están en `core/ibp/network-analysis.js` y el cruce de datos en
// `src/lib/network-analyze.js`.

import AnalizadorV7 from './AnalizadorV7.jsx'
import InformeDeCalidad from './InformeDeCalidad.jsx'
import { COLUMNAS as COLUMNAS_RED } from '../../../core/ibp/network-analysis.js'
import { analizarRedes } from '../../lib/network-analyze.js'

export default function NetworkAnalyzer({ area = '', destino }) {
  async function correr(configuracion, { onAvance }) {
    return analizarRedes(configuracion, {
      onAvance: (cual) => onAvance({ ...cual, cual: 'la red' }),
    })
  }

  return (
    <AnalizadorV7 area={area} destino={destino} grupo="red" correr={correr} queEs="la red">
      {(red) => (
        <>
          <div className="notice notice-info">
            Cada fila es un material y dice si su red lo lleva a alguna parte: si tiene planta, si de
            esa planta sale algún arco, y si alguno de esos arcos termina en un cliente. Un material
            cuya red no llega a nadie está bien configurado y no se puede vender.
          </div>
          <InformeDeCalidad
            tabla="sn_product_web"
            columnas={COLUMNAS_RED}
            resumen={red.resumen}
            analizados={red.analizados}
            excluidos={red.excluidos}
            nombre={['red', area]}
          />
        </>
      )}
    </AnalizadorV7>
  )
}

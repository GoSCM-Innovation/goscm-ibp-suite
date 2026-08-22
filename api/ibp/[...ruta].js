// El mostrador de ibp: recibe todas sus operaciones y las reparte.
//
// Un archivo por operación pasaba de las 12 funciones que permite el plan de Vercel. El detalle está
// en `handlers/repartir.js`; las direcciones no cambiaron.

import { RUTAS } from '../../handlers/ibp/index.js'
import { mostrador } from '../../handlers/repartir.js'

export default mostrador(RUTAS, 'ibp')

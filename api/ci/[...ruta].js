// El mostrador de ci: recibe todas sus operaciones y las reparte.
//
// Un archivo por operación pasaba de las 12 funciones que permite el plan de Vercel. El detalle está
// en `handlers/repartir.js`; las direcciones no cambian: `/api/ci/run` es `/api/ci/run`.

import { RUTAS } from '../../handlers/ci/index.js'
import { mostrador } from '../../handlers/repartir.js'

export default mostrador(RUTAS, 'ci')

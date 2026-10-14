// Qué grupos de una lista de Administración están abiertos. Solo en memoria: al recargar vuelven a su estado inicial.
//
// `abiertosAlInicio` son los que empiezan abiertos; el resto, cerrados.

import { useCallback, useState } from 'react'

export function useGrupos(abiertosAlInicio = []) {
  const [abiertos, setAbiertos] = useState(() => new Set(abiertosAlInicio))

  const alternar = useCallback((id) => setAbiertos((previos) => {
    const siguientes = new Set(previos)
    if (siguientes.has(id)) siguientes.delete(id)
    else siguientes.add(id)
    return siguientes
  }), [])

  const abrir = useCallback((id) => setAbiertos((previos) => new Set(previos).add(id)), [])

  return { plegado: (id) => !abiertos.has(id), alternar, abrir }
}

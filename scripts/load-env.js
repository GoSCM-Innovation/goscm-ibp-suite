// Carga mínima de las variables locales para los scripts de consola.
// En Vercel las variables ya vienen del entorno y esto no hace nada.
//
// `.env.local` primero: es lo que escribe `vercel env pull`, y tiene prioridad sobre el
// `.env` escrito a mano. Lo que ya esté definido en el entorno gana sobre ambos.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export function loadLocalEnv(root) {
  for (const name of ['.env.local', '.env']) {
    const file = join(root, name)
    if (!existsSync(file)) continue
    for (const line of readFileSync(file, 'utf-8').split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const separator = trimmed.indexOf('=')
      if (separator === -1) continue
      const key = trimmed.slice(0, separator).trim()
      const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, '')
      if (process.env[key] === undefined) process.env[key] = value
    }
  }
}

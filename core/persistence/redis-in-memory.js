// Doble de Redis en memoria, SOLO para los tests.
//
// Reproduce las operaciones que usa la aplicación con la misma semántica que el cliente de
// Upstash: `set` con `ex` y `nx`, `ttl` con -1 (sin vencimiento) y -2 (no existe), `incr`
// sobre claves que no existen, y conjuntos para el índice de sesiones por usuario.
//
// El reloj es inyectable para poder probar vencimientos sin esperar de verdad.

export function createInMemoryRedis({ now = () => Date.now() } = {}) {
  const store = new Map() // clave -> { value, expiresAt (ms) | null }

  const alive = (key) => {
    const entry = store.get(key)
    if (!entry) return null
    if (entry.expiresAt !== null && entry.expiresAt <= now()) {
      store.delete(key)
      return null
    }
    return entry
  }

  return {
    async get(key) {
      const entry = alive(key)
      return entry ? entry.value : null
    },

    async set(key, value, options = {}) {
      const existing = alive(key)
      if (options.nx && existing) return null
      const expiresAt = options.ex ? now() + options.ex * 1000 : null
      store.set(key, { value, expiresAt })
      return 'OK'
    },

    async del(...keys) {
      let removed = 0
      for (const key of keys.flat()) {
        if (alive(key)) removed += 1
        store.delete(key)
      }
      return removed
    },

    async incr(key) {
      const entry = alive(key)
      const next = Number(entry ? entry.value : 0) + 1
      store.set(key, { value: next, expiresAt: entry ? entry.expiresAt : null })
      return next
    },

    async expire(key, seconds) {
      const entry = alive(key)
      if (!entry) return 0
      entry.expiresAt = now() + seconds * 1000
      return 1
    },

    async ttl(key) {
      const entry = alive(key)
      if (!entry) return -2
      if (entry.expiresAt === null) return -1
      return Math.ceil((entry.expiresAt - now()) / 1000)
    },

    async sadd(key, ...members) {
      const entry = alive(key)
      const set = entry ? entry.value : new Set()
      let added = 0
      for (const member of members.flat()) {
        if (!set.has(member)) {
          set.add(member)
          added += 1
        }
      }
      store.set(key, { value: set, expiresAt: entry ? entry.expiresAt : null })
      return added
    },

    async smembers(key) {
      const entry = alive(key)
      return entry ? [...entry.value] : []
    },

    async srem(key, ...members) {
      const entry = alive(key)
      if (!entry) return 0
      let removed = 0
      for (const member of members.flat()) {
        if (entry.value.delete(member)) removed += 1
      }
      return removed
    },

    /** Solo para los tests: cuántas claves vivas hay, y con qué nombres. */
    keys() {
      return [...store.keys()].filter((key) => alive(key))
    },
  }
}

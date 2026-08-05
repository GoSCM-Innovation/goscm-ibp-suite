// Clientes y qué módulos tiene contratado cada uno. Solo administrador de plataforma.

import { useState } from 'react'
import { api } from '../../lib/api.js'
import { MODULES } from '../../lib/modules.js'

export default function ClientsTab({ clients, onChanged, selectedClientId, onSelect }) {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [subscriptions, setSubscriptions] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const selected = clients.find((c) => c.id === selectedClientId) ?? null

  async function loadSubscriptions(clientId) {
    setSubscriptions(null)
    const data = await api.get('/api/admin/subscriptions', { clientId })
    setSubscriptions(data.subscriptions)
  }

  async function select(client) {
    onSelect(client.id)
    setError(null)
    try {
      await loadSubscriptions(client.id)
    } catch (problem) {
      setError(problem.message)
    }
  }

  async function run(action) {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (problem) {
      setError(problem.message)
    } finally {
      setBusy(false)
    }
  }

  const createClient = (event) => {
    event.preventDefault()
    return run(async () => {
      await api.post('/api/admin/clients', { name, slug })
      setName('')
      setSlug('')
      await onChanged()
    })
  }

  const toggleModule = (module, active) => run(async () => {
    await api.put('/api/admin/subscriptions', {
      clientId: selected.id,
      module,
      status: active ? 'active' : 'expired',
    })
    await loadSubscriptions(selected.id)
    await onChanged()
  })

  const toggleStatus = (client) => run(async () => {
    await api.patch('/api/admin/clients', {
      clientId: client.id,
      status: client.status === 'active' ? 'suspended' : 'active',
    })
    await onChanged()
  })

  const activeModules = new Set((subscriptions ?? []).filter((s) => s.status === 'active').map((s) => s.module))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {error && <div className="notice notice-error">{error}</div>}

      <div className="card">
        <div className="card-title">Clientes</div>
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Identificador</th>
                <th>Personas</th>
                <th>Módulos</th>
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {clients.length === 0 && (
                <tr><td className="table-empty" colSpan={6}>Todavía no hay clientes.</td></tr>
              )}
              {clients.map((client) => (
                <tr
                  key={client.id}
                  onClick={() => select(client)}
                  style={{ cursor: 'pointer', background: client.id === selectedClientId ? 'var(--surface-glass)' : undefined }}
                >
                  <td style={{ fontWeight: 600 }}>{client.name}</td>
                  <td className="mono">{client.slug}</td>
                  <td>{client.userCount}</td>
                  <td>{client.moduleCount}</td>
                  <td>
                    <span className={`tag ${client.status === 'active' ? 'tag-green' : 'tag-muted'}`}>
                      {client.status === 'active' ? 'Activo' : 'Suspendido'}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button
                      className="btn btn-sm btn-ghost"
                      disabled={busy}
                      onClick={(e) => { e.stopPropagation(); toggleStatus(client) }}
                    >
                      {client.status === 'active' ? 'Suspender' : 'Reactivar'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="card-hint" style={{ marginTop: 10 }}>
          Suspender un cliente cierra al instante las sesiones de toda su gente.
        </p>
      </div>

      {selected && (
        <div className="card">
          <div className="card-title">Módulos contratados · {selected.name}</div>
          <p className="card-hint" style={{ marginTop: 4 }}>
            Vencer un módulo surte efecto en la siguiente petición, sin esperar a que caduque
            ninguna sesión.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
            {MODULES.map((module) => {
              const active = activeModules.has(module.id)
              return (
                <div
                  key={module.id}
                  style={{
                    alignItems: 'center',
                    background: 'var(--bg2)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    display: 'flex',
                    gap: 10,
                    padding: '10px 12px',
                  }}
                >
                  <span style={{ fontSize: 16 }}>{module.icon}</span>
                  <span style={{ flex: 1, fontWeight: 500 }}>{module.name}</span>
                  <span className={`tag ${active ? 'tag-green' : 'tag-muted'}`}>
                    {active ? 'Contratado' : 'No contratado'}
                  </span>
                  <button
                    className={`btn btn-sm ${active ? '' : 'btn-primary'}`}
                    disabled={busy || subscriptions === null}
                    onClick={() => toggleModule(module.id, !active)}
                  >
                    {active ? 'Vencer' : 'Activar'}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-title">Nuevo cliente</div>
        <form onSubmit={createClient} style={{ display: 'flex', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: '1 1 220px' }}>
            <label htmlFor="clientName">Nombre</label>
            <input id="clientName" className="input" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field" style={{ flex: '1 1 180px' }}>
            <label htmlFor="clientSlug">Identificador</label>
            <input
              id="clientSlug"
              className="input mono"
              required
              value={slug}
              placeholder="acme"
              onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
            />
          </div>
          <button className="btn btn-primary" type="submit" disabled={busy || !name || !slug} style={{ alignSelf: 'flex-end' }}>
            Crear
          </button>
        </form>
      </div>
    </div>
  )
}

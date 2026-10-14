// Clientes y qué módulos tiene contratado cada uno. Solo administrador de plataforma.
//
// La lista va agrupada por estado: los activos abiertos y los suspendidos cerrados, para que estos no estorben.

import { useState } from 'react'
import { api } from '../../lib/api.js'
import { GRUPOS_DE_CLIENTE, agrupar, grupoDeCliente, resumenDeNombres } from '../../lib/admin-grupos.js'
import { MODULES } from '../../lib/modules.js'
import SeccionPlegable from '../ui/SeccionPlegable.jsx'
import { useGrupos } from './useGrupos.js'

export default function ClientsTab({ clients, cargados = true, onChanged, selectedClientId, onSelect }) {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [subscriptions, setSubscriptions] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const grupos = useGrupos(['activos'])
  const [nuevoAbierto, setNuevoAbierto] = useState(false)

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
      setNuevoAbierto(false)
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

  // Suspender o reactivar mueve al cliente de grupo: el que lo recibe se abre para que no parezca que desapareció.
  const toggleStatus = (client) => run(async () => {
    const suspendiendo = client.status === 'active'
    await api.patch('/api/admin/clients', {
      clientId: client.id,
      status: suspendiendo ? 'suspended' : 'active',
    })
    grupos.abrir(suspendiendo ? 'suspendidos' : 'activos')
    await onChanged()
  })

  const activeModules = new Set((subscriptions ?? []).filter((s) => s.status === 'active').map((s) => s.module))

  const filaDe = (client) => (
    <tr
      key={client.id}
      onClick={() => select(client)}
      style={{ cursor: 'pointer', background: client.id === selectedClientId ? 'var(--surface-glass)' : undefined }}
    >
      <td style={{ fontWeight: 600 }}>{client.name}</td>
      <td className="mono">{client.slug}</td>
      <td>{client.userCount}</td>
      <td>{client.moduleCount}</td>
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
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {error && <div className="notice notice-error">{error}</div>}

      <div className="card admin-grupos">
        <div className="card-title">Clientes</div>
        <div style={{ marginTop: 10 }}>
          {clients.length === 0 && (
            <p className="card-hint">{cargados ? 'Todavía no hay clientes.' : 'Leyendo los clientes…'}</p>
          )}
          {clients.length > 0 && agrupar(clients, GRUPOS_DE_CLIENTE, grupoDeCliente).map((grupo) => (
            <SeccionPlegable
              key={grupo.id}
              titulo={<>{grupo.titulo} <span className="tag tag-muted">{grupo.elementos.length}</span></>}
              plegada={grupos.plegado(grupo.id)}
              onAlternar={() => grupos.alternar(grupo.id)}
              resumen={resumenDeNombres(grupo.elementos.map((uno) => uno.name))}
            >
              {grupo.elementos.length === 0 ? <p className="card-hint">No hay clientes en este grupo.</p> : (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr><th>Nombre</th><th>Identificador</th><th>Personas</th><th>Módulos</th><th /></tr>
                    </thead>
                    <tbody>{grupo.elementos.map(filaDe)}</tbody>
                  </table>
                </div>
              )}
            </SeccionPlegable>
          ))}
        </div>
        <p className="card-hint" style={{ marginTop: 6 }}>
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
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
                    padding: '6px 12px',
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

      <SeccionPlegable
        titulo="+ Nuevo cliente"
        plegada={!nuevoAbierto}
        onAlternar={() => setNuevoAbierto((v) => !v)}
        resumen="Nombre e identificador"
      >
        <form onSubmit={createClient} style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
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
      </SeccionPlegable>
    </div>
  )
}

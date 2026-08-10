import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../transport/sap-fetch.js', () => ({ sapFetch: vi.fn() }))

const { sapFetch } = await import('../transport/sap-fetch.js')
const { readJobRun } = await import('./job-runs.js')

const ctx = { baseUrl: 'https://tenant-api.scmibp1.ondemand.com', credentials: { user: 'u', password: 'p' } }

beforeEach(() => { sapFetch.mockReset() })

const urlDe = () => decodeURIComponent(sapFetch.mock.calls[0][0].url)

describe('readJobRun', () => {
  it('filtra por nombre y repetición, y trae una sola fila', async () => {
    sapFetch.mockResolvedValueOnce({ json: { d: { results: [{ JobName: 'J', JobStatus: 'F' }] } } })

    await expect(readJobRun({ ...ctx, jobName: 'J', jobRunCount: '7' }))
      .resolves.toMatchObject({ JobStatus: 'F' })

    const url = urlDe()
    expect(url).toContain("JobName eq 'J' and JobRunCount eq '7'")
    expect(url).toContain('$top=1')
  })

  /** Solo la parte de `$filter`: `JobRunCount` también aparece en el `$select`, y ahí sí se quiere. */
  const filtroDe = () => /\$filter=([^&]*)/.exec(urlDe())[1]

  // Un trabajo recién lanzado puede no tener repetición todavía.
  it('sin repetición filtra solo por nombre', async () => {
    sapFetch.mockResolvedValueOnce({ json: { d: { results: [] } } })
    await readJobRun({ ...ctx, jobName: 'J' })
    expect(filtroDe()).toBe("JobName eq 'J'")
  })

  // Que no esté es una respuesta, no un error: quien pregunta lo traduce como «en cola».
  it('una ejecución que SAP no conoce devuelve null', async () => {
    sapFetch.mockResolvedValueOnce({ json: { d: { results: [] } } })
    await expect(readJobRun({ ...ctx, jobName: 'J', jobRunCount: '7' })).resolves.toBeNull()
  })

  it('sin nombre no llega a SAP', async () => {
    await expect(readJobRun({ ...ctx, jobName: '' })).resolves.toBeNull()
    expect(sapFetch).not.toHaveBeenCalled()
  })

  // Una comilla sin escapar cambiaría el filtro entero.
  it('escapa las comillas del nombre', async () => {
    sapFetch.mockResolvedValueOnce({ json: { d: { results: [] } } })
    await readJobRun({ ...ctx, jobName: "O'Brien" })
    expect(urlDe()).toContain("JobName eq 'O''Brien'")
  })
})

// Los dos gráficos de un tablero de CI-DS: la torta por estado y las barras por día.
//
// Los usan el tablero del tenant y el global. En v9 estaban escritos dos veces, con los colores a
// mano en cada copia; aquí los colores vienen con los datos, que a su vez salen de la tabla de
// estados de la capa transversal.

import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'

const TOOLTIP = {
  background: 'var(--surface)',
  border: '1px solid var(--border2)',
  borderRadius: 6,
  color: 'var(--text)',
  fontSize: 11,
}

const EJE = { fontSize: 10, fill: 'var(--text2)' }

export function StatusDonut({ porEstado }) {
  if (porEstado.length === 0) return <SinDatos />

  return (
    <>
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie data={porEstado} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={2} dataKey="value">
            {porEstado.map((porcion) => <Cell key={porcion.code} fill={porcion.color} />)}
          </Pie>
          <Tooltip contentStyle={TOOLTIP} />
        </PieChart>
      </ResponsiveContainer>

      {/* Leyenda propia y no la de recharts: con once estados la suya se corta. */}
      <div className="leyenda">
        {porEstado.map((porcion) => (
          <span className="leyenda-item" key={porcion.code}>
            <span className="leyenda-color" style={{ background: porcion.color }} />
            {porcion.name} ({porcion.value})
          </span>
        ))}
      </div>
    </>
  )
}

export function PerDayBars({ porDia }) {
  if (porDia.length === 0) return <SinDatos />

  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={porDia} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis dataKey="dia" tick={EJE} />
        <YAxis tick={EJE} allowDecimals={false} />
        <Tooltip contentStyle={TOOLTIP} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="Correctas" stackId="a" fill="var(--green)" />
        <Bar dataKey="Falladas" stackId="a" fill="var(--red)" />
        <Bar dataKey="Otras" stackId="a" fill="var(--text3)" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

export function SinDatos() {
  return <div className="sin-datos">Sin datos en el período</div>
}

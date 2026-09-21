import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { logout } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import Compliance, { AuditLog } from './Compliance'
import { Dashboard, Live } from './Dashboard'
import { Ledger, Shifts } from './Finance'
import Reports from './Reports'
import Settings from './Settings'
import { Shops, Staff } from './Shops'
import Tickets from './Tickets'
import { Markets, WheelConfig } from './WheelConfig'

const NAV: { to: string; label: string; roles: ('ADMIN' | 'MANAGER')[]; group: string }[] = [
  { to: 'dashboard', label: 'Dashboard', roles: ['ADMIN', 'MANAGER'], group: 'Operations' },
  { to: 'live', label: 'Live monitoring', roles: ['ADMIN', 'MANAGER'], group: 'Operations' },
  { to: 'tickets', label: 'Tickets', roles: ['ADMIN', 'MANAGER'], group: 'Operations' },
  { to: 'shifts', label: 'Shift reconciliation', roles: ['ADMIN', 'MANAGER'], group: 'Operations' },
  { to: 'ledger', label: 'Shop ledger', roles: ['ADMIN', 'MANAGER'], group: 'Finance' },
  { to: 'reports', label: 'Reports', roles: ['ADMIN', 'MANAGER'], group: 'Finance' },
  { to: 'shops', label: 'Shops', roles: ['ADMIN'], group: 'Setup' },
  { to: 'staff', label: 'Cashiers & staff', roles: ['ADMIN', 'MANAGER'], group: 'Setup' },
  { to: 'wheel', label: 'Wheel', roles: ['ADMIN'], group: 'Game' },
  { to: 'markets', label: 'Markets & odds', roles: ['ADMIN'], group: 'Game' },
  { to: 'settings', label: 'Game & limits', roles: ['ADMIN'], group: 'Game' },
  { to: 'audit', label: 'Audit log', roles: ['ADMIN'], group: 'Control' },
  { to: 'compliance', label: 'Compliance & alerts', roles: ['ADMIN'], group: 'Control' },
]

export default function AdminApp() {
  const auth = useAuth()
  const nav = useNavigate()
  if (!auth) return null
  const role = auth.user.role as 'ADMIN' | 'MANAGER'
  const items = NAV.filter((n) => n.roles.includes(role))
  const groups = [...new Set(items.map((i) => i.group))]
  const admin = role === 'ADMIN'

  return (
    <div className="flex h-full bg-paper text-ink">
      <aside className="flex w-56 shrink-0 flex-col bg-ink text-white">
        <div className="px-4 py-4">
          <div className="text-[0.65rem] font-bold tracking-[0.3em] text-amber">SPINWHEEL ETHIOPIA</div>
          <div className="text-lg font-bold">Back office</div>
        </div>
        <nav className="flex-1 overflow-auto px-2 pb-4">
          {groups.map((g) => (
            <div key={g} className="mb-3">
              <div className="px-2 pb-1 text-[0.65rem] font-bold uppercase tracking-widest text-zinc-500">{g}</div>
              {items.filter((i) => i.group === g).map((i) => (
                <NavLink key={i.to} to={`/admin/${i.to}`} className={({ isActive }) => `block rounded px-2 py-1.5 text-sm ${isActive ? 'bg-white/10 font-semibold text-white shadow-[inset_3px_0_0_var(--color-amber)]' : 'text-zinc-300 hover:bg-white/5'}`}>
                  {i.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="border-t border-white/10 p-3 text-sm">
          <a href="/display" target="_blank" rel="noreferrer" className="mb-2 block text-zinc-300 underline underline-offset-2 hover:text-white">Open game display ↗</a>
          <div className="font-semibold">{auth.user.fullName}</div>
          <div className="mb-2 text-xs text-zinc-400">{role === 'ADMIN' ? 'Administrator' : 'Shop manager'}</div>
          <button onClick={() => logout().then(() => nav('/admin'))} className="w-full rounded border border-white/20 py-1 text-xs font-semibold hover:bg-white/10">Sign out</button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-auto p-6">
        <Routes>
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="live" element={<Live />} />
          <Route path="tickets" element={<Tickets />} />
          <Route path="shifts" element={<Shifts />} />
          <Route path="ledger" element={<Ledger />} />
          <Route path="reports" element={<Reports />} />
          <Route path="staff" element={<Staff />} />
          {admin && <Route path="shops" element={<Shops />} />}
          {admin && <Route path="wheel" element={<WheelConfig />} />}
          {admin && <Route path="markets" element={<Markets />} />}
          {admin && <Route path="settings" element={<Settings />} />}
          {admin && <Route path="audit" element={<AuditLog />} />}
          {admin && <Route path="compliance" element={<Compliance />} />}
          <Route path="*" element={<Navigate to="/admin/dashboard" replace />} />
        </Routes>
      </main>
    </div>
  )
}

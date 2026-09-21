import { useState } from 'react'
import { Modal } from '@/components/Modal'
import { Badge, Btn, Card, ErrorNote, Field, inp, PageHeader, sel, statusTone, Table, useFetch } from '@/components/ui'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { etb, fmtDateTime } from '@/lib/format'

interface Shop { id: number; code: string; name: string; address: string; phone: string; status: string; regionId: number; region: string; managerId: number | null; manager: string | null; balance: number; cashiers: number; devices: number; turnoverToday: number; openingBalance: number }
interface UserRow { id: number; username: string; fullName: string; role: string; shopId: number | null; shop: string | null; cashierCode: string | null; phone: string; shiftLabel: string; payoutLimit: number; status: string; lockedUntil: number | null; lastLoginAt: number | null; onShift: boolean; openingFloat: number | null; currentBalance: number | null; totalSales: number; totalPayouts: number; netBalance: number }

const toSantim = (v: string) => Math.round(Number(v || 0) * 100)

export function Shops() {
  const { data, error, reload } = useFetch<{ shops: Shop[] }>('/shops')
  const regions = useFetch<{ regions: { id: number; name: string }[]; company: { name: string } }>('/regions')
  const staff = useFetch<{ users: UserRow[] }>('/users?role=MANAGER')
  const [edit, setEdit] = useState<Shop | 'new' | null>(null)
  return (
    <>
      <PageHeader title="Shops" sub={regions.data ? `${regions.data.company.name} → region → shop → cashier` : ''}>
        <Btn onClick={async () => { const name = window.prompt('New region name'); if (name) { await api('/regions', { body: { name } }); regions.reload() } }}>Add region</Btn>
        <Btn kind="primary" onClick={() => setEdit('new')}>New shop</Btn>
      </PageHeader>
      <ErrorNote error={error} />
      <Card>
        <Table
          rows={data?.shops ?? []}
          onRow={setEdit}
          cols={[
            { key: 'code', label: 'Code', className: 'font-mono' },
            { key: 'name', label: 'Shop', render: (s) => <b>{s.name}</b> },
            { key: 'region', label: 'Region' },
            { key: 'address', label: 'Address' },
            { key: 'phone', label: 'Phone' },
            { key: 'manager', label: 'Manager', render: (s) => s.manager ?? '—' },
            { key: 'status', label: 'Status', render: (s) => <Badge tone={statusTone(s.status)}>{s.status}</Badge> },
            { key: 'cashiers', label: 'Cashiers', align: 'right' },
            { key: 'devices', label: 'Devices', align: 'right' },
            { key: 'turnoverToday', label: 'Turnover today', align: 'right', render: (s) => etb(s.turnoverToday) },
            { key: 'balance', label: 'Current balance', align: 'right', render: (s) => <b>{etb(s.balance)}</b> },
          ]}
        />
      </Card>
      {edit && <ShopForm shop={edit === 'new' ? null : edit} regions={regions.data?.regions ?? []} managers={(staff.data?.users ?? []).filter((u) => edit !== 'new' && u.shopId === edit.id)} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload() }} />}
    </>
  )
}

function ShopForm({ shop, regions, managers, onClose, onSaved }: { shop: Shop | null; regions: { id: number; name: string }[]; managers: UserRow[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ code: shop?.code ?? '', name: shop?.name ?? '', address: shop?.address ?? '', phone: shop?.phone ?? '', regionId: shop?.regionId ?? regions[0]?.id ?? 0, status: shop?.status ?? 'ACTIVE', managerId: shop?.managerId ?? '', opening: '0' })
  const [err, setErr] = useState('')
  async function save() {
    setErr('')
    try {
      if (shop) await api(`/shops/${shop.id}`, { method: 'PUT', body: { name: f.name, address: f.address, phone: f.phone, status: f.status, managerId: f.managerId === '' ? null : Number(f.managerId) } })
      else await api('/shops', { body: { code: f.code, name: f.name, address: f.address, phone: f.phone, regionId: Number(f.regionId), openingBalance: toSantim(f.opening) } })
      onSaved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed')
    }
  }
  return (
    <Modal onClose={onClose}>
      <div className="space-y-3 p-5">
        <h2 className="text-lg font-bold">{shop ? `Edit ${shop.name}` : 'New shop'}</h2>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Shop code"><input className={inp} value={f.code} disabled={!!shop} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} /></Field>
          <Field label="Name"><input className={inp} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Address"><input className={inp} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
          <Field label="Phone"><input className={inp} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          {!shop && <Field label="Region"><select className={sel} value={f.regionId} onChange={(e) => setF({ ...f, regionId: Number(e.target.value) })}>{regions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>}
          {!shop && <Field label="Opening balance (ETB)"><input className={inp} inputMode="decimal" value={f.opening} onChange={(e) => setF({ ...f, opening: e.target.value })} /></Field>}
          {shop && <Field label="Status"><select className={sel} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option>ACTIVE</option><option>SUSPENDED</option><option>CLOSED</option></select></Field>}
          {shop && <Field label="Manager"><select className={sel} value={f.managerId} onChange={(e) => setF({ ...f, managerId: e.target.value })}><option value="">— none —</option>{managers.map((m) => <option key={m.id} value={m.id}>{m.fullName}</option>)}</select></Field>}
        </div>
        {shop && <p className="text-xs text-soft">Suspending a shop stops its cashiers from signing in. The wallet balance and history are never deleted.</p>}
        <ErrorNote error={err} />
        <div className="flex justify-end gap-2"><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" onClick={save}>Save</Btn></div>
      </div>
    </Modal>
  )
}

export function Staff() {
  const auth = useAuth()
  const admin = auth?.user.role === 'ADMIN'
  const [shopId, setShopId] = useState('')
  const { data, error, reload } = useFetch<{ users: UserRow[] }>(`/users${shopId ? `?shopId=${shopId}` : ''}`, 15_000)
  const shops = useFetch<{ shops: Shop[] }>('/shops')
  const [edit, setEdit] = useState<UserRow | 'new' | null>(null)
  return (
    <>
      <PageHeader title={admin ? 'Cashiers & staff' : 'Cashiers'} sub="Shift figures update every 15 seconds.">
        {admin && <select className={sel + ' !w-auto'} value={shopId} onChange={(e) => setShopId(e.target.value)} aria-label="Filter by shop"><option value="">All shops</option>{shops.data?.shops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}
        <Btn kind="primary" onClick={() => setEdit('new')}>{admin ? 'New user' : 'New cashier'}</Btn>
      </PageHeader>
      <ErrorNote error={error} />
      <Card>
        <Table
          rows={data?.users ?? []}
          onRow={setEdit}
          cols={[
            { key: 'fullName', label: 'Name', render: (u) => <><b>{u.fullName}</b><div className="text-xs text-soft">{u.username}</div></> },
            { key: 'role', label: 'Role', render: (u) => <Badge tone={u.role === 'ADMIN' ? 'red' : u.role === 'MANAGER' ? 'blue' : 'gray'}>{u.role}</Badge> },
            { key: 'shop', label: 'Shop', render: (u) => u.shop ?? '—' },
            { key: 'cashierCode', label: 'ID', render: (u) => u.cashierCode ?? '—' },
            { key: 'shiftLabel', label: 'Shift' },
            { key: 'status', label: 'Status', render: (u) => <>{u.lockedUntil ? <Badge tone="red">LOCKED</Badge> : <Badge tone={statusTone(u.status)}>{u.status}</Badge>}{u.onShift && <span className="ml-1"><Badge tone="green">ON SHIFT</Badge></span>}</> },
            { key: 'openingFloat', label: 'Opening float', align: 'right', render: (u) => (u.role === 'CASHIER' ? etb(u.openingFloat) : '—') },
            { key: 'currentBalance', label: 'Current balance', align: 'right', render: (u) => (u.role === 'CASHIER' ? etb(u.currentBalance) : '—') },
            { key: 'totalSales', label: 'Total sales', align: 'right', render: (u) => (u.role === 'CASHIER' ? etb(u.totalSales) : '—') },
            { key: 'totalPayouts', label: 'Total payouts', align: 'right', render: (u) => (u.role === 'CASHIER' ? etb(u.totalPayouts) : '—') },
            { key: 'netBalance', label: 'Net', align: 'right', render: (u) => (u.role === 'CASHIER' ? etb(u.netBalance) : '—') },
            { key: 'lastLoginAt', label: 'Last sign-in', render: (u) => fmtDateTime(u.lastLoginAt) },
          ]}
        />
      </Card>
      {edit && <UserForm user={edit === 'new' ? null : edit} shops={shops.data?.shops ?? []} admin={!!admin} myShop={auth?.user.shopId ?? null} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload() }} />}
    </>
  )
}

function UserForm({ user, shops, admin, myShop, onClose, onSaved }: { user: UserRow | null; shops: Shop[]; admin: boolean; myShop: number | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    username: '', role: 'CASHIER', shopId: String(user?.shopId ?? myShop ?? shops[0]?.id ?? ''), fullName: user?.fullName ?? '', cashierCode: user?.cashierCode ?? '', phone: user?.phone ?? '',
    shiftLabel: user?.shiftLabel ?? 'FULL', payoutLimit: String((user?.payoutLimit ?? 5_000_000) / 100), status: user?.status ?? 'ACTIVE', password: '', pin: '', unlock: false,
  })
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const set = (k: string, v: unknown) => setF((p) => ({ ...p, [k]: v }))
  async function save() {
    setErr('')
    try {
      const common = { fullName: f.fullName, phone: f.phone, shiftLabel: f.shiftLabel, payoutLimit: toSantim(f.payoutLimit), cashierCode: f.cashierCode }
      if (user) await api(`/users/${user.id}`, { method: 'PUT', body: { ...common, status: f.status, unlock: f.unlock } })
      else await api('/users', { body: { ...common, username: f.username, role: f.role, shopId: Number(f.shopId), password: f.password, pin: f.pin } })
      onSaved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed')
    }
  }
  async function reset() {
    setErr('')
    try {
      await api(`/users/${user!.id}/reset`, { body: { ...(f.password ? { password: f.password } : {}), ...(f.pin ? { pin: f.pin } : {}) } })
      setNote('Credentials updated. The user was signed out everywhere.')
      set('password', '')
      set('pin', '')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed')
    }
  }
  const isCashier = (user?.role ?? f.role) === 'CASHIER'
  return (
    <Modal onClose={onClose} wide>
      <div className="space-y-4 p-5">
        <h2 className="text-lg font-bold">{user ? `Edit ${user.fullName}` : 'New user'}</h2>
        <div className="grid grid-cols-3 gap-3">
          {!user && <Field label="Username"><input className={inp} value={f.username} onChange={(e) => set('username', e.target.value.toLowerCase())} /></Field>}
          {!user && admin && <Field label="Role"><select className={sel} value={f.role} onChange={(e) => set('role', e.target.value)}><option>CASHIER</option><option>MANAGER</option><option>ADMIN</option></select></Field>}
          {!user && admin && f.role !== 'ADMIN' && <Field label="Shop"><select className={sel} value={f.shopId} onChange={(e) => set('shopId', e.target.value)}>{shops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>}
          <Field label="Full name"><input className={inp} value={f.fullName} onChange={(e) => set('fullName', e.target.value)} /></Field>
          <Field label="Phone (stored encrypted)"><input className={inp} value={f.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
          {isCashier && <Field label="Cashier ID (printed on tickets)"><input className={inp} value={f.cashierCode} placeholder="Cashier 03" onChange={(e) => set('cashierCode', e.target.value)} /></Field>}
          {isCashier && <Field label="Shift"><select className={sel} value={f.shiftLabel} onChange={(e) => set('shiftLabel', e.target.value)}><option>FULL</option><option>MORNING</option><option>AFTERNOON</option><option>NIGHT</option></select></Field>}
          {isCashier && <Field label="Payout limit (ETB)" hint="Larger payouts need manager approval"><input className={inp} inputMode="decimal" value={f.payoutLimit} onChange={(e) => set('payoutLimit', e.target.value)} /></Field>}
          {user && <Field label="Status"><select className={sel} value={f.status} onChange={(e) => set('status', e.target.value)}><option>ACTIVE</option><option>DISABLED</option></select></Field>}
        </div>
        {!user ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Password" hint="At least 8 characters"><input type="password" className={inp} autoComplete="new-password" value={f.password} onChange={(e) => set('password', e.target.value)} /></Field>
            <Field label="PIN" hint="4 to 6 digits, used to confirm payouts and cancellations"><input type="password" inputMode="numeric" className={inp} autoComplete="off" value={f.pin} onChange={(e) => set('pin', e.target.value.replace(/\D/g, ''))} maxLength={6} /></Field>
          </div>
        ) : (
          <div className="rounded border border-rule bg-paper p-3">
            <div className="mb-2 text-xs font-bold uppercase tracking-widest text-soft">Reset credentials</div>
            <div className="grid grid-cols-3 items-end gap-3">
              <Field label="New password"><input type="password" className={inp} autoComplete="new-password" value={f.password} onChange={(e) => set('password', e.target.value)} /></Field>
              <Field label="New PIN"><input type="password" inputMode="numeric" className={inp} autoComplete="off" value={f.pin} onChange={(e) => set('pin', e.target.value.replace(/\D/g, ''))} maxLength={6} /></Field>
              <Btn onClick={reset} disabled={!f.password && !f.pin}>Reset</Btn>
            </div>
            {user.lockedUntil && <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={f.unlock} onChange={(e) => set('unlock', e.target.checked)} /> Unlock this account on save</label>}
          </div>
        )}
        {note && <div className="text-sm text-emerald-700">{note}</div>}
        <ErrorNote error={err} />
        <div className="flex justify-end gap-2"><Btn onClick={onClose}>Close</Btn><Btn kind="primary" onClick={save}>Save</Btn></div>
      </div>
    </Modal>
  )
}

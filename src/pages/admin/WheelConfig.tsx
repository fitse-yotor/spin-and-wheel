import { useMemo, useState } from 'react'
import { Modal } from '@/components/Modal'
import { Wheel } from '@/components/Wheel'
import { Badge, Btn, Card, ErrorNote, Field, inp, PageHeader, sel, Table, useFetch } from '@/components/ui'
import { api } from '@/lib/api'
import { odds } from '@/lib/format'

interface Seg { id: number; number: number; name: string; category: string; multiplierX100: number; active: boolean; sortOrder: number }
interface WheelData { segments: Seg[]; categoryColors: Record<string, string> }

export function WheelConfig() {
  const { data, error, reload } = useFetch<WheelData>('/wheel')
  const [colors, setColors] = useState<Record<string, string> | null>(null)
  const [adding, setAdding] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const cols = colors ?? data?.categoryColors ?? {}
  const preview = useMemo(
    () => (data?.segments ?? []).filter((s) => s.active).sort((a, b) => a.sortOrder - b.sortOrder).map((s) => ({ number: s.number, name: s.name, category: s.category, multiplierX100: s.multiplierX100, color: cols[s.category] ?? '#555' })),
    [data, cols],
  )
  const categories = useMemo(() => [...new Set([...(data?.segments ?? []).map((s) => s.category), ...Object.keys(cols)])].sort(), [data, cols])

  async function saveColors() {
    setErr('')
    try {
      await api('/config', { method: 'PUT', body: { 'wheel.categoryColors': cols } })
      setMsg('Colours saved. They apply from the next round.')
      setColors(null)
      reload()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed')
    }
  }
  return (
    <>
      <PageHeader title="Wheel" sub="Every active segment has exactly the same chance of winning. Changes apply from the next round; a round in progress keeps the wheel it started with.">
        <Btn kind="primary" onClick={() => setAdding(true)}>Add segment</Btn>
      </PageHeader>
      <ErrorNote error={error || err} />
      {msg && <div className="mb-3 text-sm text-emerald-700">{msg}</div>}
      <div className="grid gap-4 xl:grid-cols-[22rem_1fr]">
        <div className="space-y-4">
          <Card title="Preview"><div className="mx-auto aspect-square w-full max-w-[20rem] bg-night p-4"><Wheel segments={preview} getAngle={() => 0} highlight={null} /></div></Card>
          <Card title="Category colours" actions={colors && <Btn kind="primary" onClick={saveColors}>Save</Btn>}>
            <div className="space-y-2 p-4">
              {categories.map((c) => (
                <label key={c} className="flex items-center justify-between text-sm font-semibold">{c}<input type="color" value={cols[c] ?? '#555555'} onChange={(e) => setColors({ ...cols, [c]: e.target.value })} className="h-8 w-14 cursor-pointer rounded border border-rule" /></label>
              ))}
            </div>
          </Card>
        </div>
        <Card>
          <Table
            rows={data?.segments ?? []}
            cols={[
              { key: 'sortOrder', label: 'Order', render: (s) => <SegEdit s={s} field="sortOrder" onSaved={reload} /> },
              { key: 'number', label: 'Number', render: (s) => <b>{s.number}</b> },
              { key: 'name', label: 'Display name', render: (s) => <SegEdit s={s} field="name" onSaved={reload} /> },
              { key: 'category', label: 'Category', render: (s) => <SegEdit s={s} field="category" onSaved={reload} colors={cols} /> },
              { key: 'multiplierX100', label: 'Multiplier (exact-number odds)', render: (s) => <SegEdit s={s} field="multiplierX100" onSaved={reload} /> },
              { key: 'active', label: 'Active', render: (s) => <input type="checkbox" aria-label={`Segment ${s.number} active`} checked={s.active} onChange={async (e) => { try { await api(`/wheel/segments/${s.id}`, { method: 'PUT', body: { active: e.target.checked } }); reload() } catch (er) { setErr(er instanceof Error ? er.message : 'Failed') } }} /> },
              { key: 'id', label: 'Segment ID', className: 'text-soft', render: (s) => `SEG-${s.id}` },
            ]}
          />
        </Card>
      </div>
      {adding && <AddSegment categories={categories} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload() }} />}
    </>
  )
}

function SegEdit({ s, field, onSaved, colors }: { s: Seg; field: 'name' | 'category' | 'multiplierX100' | 'sortOrder'; onSaved: () => void; colors?: Record<string, string> }) {
  const initial = field === 'multiplierX100' ? odds(s.multiplierX100) : String(s[field])
  const [v, setV] = useState(initial)
  const [bad, setBad] = useState(false)
  async function commit() {
    if (v === initial) return
    try {
      await api(`/wheel/segments/${s.id}`, { method: 'PUT', body: { [field]: field === 'multiplierX100' ? Math.round(Number(v) * 100) : field === 'sortOrder' ? Number(v) : v } })
      setBad(false)
      onSaved()
    } catch {
      setBad(true)
    }
  }
  return (
    <span className="flex items-center gap-2">
      {field === 'category' && <i className="inline-block h-3 w-3 rounded-full border border-black/20" style={{ background: colors?.[v.toUpperCase()] ?? '#999' }} />}
      <input value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} aria-label={`${field} of segment ${s.number}`} className={`${inp} !w-24 ${bad ? '!border-red-600' : ''} ${field === 'multiplierX100' ? 'text-right' : ''}`} />
      {field === 'multiplierX100' && <span className="text-soft">x</span>}
    </span>
  )
}

function AddSegment({ categories, onClose, onSaved }: { categories: string[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ number: '', name: '', category: categories[0] ?? 'RED', multiplier: '20' })
  const [err, setErr] = useState('')
  async function save() {
    try {
      await api('/wheel/segments', { body: { number: Number(f.number), name: f.name || f.number, category: f.category, multiplierX100: Math.round(Number(f.multiplier) * 100) } })
      onSaved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed')
    }
  }
  return (
    <Modal onClose={onClose}>
      <div className="space-y-3 p-5">
        <h2 className="text-lg font-bold">Add segment</h2>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Number"><input className={inp} inputMode="numeric" value={f.number} onChange={(e) => setF({ ...f, number: e.target.value.replace(/\D/g, '') })} /></Field>
          <Field label="Display name"><input className={inp} value={f.name} placeholder={f.number} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Category"><input className={inp} list="cats" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value.toUpperCase() })} /><datalist id="cats">{categories.map((c) => <option key={c} value={c} />)}</datalist></Field>
          <Field label="Multiplier (x)"><input className={inp} inputMode="decimal" value={f.multiplier} onChange={(e) => setF({ ...f, multiplier: e.target.value })} /></Field>
        </div>
        <ErrorNote error={err} />
        <div className="flex justify-end gap-2"><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" onClick={save} disabled={!f.number}>Add</Btn></div>
      </div>
    </Modal>
  )
}

// ── Markets & odds ──────────────────────────────────────────────────────────
interface Opt { id: number; code: string; label: string; numbers: number[]; oddsX100: number; oddsSource: 'FIXED' | 'SEGMENT'; tone: string; active: boolean; coverage: number; wheelSize: number; hitChance: number; theoreticalReturn: number }
interface Market { id: number; code: string; name: string; kind: string; active: boolean; options: Opt[] }

export function Markets() {
  const { data, error, reload } = useFetch<{ markets: Market[] }>('/markets')
  const wheel = useFetch<WheelData>('/wheel')
  const [adding, setAdding] = useState<Market | null>(null)
  const [newMarket, setNewMarket] = useState(false)
  const [openM, setOpenM] = useState<Record<number, boolean>>({})
  const [err, setErr] = useState('')
  const act = async (fn: () => Promise<unknown>) => {
    setErr('')
    try {
      await fn()
      reload()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed')
    }
  }
  return (
    <>
      <PageHeader title="Markets & odds" sub="Odds are shown with the wheel's real hit chance and the theoretical return to player (RTP). Odds saved here apply to tickets booked from now on; existing tickets keep the odds they were sold at.">
        <Btn kind="primary" onClick={() => setNewMarket(true)}>New market</Btn>
      </PageHeader>
      <ErrorNote error={error || err} />
      <div className="space-y-4">
        {data?.markets.map((m) => (
          <Card key={m.id} title={`${m.name} · ${m.code} · ${m.options.length} options`} actions={
            <div className="flex items-center gap-2">
              {!m.active && <Badge tone="red">DISABLED</Badge>}
              <Btn kind="ghost" onClick={() => setOpenM((o) => ({ ...o, [m.id]: !(o[m.id] ?? m.options.length <= 10) }))}>{(openM[m.id] ?? m.options.length <= 10) ? 'Collapse' : 'Show options'}</Btn>
              <Btn onClick={() => setAdding(m)}>Add option</Btn>
              <Btn onClick={() => act(() => api(`/markets/${m.id}`, { method: 'PUT', body: { active: !m.active } }))}>{m.active ? 'Disable market' : 'Enable market'}</Btn>
            </div>
          }>
            {(openM[m.id] ?? m.options.length <= 10) ? <Table
              rows={m.options}
              cols={[
                { key: 'label', label: 'Option', render: (o) => <b>{o.label}</b> },
                { key: 'numbers', label: 'Covers', render: (o) => <span className="text-soft">{o.numbers.length > 8 ? `${o.numbers.length} numbers` : o.numbers.join(', ')}</span> },
                { key: 'oddsX100', label: 'Odds (x)', align: 'right', render: (o) => <OddsEdit o={o} onSave={(v) => act(() => api(`/options/${o.id}`, { method: 'PUT', body: { oddsX100: v } }))} /> },
                { key: 'hit', label: 'Hit chance', align: 'right', render: (o) => `${(o.hitChance * 100).toFixed(1)}%` },
                { key: 'rtp', label: 'Return to player', align: 'right', render: (o) => <Badge tone={o.theoreticalReturn > 1 ? 'red' : o.theoreticalReturn > 0.95 ? 'amber' : 'gray'}>{(o.theoreticalReturn * 100).toFixed(1)}%</Badge> },
                { key: 'active', label: 'Active', render: (o) => <input type="checkbox" aria-label={`${o.label} active`} checked={o.active} onChange={(e) => act(() => api(`/options/${o.id}`, { method: 'PUT', body: { active: e.target.checked } }))} /> },
              ]}
            /> : <div className="px-4 py-3 text-sm text-soft">Return to player: {(Math.min(...m.options.map((o) => o.theoreticalReturn)) * 100).toFixed(1)}% – {(Math.max(...m.options.map((o) => o.theoreticalReturn)) * 100).toFixed(1)}% across {m.options.length} options.</div>}
          </Card>
        ))}
      </div>
      {adding && <AddOption market={adding} numbers={(wheel.data?.segments ?? []).map((s) => s.number)} wheel={wheel.data} onClose={() => setAdding(null)} onSaved={() => { setAdding(null); reload() }} />}
      {newMarket && <NewMarket onClose={() => setNewMarket(false)} onSaved={() => { setNewMarket(false); reload() }} />}
    </>
  )
}

function OddsEdit({ o, onSave }: { o: Opt; onSave: (x100: number) => void }) {
  const [v, setV] = useState(odds(o.oddsX100))
  if (o.oddsSource === 'SEGMENT') return <span className="text-soft" title="Follows each wheel segment's multiplier">per segment</span>
  const commit = () => {
    const x = Math.round(Number(v) * 100)
    if (x !== o.oddsX100 && x >= 100) onSave(x)
    else setV(odds(o.oddsX100))
  }
  return <input value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} aria-label={`Odds for ${o.label}`} className={inp + ' !w-20 text-right'} />
}

function NewMarket({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: '', code: '' })
  const [err, setErr] = useState('')
  return (
    <Modal onClose={onClose}>
      <div className="space-y-3 p-5">
        <h2 className="text-lg font-bold">New betting market</h2>
        <Field label="Name"><input className={inp} value={f.name} onChange={(e) => setF({ name: e.target.value, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '_').slice(0, 20) })} /></Field>
        <Field label="Code"><input className={inp} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>
        <p className="text-xs text-soft">After creating the market, add its options (which wheel numbers each one covers, and the odds).</p>
        <ErrorNote error={err} />
        <div className="flex justify-end gap-2"><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" disabled={!f.name} onClick={async () => { try { await api('/markets', { body: f }); onSaved() } catch (e) { setErr(e instanceof Error ? e.message : 'Failed') } }}>Create</Btn></div>
      </div>
    </Modal>
  )
}

function AddOption({ market, numbers, wheel, onClose, onSaved }: { market: Market; numbers: number[]; wheel: WheelData | null; onClose: () => void; onSaved: () => void }) {
  const [label, setLabel] = useState('')
  const [code, setCode] = useState('')
  const [oddsV, setOddsV] = useState('2.00')
  const [picked, setPicked] = useState<number[]>([])
  const [err, setErr] = useState('')
  const toggle = (n: number) => setPicked((p) => (p.includes(n) ? p.filter((x) => x !== n) : [...p, n]))
  const cats = [...new Set((wheel?.segments ?? []).map((s) => s.category))]
  const fair = picked.length ? (numbers.length / picked.length) : 0
  return (
    <Modal onClose={onClose} wide>
      <div className="space-y-3 p-5">
        <h2 className="text-lg font-bold">Add option to {market.name}</h2>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Label"><input className={inp} value={label} onChange={(e) => { setLabel(e.target.value); setCode(`${market.code}_${e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')}`) }} /></Field>
          <Field label="Code"><input className={inp} value={code} onChange={(e) => setCode(e.target.value)} /></Field>
          <Field label="Odds (x)" hint={picked.length ? `Break-even odds for ${picked.length}/${numbers.length} numbers: ${fair.toFixed(2)}x` : undefined}><input className={inp} inputMode="decimal" value={oddsV} onChange={(e) => setOddsV(e.target.value)} /></Field>
        </div>
        <div>
          <div className="mb-1 flex flex-wrap items-center gap-2 text-xs font-semibold text-soft">Wheel numbers covered
            <Btn kind="ghost" onClick={() => setPicked(numbers.filter((n) => n % 2 === 1))}>Odd</Btn>
            <Btn kind="ghost" onClick={() => setPicked(numbers.filter((n) => n % 2 === 0))}>Even</Btn>
            {cats.map((c) => <Btn key={c} kind="ghost" onClick={() => setPicked((wheel?.segments ?? []).filter((s) => s.category === c && s.active).map((s) => s.number))}>{c}</Btn>)}
            <Btn kind="ghost" onClick={() => setPicked([])}>Clear</Btn>
          </div>
          <div className="grid grid-cols-10 gap-1">
            {numbers.map((n) => <button key={n} onClick={() => toggle(n)} className={`rounded border py-1 text-sm font-semibold ${picked.includes(n) ? 'border-ink bg-ink text-white' : 'border-rule bg-white hover:bg-paper'}`}>{n}</button>)}
          </div>
        </div>
        <ErrorNote error={err} />
        <div className="flex justify-end gap-2"><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" disabled={!label || !picked.length} onClick={async () => { try { await api(`/markets/${market.id}/options`, { body: { code, label, numbers: picked, oddsX100: Math.round(Number(oddsV) * 100), oddsSource: 'FIXED' } }); onSaved() } catch (e) { setErr(e instanceof Error ? e.message : 'Failed') } }}>Add option</Btn></div>
      </div>
    </Modal>
  )
}

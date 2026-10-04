# Animação da porta guilhotina — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Animar no `/live` as portas guilhotina C/D (frontal + corte) a partir das saídas do CLP, com injeção de falhas (obstáculo, FC travado, vazamento da guarnição, pistão lento).

**Architecture:** O modelo da porta já vive em `DeltaPlcBridge` (`apps/web/server/bridge/delta-plc.ts`). Estendemos com estado da guarnição e falhas, expomos `doors` no snapshot (SSE já existente), uma rota `POST /api/door-faults` altera falhas em memória, e um componente SVG `DoorView` desenha tudo.

**Tech Stack:** TypeScript, Next.js (app router), React, Tailwind, vitest. Spec: `docs/superpowers/specs/2026-10-01-animacao-porta-design.md`.

Comandos (rodar em `apps/web`):
- teste: `pnpm exec vitest run test/bridge/delta-plc.test.ts`
- tipos: `pnpm exec tsc --noEmit`

Mapa de bits no `FakePlc` do teste: `m[8]` FC fechada C, `m[10]` FC aberta C, `m[12]` press. guarnição C, `m[14]` antiesmaga C, `m[49]` guarn. ar C, `m[50]` guarn. vácuo C, `m[53]` abrir C, `m[54]` fechar C.

---

### Task 1: Modelo da porta com guarnição e falhas

**Files:**
- Modify: `apps/web/server/bridge/delta-plc.ts`
- Test: `apps/web/test/bridge/delta-plc.test.ts`

- [ ] **Step 1: Escrever os testes (falhando)** — acrescentar dentro do `describe('DeltaPlcBridge', ...)`, no fim:

```ts
  it('guarnição: recolhida → vácuo → pressurizando → selada', async () => {
    const { plc, b } = await setup();
    await b.sync(0.2);
    expect(b.doorState('C').seal).toBe('recolhida');
    plc.m[50] = true;
    await b.sync(0.2);
    expect(b.doorState('C').seal).toBe('vacuo');
    plc.m[50] = false;
    plc.m[49] = true;
    await b.sync(0.2);
    expect(b.doorState('C').seal).toBe('pressurizando');
    for (let i = 0; i < 10; i++) await b.sync(0.2);
    expect(b.doorState('C').seal).toBe('selada');
    expect(plc.m[12]).toBe(true);
  });

  it('vazamento: guarnição nunca pressuriza', async () => {
    const { plc, b } = await setup();
    b.setFaults('C', { vazamento: true });
    plc.m[49] = true;
    for (let i = 0; i < 20; i++) await b.sync(0.2);
    expect(b.doorState('C').seal).toBe('pressurizando');
    expect(plc.m[12]).toBe(false);
  });

  it('obstáculo segura a porta e liga antiesmaga', async () => {
    const { plc, b } = await setup();
    plc.m[53] = true;
    for (let i = 0; i < 26; i++) await b.sync(0.2);
    plc.m[53] = false;
    b.setFaults('C', { obstaculo: 0.5 });
    plc.m[54] = true;
    for (let i = 0; i < 30; i++) await b.sync(0.2);
    expect(b.doorState('C').pos).toBeCloseTo(0.5, 5);
    expect(plc.m[14]).toBe(true);
    expect(plc.m[8]).toBe(false);
    b.setFaults('C', { obstaculo: null });
    for (let i = 0; i < 20; i++) await b.sync(0.2);
    expect(plc.m[14]).toBe(false);
    expect(plc.m[8]).toBe(true);
  });

  it('FC travado ignora a posição', async () => {
    const { plc, b } = await setup();
    b.setFaults('C', { fc_fechada: false, fc_aberta: true });
    await b.sync(0.2);
    expect(plc.m[8]).toBe(false);
    expect(plc.m[10]).toBe(true);
    b.setFaults('C', { fc_fechada: null, fc_aberta: null });
    await b.sync(0.2);
    expect(plc.m[8]).toBe(true);
    expect(plc.m[10]).toBe(false);
  });

  it('pistão lento dobra o tempo de curso', async () => {
    const { plc, b } = await setup();
    b.setFaults('C', { pistao_lento: true });
    plc.m[53] = true;
    for (let i = 0; i < 26; i++) await b.sync(0.2);
    expect(plc.m[10]).toBe(false);
    for (let i = 0; i < 25; i++) await b.sync(0.2);
    expect(plc.m[10]).toBe(true);
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm exec vitest run test/bridge/delta-plc.test.ts`
Expected: FAIL — `b.doorState is not a function` / `b.setFaults is not a function`.

- [ ] **Step 3: Implementar em `delta-plc.ts`**

Logo após `export type PlcInput = ...`, adicionar:

```ts
export type DoorSide = 'C' | 'D';
export type SealState = 'recolhida' | 'vacuo' | 'pressurizando' | 'selada';
/** Falhas injetáveis na porta (só memória). null em FC = segue a posição. */
export interface DoorFaults {
  /** Posição 0–1 do obstáculo no vão; null = sem obstáculo. */
  obstaculo: number | null;
  fc_aberta: boolean | null;
  fc_fechada: boolean | null;
  vazamento: boolean;
  pistao_lento: boolean;
}
export interface DoorState {
  pos: number;
  seal: SealState;
  faults: DoorFaults;
  fc_aberta: boolean;
  fc_fechada: boolean;
  antiesmaga: boolean;
  press_guarn: boolean;
}
const noFaults = (): DoorFaults => ({
  obstaculo: null,
  fc_aberta: null,
  fc_fechada: null,
  vazamento: false,
  pistao_lento: false,
});
```

Na classe, após `private sealOn_s = ...`:

```ts
  /** Falhas ativas por lado (ver setFaults). */
  readonly faults: Record<DoorSide, DoorFaults> = { C: noFaults(), D: noFaults() };

  setFaults(side: DoorSide, f: Partial<DoorFaults>): void {
    Object.assign(this.faults[side], f);
  }

  private fcAberta(s: DoorSide): boolean {
    return this.faults[s].fc_aberta ?? this.door[s] >= 0.98;
  }

  private fcFechada(s: DoorSide): boolean {
    return this.faults[s].fc_fechada ?? this.door[s] <= 0.02;
  }

  private antiesmaga(s: DoorSide): boolean {
    const o = this.faults[s].obstaculo;
    return o !== null && this.door[s] <= o + 0.01;
  }

  doorState(s: DoorSide): DoorState {
    const ar = this.out(`OUT_GUARN_AR_${s}`);
    const seal: SealState = this.out(`OUT_GUARN_VAC_${s}`)
      ? 'vacuo'
      : ar
        ? this.sealOk(s)
          ? 'selada'
          : 'pressurizando'
        : 'recolhida';
    return {
      pos: this.door[s],
      seal,
      faults: { ...this.faults[s] },
      fc_aberta: this.fcAberta(s),
      fc_fechada: this.fcFechada(s),
      antiesmaga: this.antiesmaga(s),
      press_guarn: this.sealOk(s),
    };
  }
```

Substituir `sealOk`:

```ts
  private sealOk(side: DoorSide): boolean {
    return !this.faults[side].vazamento && this.sealOn_s[side] >= SEAL_PRESSURIZE_S;
  }
```

Em `writeCoils`, trocar o array do `0x1004` por:

```ts
    await super.writeCoils(0x1004, [
      this.fcAberta('C'),
      this.fcFechada('C'),
      this.fcAberta('D'),
      this.fcFechada('D'),
    ]);
```

Em `sync`, trocar o corpo do `for (const s of ['C', 'D'] as const)` por:

```ts
      const v =
        (this.out(`OUT_PORTA_ABRIR_${s}`) ? 1 : 0) - (this.out(`OUT_PORTA_FECHAR_${s}`) ? 1 : 0);
      const speed = DOOR_SPEED_PER_S * (this.faults[s].pistao_lento ? 0.5 : 1);
      const prev = this.door[s];
      let pos = Math.max(0, Math.min(1, prev + v * speed * dt_s));
      const o = this.faults[s].obstaculo;
      if (o !== null && prev >= o) pos = Math.max(pos, o); // obstáculo no vão: porta encosta e para
      this.door[s] = pos;
      this.sealOn_s[s] = this.out(`OUT_GUARN_AR_${s}`) ? this.sealOn_s[s] + dt_s : 0;
```

Em `computeInputs`, trocar as 8 linhas FC/guarnição/antiesmaga por:

```ts
      IN_FC_FECHADA_C: this.fcFechada('C'),
      IN_FC_FECHADA_D: this.fcFechada('D'),
      IN_FC_ABERTA_C: this.fcAberta('C'),
      IN_FC_ABERTA_D: this.fcAberta('D'),
      IN_PRESS_GUARN_C: this.sealOk('C'),
      IN_PRESS_GUARN_D: this.sealOk('D'),
      IN_ANTIESMAGA_C: this.antiesmaga('C'),
      IN_ANTIESMAGA_D: this.antiesmaga('D'),
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm exec vitest run test/bridge/delta-plc.test.ts`
Expected: todos PASS (os antigos inclusive).

- [ ] **Step 5: Commit**

```bash
git add apps/web/server/bridge/delta-plc.ts apps/web/test/bridge/delta-plc.test.ts
git commit -m "feat(bridge): porta com estado da guarnição e falhas injetáveis"
```

---

### Task 2: `doors` no snapshot + rota de falhas

**Files:**
- Modify: `apps/web/server/runtime/snapshot.ts`
- Modify: `apps/web/server/runtime/singleton.ts:304-316`
- Create: `apps/web/app/api/door-faults/route.ts`

- [ ] **Step 1: Snapshot** — em `snapshot.ts`, adicionar import no topo:

```ts
import type { DoorSide, DoorState } from '../bridge/delta-plc.js';
```

Na `interface Snapshot`, após `plc_phase?: number;`:

```ts
  /** Só com SIM_PLC=delta: portas C/D (posição, guarnição, FC, falhas). */
  doors?: Record<DoorSide, DoorState>;
```

Na `BuildSnapshotOpts`, após `plc_phase?: number;`:

```ts
  doors?: Record<DoorSide, DoorState>;
```

No `return` de `buildSnapshot`, após a linha do `plc_phase`:

```ts
    ...(o.doors && { doors: o.doors }),
```

- [ ] **Step 2: Runtime** — em `singleton.ts`, trocar a linha
`...(delta && { plc_outputs: delta.outputs, plc_phase: delta.fase }),` por:

```ts
      ...(delta && {
        plc_outputs: delta.outputs,
        plc_phase: delta.fase,
        doors: { C: delta.doorState('C'), D: delta.doorState('D') },
      }),
```

- [ ] **Step 3: Rota** — criar `apps/web/app/api/door-faults/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { getRuntime } from '../../../server/runtime/singleton';
import { DeltaPlcBridge, type DoorFaults } from '../../../server/bridge/delta-plc';

export const dynamic = 'force-dynamic';

const KEYS = ['obstaculo', 'fc_aberta', 'fc_fechada', 'vazamento', 'pistao_lento'] as const;

/** POST { side: 'C'|'D', faults: Partial<DoorFaults> } — merge nas falhas da porta (memória). */
export async function POST(req: Request) {
  const bridge = getRuntime().bridge;
  if (!(bridge instanceof DeltaPlcBridge)) {
    return NextResponse.json({ error: 'só com SIM_PLC=delta' }, { status: 409 });
  }
  let body: { side?: unknown; faults?: Record<string, unknown> };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  if (body.side !== 'C' && body.side !== 'D') {
    return NextResponse.json({ error: "side deve ser 'C' ou 'D'" }, { status: 400 });
  }
  const f = body.faults ?? {};
  const out: Partial<DoorFaults> = {};
  for (const k of KEYS) {
    if (!(k in f)) continue;
    const v = f[k];
    const ok =
      k === 'obstaculo'
        ? v === null || (typeof v === 'number' && v >= 0 && v <= 1)
        : k === 'vazamento' || k === 'pistao_lento'
          ? typeof v === 'boolean'
          : v === null || typeof v === 'boolean';
    if (!ok) return NextResponse.json({ error: `valor inválido em ${k}` }, { status: 400 });
    (out as Record<string, unknown>)[k] = v;
  }
  bridge.setFaults(body.side, out);
  return NextResponse.json({ ok: true, side: body.side, faults: bridge.faults[body.side] });
}
```

- [ ] **Step 4: Tipos e testes**

Run: `pnpm exec tsc --noEmit && pnpm exec vitest run`
Expected: sem erros de tipo; todos os testes PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/server/runtime/snapshot.ts apps/web/server/runtime/singleton.ts apps/web/app/api/door-faults/route.ts
git commit -m "feat(api): portas no snapshot e POST /api/door-faults"
```

---

### Task 3: Componente `DoorView` no `/live`

**Files:**
- Create: `apps/web/components/live/DoorView.tsx`
- Modify: `apps/web/app/live/page.tsx`

- [ ] **Step 1: Criar `apps/web/components/live/DoorView.tsx`**

```tsx
'use client';

import { Card } from '../ui/Card';
import type { Snapshot } from '../../server/runtime/snapshot';
import type { DoorFaults, DoorSide, DoorState, SealState } from '../../server/bridge/delta-plc';

const SEAL_COLOR: Record<SealState, string> = {
  recolhida: '#64748b',
  vacuo: '#3b82f6',
  pressurizando: '#eab308',
  selada: '#22c55e',
};

function Led({ x, y, on, label, color = '#22c55e' }: { x: number; y: number; on: boolean; label: string; color?: string }) {
  return (
    <g>
      <circle cx={x} cy={y} r={5} fill={on ? color : '#1e293b'} stroke="#475569" />
      <text x={x + 9} y={y + 4} fontSize={10} fill="#cbd5e1">{label}</text>
    </g>
  );
}

/** Vista frontal: trilhos, porta (sobe = abre), pistão em cima, LEDs. */
function Frontal({ d }: { d: DoorState }) {
  const OPEN_H = 110; // curso em px
  const doorY = 140 - d.pos * OPEN_H; // topo da porta fechada em y=140
  const obst = d.faults.obstaculo;
  return (
    <svg viewBox="0 0 220 300" className="w-full h-auto">
      {/* pistão: cilindro fixo + haste até a porta */}
      <rect x={100} y={4} width={20} height={20} fill="#334155" stroke="#94a3b8" />
      <rect x={107} y={24} width={6} height={Math.max(0, doorY - 24)} fill="#cbd5e1" style={{ transition: 'height 0.25s linear' }} />
      {/* trilhos */}
      <rect x={36} y={20} width={6} height={270} fill="#475569" />
      <rect x={178} y={20} width={6} height={270} fill="#475569" />
      {/* boca da câmara */}
      <rect x={50} y={150} width={120} height={120} fill="#0f172a" stroke="#334155" />
      {/* porta */}
      <g style={{ transform: `translateY(${doorY}px)`, transition: 'transform 0.25s linear' }}>
        <rect x={44} y={0} width={132} height={135} rx={3} fill="#94a3b8" stroke={SEAL_COLOR[d.seal]} strokeWidth={4} />
      </g>
      {/* obstáculo no vão */}
      {obst !== null && (
        <rect x={95} y={275 - obst * OPEN_H} width={30} height={10} fill="#ef4444" />
      )}
      <Led x={10} y={290} on={d.fc_aberta} label="" />
      <Led x={10} y={150} on={d.fc_fechada} label="" />
      <Led x={190} y={290} on={d.antiesmaga} label="" color="#ef4444" />
    </svg>
  );
}

/** Corte lateral: porta, guarnição contra o flange da câmara. */
function Corte({ d }: { d: DoorState }) {
  const OPEN_H = 110;
  const doorY = 140 - d.pos * OPEN_H;
  const sealX = d.seal === 'selada' || d.seal === 'pressurizando' ? 96 : d.seal === 'vacuo' ? 90 : 92;
  return (
    <svg viewBox="0 0 160 300" className="w-full h-auto">
      {/* câmara + flange */}
      <rect x={100} y={140} width={56} height={140} fill="#1e293b" stroke="#475569" />
      <rect x={98} y={140} width={6} height={140} fill="#64748b" />
      {/* porta em corte */}
      <g style={{ transform: `translateY(${doorY}px)`, transition: 'transform 0.25s linear' }}>
        <rect x={70} y={0} width={16} height={140} fill="#94a3b8" />
        <rect x={86} y={0} width={6} height={140} fill="#475569" />
      </g>
      {/* guarnição (no canal da porta, empurra contra o flange quando pressurizada) */}
      <g style={{ transform: `translateY(${doorY}px)`, transition: 'transform 0.25s linear' }}>
        <rect x={sealX - 4} y={10} width={6} height={120} rx={3} fill={SEAL_COLOR[d.seal]} style={{ transition: 'x 0.3s' }} />
      </g>
      <text x={4} y={296} fontSize={10} fill="#cbd5e1">guarnição: {d.seal}</text>
    </svg>
  );
}

async function setFaults(side: DoorSide, faults: Partial<DoorFaults>) {
  await fetch('/api/door-faults', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ side, faults }),
  });
}

function TriState({ label, value, onChange }: { label: string; value: boolean | null; onChange: (v: boolean | null) => void }) {
  const opts: Array<[string, boolean | null]> = [['livre', null], ['0', false], ['1', true]];
  return (
    <div className="flex items-center gap-1">
      <span className="w-24">{label}</span>
      {opts.map(([t, v]) => (
        <button
          key={t}
          onClick={() => onChange(v)}
          className={`px-2 rounded border border-slate-600 ${value === v ? 'bg-slate-600' : ''}`}
        >
          {t}
        </button>
      ))}
    </div>
  );
}

function Faults({ side, d }: { side: DoorSide; d: DoorState }) {
  const f = d.faults;
  return (
    <div className="space-y-1 text-xs text-slate-300">
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={f.obstaculo !== null} onChange={(e) => setFaults(side, { obstaculo: e.target.checked ? 0.3 : null })} />
        obstáculo
        <input
          type="range" min={0} max={1} step={0.05} disabled={f.obstaculo === null}
          value={f.obstaculo ?? 0.3}
          onChange={(e) => setFaults(side, { obstaculo: Number(e.target.value) })}
        />
      </label>
      <TriState label="FC aberta" value={f.fc_aberta} onChange={(v) => setFaults(side, { fc_aberta: v })} />
      <TriState label="FC fechada" value={f.fc_fechada} onChange={(v) => setFaults(side, { fc_fechada: v })} />
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={f.vazamento} onChange={(e) => setFaults(side, { vazamento: e.target.checked })} />
        guarnição com vazamento
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={f.pistao_lento} onChange={(e) => setFaults(side, { pistao_lento: e.target.checked })} />
        pistão lento
      </label>
    </div>
  );
}

export function DoorView({ snap }: { snap: Snapshot | null }) {
  if (!snap?.doors) return <Card title="Portas">Só com SIM_PLC=delta.</Card>;
  return (
    <Card title="Portas">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {(['C', 'D'] as const).map((s) => {
          const d = snap.doors![s];
          return (
            <div key={s} className="space-y-2">
              <div className="text-sm font-semibold text-slate-200">
                Lado {s === 'C' ? 'C (limpo)' : 'D (estéril)'} — {Math.round(d.pos * 100)}% aberta
              </div>
              <div className="grid grid-cols-[3fr_2fr] gap-2">
                <Frontal d={d} />
                <Corte d={d} />
              </div>
              <div className="flex gap-3 text-xs text-slate-400">
                <span>FC ab: {d.fc_aberta ? '1' : '0'}</span>
                <span>FC fe: {d.fc_fechada ? '1' : '0'}</span>
                <span>press. guarn: {d.press_guarn ? '1' : '0'}</span>
                <span className={d.antiesmaga ? 'text-red-400' : ''}>antiesmaga: {d.antiesmaga ? '1' : '0'}</span>
              </div>
              <Faults side={s} d={d} />
            </div>
          );
        })}
      </div>
    </Card>
  );
}
```

Nota: o obstáculo fica logo abaixo da borda de baixo da porta quando `pos = obst` (borda = `doorY + 135` = `275 - obst*110`). LEDs sem rótulo no SVG: os valores aparecem em texto abaixo.

- [ ] **Step 2: Encaixar no `/live`** — em `apps/web/app/live/page.tsx`, import:

```tsx
import { DoorView } from '../../components/live/DoorView';
```

e dentro do grid, antes do `<div className="lg:col-span-2"><DigitalTimeline .../></div>`:

```tsx
        <div className="lg:col-span-2">
          <DoorView snap={snapshot} />
        </div>
```

- [ ] **Step 3: Tipos e testes**

Run: `pnpm exec tsc --noEmit && pnpm exec vitest run`
Expected: sem erros; PASS.

- [ ] **Step 4: Ver rodando** — com o servidor (`SIM_PLC=delta pnpm --filter @sim/web dev`) aberto em `http://localhost:3030/live`, conferir via Playwright (screenshot) que o card "Portas" aparece com os dois lados. Se o CLP real não estiver acessível, só conferir que o card renderiza "Só com SIM_PLC=delta." sem erro no console.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/live/DoorView.tsx apps/web/app/live/page.tsx
git commit -m "feat(live): animação das portas (frontal + corte) com falhas"
```

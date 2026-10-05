import { describe, it, expect } from 'vitest';
import { DeltaPlcBridge } from '../../server/bridge/delta-plc.js';
import { RegisterAccess } from '../../server/bridge/register-access.js';
import type { ModbusTransport } from '../../server/bridge/modbus-tcp.js';

class FakePlc implements ModbusTransport {
  m = new Array<boolean>(600).fill(false); // folga pro bit de corte de energia (ex. M500 no teste)
  d = new Array<number>(1000).fill(0);
  down = false;
  async readBits(a: number, n: number): Promise<boolean[]> {
    if (this.down) throw new Error('offline');
    return this.m.slice(a - 0x800, a - 0x800 + n);
  }
  async writeBits(a: number, v: boolean[]): Promise<void> {
    v.forEach((x, i) => (this.m[a - 0x800 + i] = x));
  }
  async readRegs(a: number, n: number): Promise<number[]> {
    return this.d.slice(a - 0x1000, a - 0x1000 + n);
  }
  async writeRegs(a: number, v: number[]): Promise<void> {
    // writeInt16BE igual ao transporte real: RangeError em fracionário ou fora de -32768..32767.
    v.forEach((x, i) => {
      Buffer.alloc(2).writeInt16BE(x, 0);
      this.d[a - 0x1000 + i] = x;
    });
  }
  close(): void {}
}

async function setup() {
  const plc = new FakePlc();
  // Registrador de fase fictício (900): o real vem de SIM_PLC_PHASE_REG.
  const b = new DeltaPlcBridge(plc, 0, undefined, null, 900);
  await b.connect();
  return { plc, b, acc: new RegisterAccess(b) };
}

describe('DeltaPlcBridge', () => {
  it('M40..M59 viram DI; fail-safe após falhas seguidas', async () => {
    const { plc, b, acc } = await setup();
    plc.m[40] = true; // bomba vácuo
    plc.m[43] = true; // vapor câmara
    plc.m[58] = true; // exaustão
    plc.m[59] = true; // LED fim de ciclo (M59, sem equivalente na física — só outputs/dashboard)
    await b.sync(0.2);
    expect(await acc.getDiscrete('PUMP_VAC')).toBe(true);
    expect(await acc.getDiscrete('V_STEAM_IN_INT')).toBe(true);
    expect(await acc.getDiscrete('V_EXHAUST')).toBe(true);
    expect(await acc.getDiscrete('V_VAC')).toBe(false);
    expect(b.outputs.OUT_LED_FIM_CICLO).toBe(true);
    plc.down = true;
    await b.sync(0.2);
    expect(await acc.getDiscrete('PUMP_VAC')).toBe(true); // mantém último comando
    await b.sync(0.2);
    await b.sync(0.2);
    expect(await acc.getDiscrete('PUMP_VAC')).toBe(false);
  });

  it('escala e clamp dos analógicos brutos', async () => {
    const { plc, b, acc } = await setup();
    await acc.setAnalog('T_CHAMBER_INT', 121.37);
    await acc.setAnalog('T_TESTEMUNHO', 120.04);
    await acc.setAnalog('T_CHAMBER_EXT', 130);
    await acc.setAnalog('P_CHAMBER_INT', 2.1234);
    await acc.setAnalog('P_CHAMBER_EXT', 4.5);
    await acc.setAnalog('P_GENERATOR', -0.2);
    await b.sync(0.2);
    expect(plc.d.slice(10, 14)).toEqual([1214, 1214, 1300, 1200]);
    expect(plc.d.slice(30, 33)).toEqual([2123, 4000, 0]);
  });

  it('gerador: bruto = p/fundo × 4000 (fundo 10 → 1816; fundo 4 → satura)', async () => {
    const { plc, b, acc } = await setup();
    await acc.setAnalog('P_GENERATOR', 4.54);
    await b.sync(0.2);
    expect(plc.d[32]).toBe(1816);
    b.fundoGerBar = 4;
    await b.sync(0.2);
    expect(plc.d[32]).toBe(4000);
  });

  it('porta leva 5 s, guarnição 2 s, overrides e M1', async () => {
    const { plc, b, acc } = await setup();
    await acc.setAnalog('P_CHAMBER_INT', 1.02);
    await b.sync(0.2);
    expect(plc.m[8]).toBe(true); // fechada C
    expect(plc.m[1]).toBe(true); // câmara na atm
    plc.m[53] = true; // abrir C
    for (let i = 0; i < 24; i++) await b.sync(0.2);
    expect(plc.m[8]).toBe(false);
    expect(plc.m[10]).toBe(false);
    await b.sync(0.2);
    expect(plc.m[10]).toBe(true); // aberta C após 5 s
    expect(await acc.getCoil('LS_DOOR_CLEAN_OPEN')).toBe(true);
    plc.m[49] = true; // guarnição ar C
    for (let i = 0; i < 9; i++) await b.sync(0.2);
    expect(plc.m[12]).toBe(false);
    await b.sync(0.25);
    expect(plc.m[12]).toBe(true);
    b.overrides.IN_EMERG_OK = false;
    await b.sync(0.2);
    expect(plc.m[0]).toBe(false);
  });

  it('PT100 com atraso de 1ª ordem: ~63% do degrau após τ (5 s)', async () => {
    const plc = new FakePlc();
    let t = 0;
    const b = new DeltaPlcBridge(plc, 0, () => t);
    await b.connect();
    const acc = new RegisterAccess(b);
    await acc.setAnalog('T_CHAMBER_INT', 20);
    await acc.setAnalog('P_CHAMBER_INT', 1.013);
    await b.sync(0.2);
    expect(plc.d[11]).toBe(200); // PT2 (câmara) inicia na leitura real, sem rampa
    await acc.setAnalog('T_CHAMBER_INT', 120);
    for (let i = 0; i < 25; i++) {
      t += 0.2;
      await b.sync(0.2);
    }
    expect(plc.d[11]).toBeGreaterThanOrEqual(830);
    expect(plc.d[11]).toBeLessThanOrEqual(835); // 20 + 100·(1−e⁻¹) = 83,2 °C
  });

  it('dreno (PT1) em D10 vem do runtime; sem ele cai na T da câmara', async () => {
    const { plc, b, acc } = await setup();
    await acc.setAnalog('T_CHAMBER_INT', 134);
    await b.sync(0.2);
    expect(plc.d[10]).toBe(1340);
    b.drainProbe_C = () => 104.8;
    await b.sync(0.2);
    expect(plc.d[10]).toBe(1048);
    expect(plc.d[11]).toBe(1340); // PT2 continua o gás (vigia sobretemperatura)
  });

  it('fase 0→≠0 dispara onCycleStart uma vez (não em 5→6)', async () => {
    const { plc, b } = await setup();
    let n = 0;
    b.onCycleStart = () => n++;
    await b.sync(0.2);
    plc.d[900] = 1;
    await b.sync(0.2);
    plc.d[900] = 5;
    await b.sync(0.2);
    plc.d[900] = 6;
    await b.sync(0.2);
    expect(n).toBe(1);
    plc.d[900] = 0;
    await b.sync(0.2);
    plc.d[900] = 2;
    await b.sync(0.2);
    expect(n).toBe(2);
  });

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

  it('porta fechando assenta no batente (pos 0) quando o FC de fechada liga', async () => {
    const { plc, b } = await setup();
    b.door.C = 0.5;
    plc.m[54] = true; // OUT_PORTA_FECHAR_C
    for (let i = 0; i < 40 && !plc.m[8]; i++) await b.sync(0.13); // passo que não cai em 0 exato
    plc.m[54] = false; // CLP corta o FECHAR ao ver o FC
    await b.sync(0.2);
    expect(plc.m[8]).toBe(true);
    expect(b.door.C).toBe(0);
  });

  it('pistão lento leva ~60 s no curso', async () => {
    const { plc, b } = await setup();
    b.setFaults('C', { pistao_lento: true });
    plc.m[53] = true;
    for (let i = 0; i < 290; i++) await b.sync(0.2); // 58 s
    expect(plc.m[10]).toBe(false);
    for (let i = 0; i < 15; i++) await b.sync(0.2); // 61 s
    expect(plc.m[10]).toBe(true);
  });

  it('falhas: analógico rompido, entrada forçada, readPlc/writePlc', async () => {
    const { plc, b, acc } = await setup();
    await acc.setAnalog('P_CHAMBER_INT', 2.0);
    b.faultEngine.set({ id: 'p', tipo: 'analog.open', alvo: 'press:0', valor: -100 });
    b.faultEngine.set({ id: 'e', tipo: 'digital.force', alvo: 'IN_EMERG_OK', valor: 0 });
    await b.sync(0.2);
    expect(plc.d[30]).toBe(-100);
    expect(plc.m[0]).toBe(false);
    await b.writePlc('D', 408, [3]);
    expect(await b.readPlc('D', 408, 1)).toEqual([3]);
    await b.writePlc('M', 60, [true]);
    expect(await b.readPlc('M', 60, 1)).toEqual([true]);
  });

  it('power.cut: liga o bit configurado; some sozinho ao reconectar (evento único)', async () => {
    const plc = new FakePlc();
    // Bit M500 só aqui no teste — no código real vem de SIM_POWER_CUT_BIT, nunca fixo.
    const b = new DeltaPlcBridge(plc, 0, undefined, 500);
    await b.connect();
    b.faultEngine.set({ id: 'pw', tipo: 'power.cut', alvo: '' });
    await b.sync(0.2);
    expect(plc.m[500]).toBe(true);

    plc.down = true;
    await b.sync(0.2); // fails 1/3 — fail-safe existente, não lança
    await b.sync(0.2); // fails 2/3
    await b.sync(0.2); // fails 3/3 → offline
    expect(b.faultEngine.has('power.cut')).toBe(true); // ainda sem reconectar: falha persiste

    plc.down = false;
    await b.sync(0.2); // reconectou
    expect(b.faultEngine.has('power.cut')).toBe(false); // corte é evento único: engine limpa sozinha
    expect(plc.m[500]).toBe(false); // solta o bit também
  });

  it('power.cut: bit volta a 0 quando a falha é limpa sem queda de conexão (clear/clearAll)', async () => {
    const plc = new FakePlc();
    const b = new DeltaPlcBridge(plc, 0, undefined, 500);
    await b.connect();
    b.faultEngine.set({ id: 'pw', tipo: 'power.cut', alvo: '' });
    await b.sync(0.2);
    expect(plc.m[500]).toBe(true);

    b.faultEngine.clear('pw'); // CLP nunca caiu: limpeza manual/clearAll, não o reconnect
    await b.sync(0.2);
    expect(plc.m[500]).toBe(false);
  });

  it('power.cut: servidor reiniciado com o bit preso em 1 no CLP → 1º sync zera', async () => {
    const plc = new FakePlc();
    plc.m[500] = true; // sobra de uma execução anterior (servidor caiu com o corte ativo)
    const b = new DeltaPlcBridge(plc, 0, undefined, 500);
    await b.connect();
    await b.sync(0.2);
    expect(plc.m[500]).toBe(false);
  });

  it('analógico: force fora da faixa int16 ou fracionário é arredondado/clampado antes de escrever', async () => {
    const { plc, b } = await setup();
    b.faultEngine.set({ id: 'f1', tipo: 'analog.force', alvo: 'temp:0', valor: 40000 });
    b.faultEngine.set({ id: 'f2', tipo: 'analog.force', alvo: 'press:0', valor: 12.5 });
    await expect(b.sync(0.2)).resolves.not.toThrow();
    expect(plc.d[10]).toBe(32767);
    expect(plc.d[30]).toBe(13);
  });
});

describe('parsePhaseReg', () => {
  it('aceita número ou D<n>; vazio desliga; lixo dá erro', async () => {
    const { parsePhaseReg } = await import('../../server/bridge/delta-plc.js');
    expect(parsePhaseReg('900')).toBe(900);
    expect(parsePhaseReg('D900')).toBe(900);
    expect(parsePhaseReg(undefined)).toBeNull();
    expect(() => parsePhaseReg('M900')).toThrow();
  });
});

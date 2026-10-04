import { VirtualEsp32Bridge } from './virtual-esp32.js';
import { RegisterAccess } from './register-access.js';
import { deltaD, deltaM, ModbusTcpClient, type ModbusTransport } from './modbus-tcp.js';
import type { RegisterId } from '@sim/protocol/registers';
import { FaultEngine } from '../faults/engine.js';

/** Saídas do CLP M40..M59 → DI do simulador (null = sem equivalente na física). */
export const PLC_OUTPUTS: ReadonlyArray<readonly [string, RegisterId | null]> = [
  ['OUT_BOMBA_VACUO', 'PUMP_VAC'], // M40 — física só puxa vácuo com PUMP_VAC && V_VAC
  ['OUT_VALV_VACUO_CAMARA', 'V_VAC'], // M41
  ['OUT_VALV_VAPOR_CAMISA', 'V_STEAM_IN_JACKET'], // M42
  ['OUT_VALV_VAPOR_CAMARA', 'V_STEAM_IN_INT'], // M43
  ['OUT_VALV_AR_FILTRADO', 'V_AIR_IN'], // M44
  ['OUT_VALV_DRENO_CAMARA', 'V_DRAIN_INT'], // M45
  ['OUT_VALV_AGUA_SELO', null], // M46
  ['OUT_RESISTENCIA_GER', 'HEATER_GEN'], // M47
  ['OUT_BOMBA_AGUA_GER', 'V_GEN_WATER_IN'], // M48
  ['OUT_GUARN_AR_C', 'V_SEAL_CLEAN'], // M49 — só mostra no dashboard
  ['OUT_GUARN_VAC_C', null], // M50
  ['OUT_GUARN_AR_D', 'V_SEAL_STERILE'], // M51
  ['OUT_GUARN_VAC_D', null], // M52
  ['OUT_PORTA_ABRIR_C', null], // M53..M56 → modelo de porta da bancada
  ['OUT_PORTA_FECHAR_C', null],
  ['OUT_PORTA_ABRIR_D', null],
  ['OUT_PORTA_FECHAR_D', null],
  ['OUT_ALARME_SONORO', null], // M57
  ['OUT_VALV_EXAUSTAO_LENTA', 'V_EXHAUST'], // M58
  ['OUT_LED_FIM_CICLO', null], // M59 — LED de fim de ciclo (CLP 1.005); só mostra no dashboard
];

/** Entradas do CLP M0..M21, na ordem. */
export const PLC_INPUTS = [
  'IN_EMERG_OK',
  'IN_PRESS_CAMARA_ATM',
  'IN_PRESSOSTATO_VAPOR',
  'IN_PRESSOSTATO_AR_COMP',
  'IN_GER_AGUA_OK',
  'IN_BOMBA_VAC_OK',
  'IN_GER_NIVEL_ALTO',
  'IN_TERMOSTATO_GER_OK',
  'IN_FC_FECHADA_C',
  'IN_FC_FECHADA_D',
  'IN_FC_ABERTA_C',
  'IN_FC_ABERTA_D',
  'IN_PRESS_GUARN_C',
  'IN_PRESS_GUARN_D',
  'IN_ANTIESMAGA_C',
  'IN_ANTIESMAGA_D',
  'IN_BT_ABRIR_C',
  'IN_BT_FECHAR_C',
  'IN_BT_ABRIR_D',
  'IN_BT_FECHAR_D',
  'IN_AGUA_SELO_BOMBA_VAC',
  'IN_BOMBA_AGUA_GER_OK',
] as const;
export type PlcInput = (typeof PLC_INPUTS)[number];

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
/** Tipo de porta (= tipo de porta configurado no CLP): 1 manual volante central, 2 manual guilhotina,
 *  3 automática guilhotina. */
export type DoorTipo = 1 | 2 | 3;
export type DoorAcao = 'abrir' | 'fechar' | 'parar';
export interface DoorState {
  tipo: DoorTipo;
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

const DOOR_SPEED_PER_S = 1 / 5;
/** Porta manual (tipos 1/2): o operador leva ~3 s pra fazer o curso inteiro. */
const DOOR_MANUAL_TRAVEL_S = 3;
/** Pistão lento (falha): curso inteiro em ~60 s, bem acima do tempo máximo de porta do CLP. */
const DOOR_SLOW_TRAVEL_S = 60;
/** Posição em que o fim de curso de fechada atua (fração do curso). */
const DOOR_FC_FECHADA = 0.02;
const SEAL_PRESSURIZE_S = 2;
/** Falhas seguidas até considerar o CLP inacessível (fail-safe: saídas OFF). */
const MAX_FAILS = 3;

/** `SIM_POWER_CUT_BIT=M<n>` → bit M do corte de energia. Nunca fixo no código: cada bancada tem
 *  o seu (ou nenhum). null = recurso desligado (setar `power.cut` vira erro na rota). */
function parsePowerCutBit(raw: string | undefined): number | null {
  if (!raw) return null;
  const m = /^M(\d+)$/.exec(raw);
  if (!m) throw new Error(`SIM_POWER_CUT_BIT inválido (use M<n>): ${raw}`);
  return Number(m[1]);
}
// ponytail: SIM_PT100_TAU_S = constante de tempo do PT100 (s), knob de calibração contra o sensor real.
const PT100_TAU_S = Number(process.env.SIM_PT100_TAU_S ?? 5);
const clampRaw = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, Math.round(v)));

/**
 * Hardware-in-the-loop com CLP Delta DVP real: a física do simulador é a planta.
 * Reusa o store em memória da VirtualEsp32Bridge; sync() troca dados com o CLP:
 * lê M40..M59 (comandos) → DI, escreve M0..M21 (entradas) e D10..D13/D30..D32 (analógicos brutos).
 */
export class DeltaPlcBridge extends VirtualEsp32Bridge {
  /** Força entradas do CLP (injeção de falha / botões de teste). Ex.: { IN_EMERG_OK: false }. */
  readonly overrides: Partial<Record<PlcInput, boolean>> = {};
  /** Falhas injetadas no HIL (analógico rompido/congelado, entrada forçada etc.). */
  readonly faultEngine = new FaultEngine();
  /** Posição das portas, 0 = fechada, 1 = aberta. Começa fechada. */
  readonly door = { C: 0, D: 0 };
  private sealOn_s = { C: 0, D: 0 };
  /** Falhas ativas por lado (ver setFaults). */
  readonly faults: Record<DoorSide, DoorFaults> = { C: noFaults(), D: noFaults() };
  /** Tipo de porta (knob plant.door.tipo). Nos tipos 1/2 as saídas de porta do CLP são ignoradas. */
  tipo: DoorTipo = 3;
  /** Comando do operador nas portas manuais: 1 abrindo, -1 fechando, 0 parado. */
  private manual: Record<DoorSide, number> = { C: 0, D: 0 };

  /** Operador abre/fecha/para a porta manual. false = tipo 3 (porta segue o CLP). */
  comandarPorta(side: DoorSide, acao: DoorAcao): boolean {
    if (this.tipo === 3) return false;
    this.manual[side] = acao === 'abrir' ? 1 : acao === 'fechar' ? -1 : 0;
    return true;
  }

  setFaults(side: DoorSide, f: Partial<DoorFaults>): void {
    Object.assign(this.faults[side], f);
  }

  /** FC aberta: trava por falha injetada, senão segue a posição real da porta. */
  private fcAberta(s: DoorSide): boolean {
    return this.faults[s].fc_aberta ?? this.door[s] >= 0.98;
  }

  /** FC fechada: trava por falha injetada, senão segue a posição real da porta. */
  private fcFechada(s: DoorSide): boolean {
    return this.faults[s].fc_fechada ?? this.door[s] <= DOOR_FC_FECHADA;
  }

  /** Obstáculo no vão: porta encostou nele (ainda não chegou na posição de FC fechada). */
  private antiesmaga(s: DoorSide): boolean {
    const o = this.faults[s].obstaculo;
    return o !== null && this.door[s] <= o + 0.01;
  }

  /** Snapshot completo do estado da porta (posição, guarnição, FC, falhas) pro dashboard. */
  doorState(s: DoorSide): DoorState {
    const ar = this.out(`OUT_GUARN_AR_${s}`);
    const seal: SealState = this.tipo === 1
      ? this.sealOk(s) ? 'selada' : 'recolhida'
      : this.out(`OUT_GUARN_VAC_${s}`)
      ? 'vacuo'
      : ar
        ? this.sealOk(s)
          ? 'selada'
          : 'pressurizando'
        : 'recolhida';
    return {
      tipo: this.tipo,
      pos: this.door[s],
      seal,
      faults: { ...this.faults[s] },
      fc_aberta: this.fcAberta(s),
      fc_fechada: this.fcFechada(s),
      antiesmaga: this.antiesmaga(s),
      press_guarn: this.sealOk(s),
    };
  }
  private outs: boolean[] = new Array(PLC_OUTPUTS.length).fill(false);
  private fails = 0;
  /** true depois que `fails` bateu MAX_FAILS; volta a false ao reconectar (ver sync()). */
  private offline = false;
  /** Último valor escrito no bit de corte de energia; evita reescrever todo sync e permite
   *  detectar quando `power.cut` suma (clear/clearAll) sem precisar de queda de conexão.
   *  null = desconhecido: força o 1º sync a escrever (zera o bit se o servidor reiniciou com ele
   *  preso em 1 no CLP). */
  private powerCutWritten: boolean | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly access = new RegisterAccess(this);
  /** Leitura filtrada dos PT100 PT2..PT4 (°C); null até a 1ª leitura (sem rampa a partir de 0). */
  private pt100: number[] | null = null;
  private lastSync_s: number | null = null;
  /** Registrador de fase do CLP (D<SIM_PLC_PHASE_REG>) lido no último sync. */
  fase = 0;
  /** Disparado quando a fase vai de 0 para ≠0: o CLP iniciou um ciclo novo. */
  onCycleStart: (() => void) | null = null;
  /** Zera o filtro dos PT100: a próxima leitura salta para o valor atual (reset da planta). */
  resetPt100Filter(): void {
    this.pt100 = null;
  }
  /** Sonda do dreno (PT1, °C) do runtime (já com atraso); null = usa a T da câmara. */
  drainProbe_C: () => number | null = () => null;

  constructor(
    private readonly transport: ModbusTransport,
    private readonly periodMs = 200,
    private readonly now_s = (): number => performance.now() / 1000,
    /** Bit M<n> do corte de energia; default vem de SIM_POWER_CUT_BIT, mas testes podem passar
     *  um valor direto aqui (nunca hardcoded fora de teste). */
    readonly powerCutBit: number | null = parsePowerCutBit(process.env.SIM_POWER_CUT_BIT),
    /** Registrador D<n> com a fase atual do CLP (0 = parado). Vem de SIM_PLC_PHASE_REG; sem ele,
     *  a detecção de início de ciclo fica desligada. Nunca hardcoded (endereço é do projeto do CLP). */
    readonly phaseReg: number | null = parsePowerCutBit(process.env.SIM_PLC_PHASE_REG),
  ) {
    super();
  }

  static fromEnv(): DeltaPlcBridge {
    return new DeltaPlcBridge(new ModbusTcpClient(process.env.SIM_PLC_HOST ?? '127.0.0.1', 502, 1));
  }

  override async connect(): Promise<void> {
    await super.connect();
    if (this.periodMs > 0 && !this.timer) {
      let busy = false;
      this.timer = setInterval(() => {
        if (busy) return;
        busy = true;
        void this.sync(this.periodMs / 1000).finally(() => (busy = false));
      }, this.periodMs);
    }
  }

  override async disconnect(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.transport.close();
    await super.disconnect();
  }

  /** A orquestradora publica LS_DOOR_* e PS_SEAL_* fixos a cada tick; reaplica o modelo da bancada por cima. */
  override async writeCoils(addr: number, values: boolean[]): Promise<void> {
    await super.writeCoils(addr, values);
    await super.writeCoils(0x1002, [this.sealOk('C'), this.sealOk('D')]);
    await super.writeCoils(0x1004, [
      this.fcAberta('C'),
      this.fcFechada('C'),
      this.fcAberta('D'),
      this.fcFechada('D'),
    ]);
  }

  /** Últimos comandos lidos do CLP (M40..M59), por nome. */
  get outputs(): Record<string, boolean> {
    return Object.fromEntries(PLC_OUTPUTS.map(([n], i) => [n, this.outs[i] ?? false]));
  }

  private out(name: string): boolean {
    return this.outs[PLC_OUTPUTS.findIndex(([n]) => n === name)] ?? false;
  }

  /** Guarnição pressurizada o tempo suficiente e sem vazamento injetado. */
  private sealOk(side: DoorSide): boolean {
    // Tipo 1: guarnição estática, sem ar — "selada" = porta fechada no batente (pressostato, se
    // ligado, reporta isso).
    if (this.tipo === 1) return !this.faults[side].vazamento && this.door[side] <= DOOR_FC_FECHADA;
    return !this.faults[side].vazamento && this.sealOn_s[side] >= SEAL_PRESSURIZE_S;
  }

  /** Um ciclo de troca com o CLP. dt_s = tempo desde o último sync (modelos de porta/guarnição). */
  async sync(dt_s: number): Promise<void> {
    // 1. Comandos do CLP → DI
    let connected = true;
    try {
      this.outs = await this.transport.readBits(deltaM(40), PLC_OUTPUTS.length);
      if (this.offline) await this.clearPowerCutOnReconnect();
      this.fails = 0;
    } catch (err) {
      connected = false;
      this.fails++;
      console.error(`delta-plc: falha lendo M40..M59 (${this.fails}x):`, (err as Error).message);
      if (this.fails >= MAX_FAILS) {
        this.outs = this.outs.map(() => false); // fail-safe
        this.offline = true;
      }
    }
    for (const [i, [, di]] of PLC_OUTPUTS.entries()) {
      if (di) await this.access.setDiscrete(di, this.outs[i] ?? false);
    }

    // Corte de energia: escreve só quando o estado muda (1 ao ativar, 0 ao sumir — por clear
    // manual/clearAll ou pelo reconnect abaixo), nunca fica preso em 1 se a falha sumir sem queda.
    if (connected && this.powerCutBit !== null) {
      const ativo = this.faultEngine.has('power.cut');
      if (ativo !== this.powerCutWritten) {
        try {
          await this.transport.writeBits(deltaM(this.powerCutBit), [ativo]);
          this.powerCutWritten = ativo;
        } catch (err) {
          console.error('delta-plc: falha escrevendo bit de corte de energia:', (err as Error).message);
        }
      }
    }

    // Modelos da bancada: portas e guarnições
    for (const s of ['C', 'D'] as const) {
      if (this.tipo === 3) this.manual[s] = 0;
      const v =
        this.tipo !== 3
          ? this.manual[s]
          : (this.out(`OUT_PORTA_ABRIR_${s}`) ? 1 : 0) - (this.out(`OUT_PORTA_FECHAR_${s}`) ? 1 : 0);
      // ponytail: pistão lento só no tipo 3 (porta manual não tem pistão).
      const speed =
        this.tipo !== 3
          ? 1 / DOOR_MANUAL_TRAVEL_S
          : this.faults[s].pistao_lento ? 1 / DOOR_SLOW_TRAVEL_S : DOOR_SPEED_PER_S;
      const prev = this.door[s];
      let pos = Math.max(0, Math.min(1, prev + v * speed * dt_s));
      const o = this.faults[s].obstaculo;
      if (o !== null && prev >= o) pos = Math.max(pos, o); // obstáculo no vão: porta encosta e para
      // O FC de fechada liga um pouco antes do batente (pos ≤ 0,02) e o CLP corta o FECHAR ali:
      // a porta assenta no batente (pos 0) em vez de ficar parada entreaberta.
      if (v <= 0 && o === null && pos <= DOOR_FC_FECHADA) pos = 0;
      this.door[s] = pos;
      if (pos === 0 || pos === 1) this.manual[s] = 0; // operador chegou no fim do curso
      this.sealOn_s[s] = this.out(`OUT_GUARN_AR_${s}`) ? this.sealOn_s[s] + dt_s : 0;
    }
    await this.writeCoils(0x1002, []); // só reaplica portas/guarnições no store

    // Fase atual do CLP: 0 → ≠0 = ciclo novo
    if (this.phaseReg !== null) {
      try {
        const [fase = 0] = await this.transport.readRegs(deltaD(this.phaseReg), 1);
        if (this.fase === 0 && fase !== 0) this.onCycleStart?.();
        this.fase = fase;
      } catch (err) {
        console.error('delta-plc: falha lendo a fase:', (err as Error).message);
      }
    }

    // 2. Entradas M0..M21
    const inputs = await this.computeInputs();
    // 3. Analógicos brutos
    const [p_int, p_ext, p_gen, t_int, t_test, t_ext] = await Promise.all(
      (
        [
          'P_CHAMBER_INT',
          'P_CHAMBER_EXT',
          'P_GENERATOR',
          'T_CHAMBER_INT',
          'T_TESTEMUNHO',
          'T_CHAMBER_EXT',
        ] as const
      ).map((id) => this.access.getAnalog(id)),
    );
    // Atraso de 1ª ordem de PT2..PT4, com o tempo real entre syncs. PT1 (dreno) vem do runtime.
    const trueT = [t_int!, t_ext!, t_test!];
    const now = this.now_s();
    const dt = this.lastSync_s === null ? null : now - this.lastSync_s;
    this.lastSync_s = now;
    this.pt100 = trueT.map((t, i) => {
      if (!this.pt100 || dt === null) return t;
      const atual = this.pt100[i]!;
      return atual + (t - atual) * (1 - Math.exp(-dt / PT100_TAU_S));
    });
    const temps = [this.drainProbe_C() ?? t_int!, ...this.pt100].map((t) =>
      clampRaw(t * 10, -32768, 32767),
    );
    const press = [p_int!, p_ext!, p_gen!].map((p) => clampRaw(p * 1000, 0, 4000));
    // Falha analógica entra depois do clamp: rompimento/congelamento é no sinal que chega ao CLP.
    // force/offset podem sair de -32768..32767 ou vir fracionário (offset mal calibrado, force de
    // teste): reclampar/arredondar aqui, senão writeRegs (int16) derruba o sync inteiro.
    const tempsF = this.faultEngine
      .applyAnalog('temp', temps)
      .map((v) => clampRaw(v, -32768, 32767));
    const pressF = this.faultEngine
      .applyAnalog('press', press)
      .map((v) => clampRaw(v, -32768, 32767));
    try {
      await this.transport.writeBits(deltaM(0), inputs);
      await this.transport.writeRegs(deltaD(10), tempsF);
      await this.transport.writeRegs(deltaD(30), pressF);
    } catch (err) {
      console.error('delta-plc: falha escrevendo entradas:', (err as Error).message);
    }
  }

  /** Reconectou depois de offline: corte de energia já cumpriu o papel (o CLP detectou a borda
   *  sozinho) — solta o bit e tira a falha da engine, sem precisar de ação do operador. */
  private async clearPowerCutOnReconnect(): Promise<void> {
    for (const f of this.faultEngine.list()) {
      if (f.tipo !== 'power.cut') continue;
      this.faultEngine.clear(f.id);
      if (this.powerCutBit !== null) {
        try {
          await this.transport.writeBits(deltaM(this.powerCutBit), [false]);
        } catch (err) {
          console.error('delta-plc: falha soltando bit de corte de energia:', (err as Error).message);
        }
      }
    }
    this.powerCutWritten = false;
    this.offline = false;
  }

  /** Lê uma área do CLP (M ou D); usado pelo executor de cenários, mesma conexão Modbus. */
  async readPlc(area: 'M' | 'D', addr: number, n: number): Promise<(number | boolean)[]> {
    return area === 'M' ? this.transport.readBits(deltaM(addr), n) : this.transport.readRegs(deltaD(addr), n);
  }

  /** Escreve numa área do CLP (M ou D); usado pelo executor de cenários, mesma conexão Modbus.
   *  D é int16 (clampa/arredonda, senão writeRegs lança RangeError em fracionário/fora de faixa).
   *  Atenção: M0..M21 e D10..D13/D30..D32 são sobrescritos pelo próximo sync() (entradas/analógicos
   *  recalculados a cada ciclo) — só vale a pena escrever ali pra um teste pontual entre syncs. */
  async writePlc(area: 'M' | 'D', addr: number, values: (number | boolean)[]): Promise<void> {
    if (area === 'M') await this.transport.writeBits(deltaM(addr), values.map(Boolean));
    else
      await this.transport.writeRegs(
        deltaD(addr),
        values.map((v) => clampRaw(Number(v), -32768, 32767)),
      );
  }

  async computeInputs(): Promise<boolean[]> {
    const coil = (id: RegisterId): Promise<boolean> => this.access.getCoil(id);
    const p_int = await this.access.getAnalog('P_CHAMBER_INT');
    const v: Record<PlcInput, boolean> = {
      IN_EMERG_OK: true,
      IN_PRESS_CAMARA_ATM: Math.abs(p_int - 1.013) < 0.05,
      IN_PRESSOSTATO_VAPOR: await coil('PS_STEAM_LINE'),
      IN_PRESSOSTATO_AR_COMP: true,
      IN_GER_AGUA_OK: await coil('LVL_GEN_MIN'),
      IN_BOMBA_VAC_OK: true,
      IN_GER_NIVEL_ALTO: await coil('LVL_GEN_MAX'),
      IN_TERMOSTATO_GER_OK: true,
      IN_FC_FECHADA_C: this.fcFechada('C'),
      IN_FC_FECHADA_D: this.fcFechada('D'),
      IN_FC_ABERTA_C: this.fcAberta('C'),
      IN_FC_ABERTA_D: this.fcAberta('D'),
      IN_PRESS_GUARN_C: this.sealOk('C'),
      IN_PRESS_GUARN_D: this.sealOk('D'),
      IN_ANTIESMAGA_C: this.antiesmaga('C'),
      IN_ANTIESMAGA_D: this.antiesmaga('D'),
      IN_BT_ABRIR_C: false,
      IN_BT_FECHAR_C: false,
      IN_BT_ABRIR_D: false,
      IN_BT_FECHAR_D: false,
      IN_AGUA_SELO_BOMBA_VAC: true,
      IN_BOMBA_AGUA_GER_OK: true,
    };
    const f = this.faultEngine.applyDigital(v);
    return PLC_INPUTS.map((n) => this.overrides[n] ?? f[n]);
  }
}

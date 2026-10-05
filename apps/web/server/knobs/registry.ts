import {
  bar_to_Pa,
  Pa_to_bar,
  T_sat_water,
  C_to_K,
  type MaterialName,
  EMBALAGENS,
  EMBALAGEM_LABELS,
  DOOR_H_OPEN_DEFAULT,
  DOOR_TAU_GAS_DEFAULT,
  DOOR_TAU_PRESSURE_DEFAULT,
  GEN_FEED_DEFAULT_KG_S,
} from '@sim/physics';
import type { Runtime } from '../runtime/singleton.js';
import { VALVE_CV_DEFAULT, PUMP_DEFAULT, CHAMBER_REF } from '../runtime/plant-defaults.js';
import { KNOB_CATEGORIES, type KnobFamily } from '../../lib/knobs-api.js';

export type { KnobFamily };
export { KNOB_CATEGORIES };

export interface KnobDescriptor {
  id: string;
  family: KnobFamily;
  /** Subgrupo dentro da família (ordem fixa em KNOB_CATEGORIES), usado pra organizar a UI. */
  categoria: string;
  label: string;
  unit: string;
  default: number;
  min: number;
  max: number;
  step?: number;
  /** Casas decimais exibidas na UI (o valor interno guarda a precisão total). */
  decimals?: number;
  /** Knob de lista: o valor é o índice (inteiro) em options; a UI mostra um select. */
  options?: string[];
  /** Nomes exibidos no select (mesma ordem de options); sem isso a UI mostra options. */
  optionLabels?: string[];
  /** live: aplica na hora; precycle: só com ciclo parado; reset: só com máquina parada e
   *  aplica via reset da planta (preset do último reset). */
  timing: 'live' | 'precycle' | 'reset';
  /** Balão de ajuda (pt-BR): o que é fisicamente, unidade, faixa real, efeito no ciclo. */
  help: string;
  get(rt: Runtime): number;
  set(rt: Runtime, v: number): void;
}

/** Serializable view (no functions) for the API/UI. */
export type KnobMeta = Omit<KnobDescriptor, 'get' | 'set'>;

const PA_PER_BAR = bar_to_Pa(1);

/** O Cv do modelo (valve.ts) é a área efetiva de passagem em m² (ṁ = Cv·P/√(RT)·f(razão)), ou
 *  seja A·Cd. Diâmetro equivalente com Cd = 1: d = √(4·Cv/π). */
export const mmFromCv = (cv: number): number => Math.sqrt((4 * cv) / Math.PI) * 1000;
export const cvFromMm = (mm: number): number => (Math.PI * (mm / 1000) ** 2) / 4;

type ValveId = keyof typeof VALVE_CV_DEFAULT;

/** Knob de diâmetro (mm) de uma válvula. Cv continua sendo a grandeza guardada; o diâmetro padrão
 *  (precisão total) mapeia de volta exatamente para o Cv padrão, sem erro de arredondamento. */
function boreKnob(
  id: string,
  valve: ValveId,
  label: string,
  categoria: string,
  help: string,
): KnobDescriptor {
  const cv0 = VALVE_CV_DEFAULT[valve];
  const d0 = mmFromCv(cv0);
  return {
    id,
    family: 'plant',
    categoria,
    label,
    unit: 'mm',
    default: d0,
    min: 0.5,
    max: 25,
    step: 0.1,
    decimals: 1,
    timing: 'live',
    help,
    get: (rt) => mmFromCv(rt.params.valves[valve]!.params.Cv),
    set: (rt, v) => {
      rt.params.valves[valve]!.params.Cv = v === d0 ? cv0 : cvFromMm(v);
    },
  };
}

const BORE_HELP =
  ' Diâmetro interno equivalente (mm) da passagem, supondo coeficiente de descarga 1 (área efetiva = π·d²/4).';

/** Muda a geometria só se o valor mudou e re-reseta a planta (estado coerente com o novo volume). */
function setGeometry(rt: Runtime, apply: () => boolean): void {
  if (apply()) rt.reapplyPlant();
}

// Ordem travada: o valor salvo é o ÍNDICE nesta lista (knobs.override.json / knobs.factory.json
// guardam o número, não o nome). Reordenar ou remover um material desloca os índices salvos para
// OUTRO material. Só adicionar material no fim.
const MATERIAL_NAMES: MaterialName[] = [
  'STAINLESS_316',
  'CARBON_STEEL',
  'ALUMINUM',
  'GLASS',
  'POLYPROPYLENE',
  'PEEK',
  'SILICONE',
  'COTTON_TEXTILE',
];
const MATERIAL_LABELS: Record<MaterialName, string> = {
  STAINLESS_316: 'Aço inox 316',
  CARBON_STEEL: 'Aço carbono',
  ALUMINUM: 'Alumínio',
  GLASS: 'Vidro',
  POLYPROPYLENE: 'Polipropileno',
  PEEK: 'PEEK',
  SILICONE: 'Silicone',
  COTTON_TEXTILE: 'Têxtil (algodão)',
};

/** Com a máquina ociosa a carga é reconstruída na hora; em ciclo vale no próximo. */
function setLoad(rt: Runtime, apply: () => void): void {
  apply();
  if (!rt.cycle_running) rt.orchestrator.setLoadState(rt.cycleLoadState());
}

const LOAD_HELP =
  ' Vale quando o ciclo não define carga própria (se definir, a do ciclo prevalece e só a temperatura inicial se aplica). Com a máquina ociosa reconstrói a carga na hora; durante o ciclo vale no próximo.';

function materialKnob(
  id: string,
  slot: 'material_a' | 'material_b',
  label: string,
  def: MaterialName,
  help: string,
): KnobDescriptor {
  return {
    id,
    family: 'plant',
    categoria: 'Carga',
    label,
    unit: '',
    default: MATERIAL_NAMES.indexOf(def),
    min: 0,
    max: MATERIAL_NAMES.length - 1,
    step: 1,
    options: MATERIAL_NAMES,
    optionLabels: MATERIAL_NAMES.map((n) => MATERIAL_LABELS[n]),
    timing: 'live',
    help: help + LOAD_HELP,
    get: (rt) => MATERIAL_NAMES.indexOf(rt.loadKnobs[slot]),
    set: (rt, v) => setLoad(rt, () => (rt.loadKnobs[slot] = MATERIAL_NAMES[Math.round(v)]!)),
  };
}

function massKnob(
  id: string,
  slot: 'mass_a_kg' | 'mass_b_kg',
  label: string,
  def: number,
  help: string,
): KnobDescriptor {
  return {
    id,
    family: 'plant',
    categoria: 'Carga',
    label,
    unit: 'kg',
    default: def,
    min: 0,
    max: 200,
    step: 0.1,
    timing: 'live',
    help: help + LOAD_HELP,
    get: (rt) => rt.loadKnobs[slot],
    set: (rt, v) => setLoad(rt, () => (rt.loadKnobs[slot] = v)),
  };
}

function embalagemKnob(
  id: string,
  slot: 'embalagem_a' | 'embalagem_b',
  label: string,
  help: string,
): KnobDescriptor {
  return {
    id,
    family: 'plant',
    categoria: 'Carga',
    label,
    unit: '',
    default: 0,
    min: 0,
    max: EMBALAGENS.length - 1,
    step: 1,
    options: [...EMBALAGENS],
    optionLabels: EMBALAGENS.map((n) => EMBALAGEM_LABELS[n]),
    timing: 'live',
    help: help + LOAD_HELP,
    get: (rt) => EMBALAGENS.indexOf(rt.loadKnobs[slot]),
    set: (rt, v) => setLoad(rt, () => (rt.loadKnobs[slot] = EMBALAGENS[Math.round(v)]!)),
  };
}

const EMBALAGEM_HELP =
  ' Define a dificuldade de secagem: sem embalagem a água seca em flash; pacote têxtil seca em dois períodos (frente seca no tecido); caixa em SMS deixa o condensado empoçado no fundo da bandeja; grau cirúrgico só deixa o vapor sair pelo papel. Estimativas de literatura, não calibradas.';

export const KNOBS: KnobDescriptor[] = [
  // ---- CYCLE (precycle: written into runtime.cycleOverride, merged at startCycle) ----
  {
    id: 'cycle.sterilization_T',
    family: 'cycle',
    categoria: 'Esterilização',
    label: 'Setpoint esterilização',
    unit: '°C',
    default: 134,
    min: 100,
    max: 140,
    step: 0.5,
    timing: 'precycle',
    help: 'Temperatura de esterilização (°C) que o controlador mantém no HOLD. Típico: 121 °C (instrumental/líquidos) ou 134 °C (pré-vácuo, carga porosa). Aumentar: F0 sobe mais rápido e o ciclo encurta, mas aproxima o teto EN 285 (+3 °C) e o alívio. Diminuir: precisa de hold mais longo para o mesmo F0.',
    get: (rt) => rt.cycleOverride.sterilization_T_C ?? 134,
    set: (rt, v) => {
      rt.cycleOverride.sterilization_T_C = v;
    },
  },
  {
    id: 'cycle.hold_duration',
    family: 'cycle',
    categoria: 'Esterilização',
    label: 'Duração hold',
    unit: 's',
    default: 420,
    min: 0,
    max: 3600,
    step: 10,
    timing: 'precycle',
    help: 'Tempo de patamar (s) na temperatura de esterilização. Típico: 180–1200 s (3 min a 134 °C, 15–20 min a 121 °C). Aumentar: mais F0 e ciclo mais longo. Diminuir: risco de F0 insuficiente.',
    get: (rt) => rt.cycleOverride.hold_duration_s ?? 420,
    set: (rt, v) => {
      rt.cycleOverride.hold_duration_s = v;
    },
  },
  {
    id: 'cycle.prevac_pulses',
    family: 'cycle',
    categoria: 'Pré-vácuo',
    label: 'Pulsos prevac',
    unit: '',
    default: 3,
    min: 0,
    max: 6,
    step: 1,
    timing: 'precycle',
    help: 'Número de pulsos de pré-vácuo (vácuo + injeção de vapor) para remover o ar da câmara e da carga. Típico: 3–4. Mais pulsos: ar residual menor e penetração melhor, ciclo mais longo. Menos: ar residual e pontos frios na carga.',
    get: (rt) => rt.cycleOverride.prevac_pulses ?? 3,
    set: (rt, v) => {
      rt.cycleOverride.prevac_pulses = Math.round(v);
    },
  },
  {
    id: 'cycle.prevac_vacuum_target',
    family: 'cycle',
    categoria: 'Pré-vácuo',
    label: 'Alvo vácuo prevac',
    unit: 'bar',
    default: 0.15,
    min: 0.05,
    max: 1,
    step: 0.01,
    timing: 'precycle',
    help: 'Pressão absoluta (bar) a atingir em cada pulso de vácuo. Típico: 0,05–0,2 bar abs. Mais baixo: remove mais ar por pulso, mas cada pulso demora mais (a bomba perde velocidade perto da pressão final). Mais alto: pulsos rápidos e menos eficazes.',
    get: (rt) => rt.cycleOverride.prevac_vacuum_target_bar ?? 0.15,
    set: (rt, v) => {
      rt.cycleOverride.prevac_vacuum_target_bar = v;
    },
  },
  {
    id: 'cycle.prevac_steam_target',
    family: 'cycle',
    categoria: 'Pré-vácuo',
    label: 'Alvo vapor prevac',
    unit: 'bar',
    default: 2.0,
    min: 1,
    max: 3.5,
    step: 0.05,
    timing: 'precycle',
    help: 'Pressão absoluta (bar) a atingir com vapor em cada pulso de pré-vácuo. Típico: 1,5–2,5 bar abs. Mais alto: aquece e dilui melhor o ar, pulso mais longo e mais condensado. Mais baixo: pulsos rápidos e menos diluição.',
    get: (rt) => rt.cycleOverride.prevac_steam_target_bar ?? 2.0,
    set: (rt, v) => {
      rt.cycleOverride.prevac_steam_target_bar = v;
    },
  },
  {
    id: 'cycle.dry_duration',
    family: 'cycle',
    categoria: 'Secagem',
    label: 'Duração secagem',
    unit: 's',
    default: 500,
    min: 0,
    max: 3600,
    step: 10,
    timing: 'precycle',
    help: 'Tempo (s) de secagem a vácuo no fim do ciclo. Típico: 300–1800 s, conforme a carga. Aumentar: carga mais seca, ciclo mais longo. Diminuir: risco de pacote molhado.',
    get: (rt) => rt.cycleOverride.dry_duration_s ?? 500,
    set: (rt, v) => {
      rt.cycleOverride.dry_duration_s = v;
    },
  },

  // ---- PLANT (live: mutate rt.params in place; Orchestrator reads the ref each tick) ----
  {
    id: 'plant.chamber.relief',
    family: 'plant',
    categoria: 'Câmara',
    label: 'Teto alívio câmara',
    unit: 'bar',
    default: 3.25,
    min: 2.5,
    max: 4,
    step: 0.05,
    timing: 'live',
    help: 'Pressão absoluta (bar) da válvula de alívio da câmara — teto de segurança, não ponto de operação. Típico: 3,0–3,5 bar abs para ciclos a 134 °C. Subir: permite sobrepressão/sobretemperatura maior em rajadas de vapor. Baixar abaixo de ~3,1 bar impede chegar a 134 °C.',
    get: (rt) => rt.params.chamber.relief_pressure_Pa! / PA_PER_BAR,
    set: (rt, v) => {
      rt.params.chamber.relief_pressure_Pa = bar_to_Pa(v);
    },
  },
  {
    id: 'plant.chamber.h_ambient',
    family: 'plant',
    categoria: 'Perdas e drenos',
    label: 'Perda ambiente câmara',
    unit: 'W/K',
    default: 10,
    min: 0,
    max: 100,
    step: 1,
    timing: 'live',
    help: 'Coeficiente de perda térmica da câmara para o ambiente (W/K): porta, flanges, isolamento. Típico: 5–50 W/K. Aumentar: câmara esfria mais rápido sem vapor, o controlador abre mais vezes e gasta mais vapor. Diminuir: temperatura mais estável, risco de overshoot.',
    get: (rt) => rt.params.chamber.h_ambient_W_per_K ?? 10,
    set: (rt, v) => {
      rt.params.chamber.h_ambient_W_per_K = v;
    },
  },
  {
    id: 'plant.chamber.drain',
    family: 'plant',
    categoria: 'Perdas e drenos',
    label: 'Dreno condensado câmara',
    unit: 'kg/s',
    default: 2e-5,
    min: 0,
    max: 1e-3,
    step: 1e-6,
    timing: 'live',
    help: 'Vazão passiva do purgador de condensado da câmara (kg/s de líquido). Típico: 1e-5 a 1e-4 kg/s. Aumentar: tira condensado mais rápido (menos água acumulada). Diminuir: acumula condensado no fundo da câmara.',
    get: (rt) => rt.params.chamber.drain_kg_per_s ?? 2e-5,
    set: (rt, v) => {
      rt.params.chamber.drain_kg_per_s = v;
    },
  },
  {
    id: 'plant.steam.fonte',
    family: 'plant',
    categoria: 'Gerador',
    label: 'Fonte de vapor',
    unit: '',
    default: 0,
    min: 0,
    max: 1,
    step: 1,
    options: ['rede', 'gerador'],
    optionLabels: ['Rede / caldeira externa (pressão de linha)', 'Gerador próprio (resistência + nível)'],
    timing: 'live',
    help: 'De onde vem o vapor das válvulas de entrada da câmara e da camisa. Rede: linha de vapor saturado na pressão do knob "Pressão da linha de vapor" (fonte = 1 no CLP; ele não liga a resistência). Gerador: o vaso com água e resistência — a pressão cai quando o consumo passa da potência da resistência, e a vazão das válvulas cai junto (só use se o CLP comandar a resistência e a bomba, fonte = 3).',
    get: (rt) => (rt.params.valves.V_STEAM_IN_INT!.from === 'generator' ? 1 : 0),
    set: (rt, v) => {
      const from = Math.round(v) === 1 ? 'generator' : 'steam_line';
      rt.params.valves.V_STEAM_IN_INT!.from = from;
      rt.params.valves.V_STEAM_IN_JACKET!.from = from;
    },
  },
  {
    id: 'plant.steam.linha_bar',
    family: 'plant',
    categoria: 'Gerador',
    label: 'Pressão da linha de vapor',
    unit: 'bar abs',
    default: 4.5,
    min: 1.5,
    max: 8,
    step: 0.1,
    decimals: 1,
    timing: 'live',
    help: 'Pressão absoluta do vapor saturado da rede/caldeira (fonte = rede). A vazão das válvulas de entrada é proporcional a ela (escoamento crítico) e se anula quando a câmara chega a essa pressão. Típico: 4–6 bar abs. Baixar simula caldeira fraca ou queda na linha.',
    get: (rt) => Pa_to_bar(rt.params.external.steam_line_pressure),
    set: (rt, v) => {
      rt.params.external.steam_line_pressure = bar_to_Pa(v);
      rt.params.external.steam_line_T = T_sat_water(bar_to_Pa(v));
    },
  },
  {
    id: 'plant.generator.heater_power',
    family: 'plant',
    categoria: 'Gerador',
    label: 'Potência aquecedor gerador',
    unit: 'W',
    default: 36000,
    min: 0,
    max: 60000,
    step: 1000,
    timing: 'live',
    help: 'Potência elétrica da resistência do gerador de vapor (W). Típico: 9–60 kW para câmaras de 100–300 L. Aumentar: gerador recupera pressão mais rápido entre injeções. Diminuir: gerador pode cair de pressão nos pulsos e na subida.',
    get: (rt) => rt.params.generator!.heater_power_W,
    set: (rt, v) => {
      rt.params.generator!.heater_power_W = v;
    },
  },
  {
    id: 'plant.generator.transd_fundo_bar',
    family: 'plant',
    categoria: 'Gerador',
    label: 'Fundo de escala transdutor gerador',
    unit: 'bar',
    default: 10,
    min: 1,
    max: 25,
    step: 0.5,
    decimals: 1,
    timing: 'live',
    help: 'Fundo de escala do transdutor de pressão do gerador (bar abs): o bruto enviado ao CLP é p/fundo × 4000 contagens (satura em 4000). Câmara e camisa ficam em 0..4 bar. Deve bater com D_SPAN_BAR_PGER/D_SPAN_DIG_PGER do CLP (10 bar = 10000/4000).',
    get: (rt) => rt.params.generator!.transd_fundo_bar ?? 10,
    set: (rt, v) => {
      rt.params.generator!.transd_fundo_bar = v;
      // duck typing: o runtime em globalThis pode carregar outra cópia da classe do bridge
      const b = rt.bridge as { fundoGerBar?: number };
      if ('fundoGerBar' in b) b.fundoGerBar = v;
    },
  },
  {
    id: 'plant.generator.ua_perda',
    family: 'plant',
    categoria: 'Gerador',
    label: 'Perda de calor gerador',
    unit: 'W/K',
    default: 3,
    min: 0,
    max: 50,
    step: 0.5,
    decimals: 1,
    timing: 'live',
    help: 'Perda de calor do casco do gerador para o ambiente (W/K): Q = UA × (T_ger − T_amb). Padrão 3 W/K: gerador de ~50 L isolado (~1,5 m² com 50 mm de lã de rocha ≈ 1 W/K) + flanges, válvulas e tubulação sem isolamento. Parado, cai de 4,5 para 3,5 bar abs em ~12 min com 10 kg de água (mais água, mais lento). Aumentar: gerador parado perde pressão mais rápido. 0 = sem perda.',
    get: (rt) => rt.params.generator!.ua_loss_W_per_K ?? 0,
    set: (rt, v) => {
      rt.params.generator!.ua_loss_W_per_K = v;
    },
  },
  {
    id: 'plant.generator.agua_T',
    family: 'plant',
    categoria: 'Gerador',
    label: 'Temperatura água de alimentação',
    unit: '°C',
    default: 24,
    min: 1,
    max: 95,
    step: 1,
    timing: 'live',
    help: 'Temperatura da água que a bomba de reposição (V_GEN_WATER_IN) injeta no gerador (°C). A mistura fria derruba T e P do gerador pelo balanço de energia. Típico: 15–30 °C da rede; 60–90 °C com tanque de condensado/pré-aquecido. Aumentar: reposição perturba menos a pressão.',
    get: (rt) => (rt.params.generator_feed?.T_K ?? rt.params.external.atmosphere_T) - C_to_K(0),
    set: (rt, v) => {
      rt.params.generator_feed = {
        kg_per_s: rt.params.generator_feed?.kg_per_s ?? GEN_FEED_DEFAULT_KG_S,
        T_K: C_to_K(v),
      };
    },
  },
  {
    id: 'plant.generator.alivio_bar',
    family: 'plant',
    categoria: 'Gerador',
    label: 'Alívio do gerador',
    unit: 'bar abs',
    default: 6,
    min: 2,
    max: 12,
    step: 0.1,
    decimals: 1,
    timing: 'live',
    help: 'Pressão absoluta (bar) de abertura da válvula de segurança do gerador — teto de segurança, não ponto de operação. Deve ficar acima de D_GER_P_MAX do CLP + pressão atmosférica, senão o gerador alivia antes de atingir o setpoint real da bancada.',
    get: (rt) => Pa_to_bar(rt.params.generator!.relief_pressure_Pa ?? bar_to_Pa(6)),
    set: (rt, v) => {
      rt.params.generator!.relief_pressure_Pa = bar_to_Pa(v);
    },
  },
  boreKnob(
    'plant.valve.steam_in_int_mm',
    'V_STEAM_IN_INT',
    'Diâmetro entrada vapor câmara',
    'Válvulas',
    'Entrada de vapor do gerador para a câmara.' +
      BORE_HELP +
      ' Típico: 6–25 mm (DN8–DN25) em autoclaves hospitalares. Aumentar: pulsos de vapor e subida mais rápidos, rajadas maiores (overshoot no HOLD). Diminuir: subida lenta e controlador com dificuldade de manter o setpoint.',
  ),
  boreKnob(
    'plant.valve.steam_in_jacket_mm',
    'V_STEAM_IN_JACKET',
    'Diâmetro vapor camisa',
    'Camisa',
    'Alimentação de vapor do gerador para a camisa.' +
      BORE_HELP +
      ' Típico: 3–15 mm. Aumentar: camisa pressuriza mais rápido (pré-aquecimento curto). Diminuir: camisa demora a chegar à pressão e a parede da câmara fica fria (mais condensado).',
  ),
  boreKnob(
    'plant.valve.air_in_mm',
    'V_AIR_IN',
    'Diâmetro entrada ar filtrado',
    'Válvulas',
    'Admissão de ar atmosférico filtrado (quebra de vácuo).' +
      BORE_HELP +
      ' Típico: 3–10 mm, com filtro HEPA. Aumentar: quebra de vácuo e equalização com a atmosfera mais rápidas. Diminuir: fim do ciclo/secagem demora a voltar a 1 atm.',
  ),
  boreKnob(
    'plant.valve.exhaust_mm',
    'V_EXHAUST',
    'Diâmetro exaustão',
    'Válvulas',
    'Exaustão da câmara para a atmosfera/condensador (despressurização).' +
      BORE_HELP +
      ' Típico: 6–20 mm. Aumentar: despressurização rápida (risco de ebulição violenta de líquidos). Diminuir: exaustão lenta, ciclo mais longo.',
  ),
  boreKnob(
    'plant.valve.drain_int_mm',
    'V_DRAIN_INT',
    'Diâmetro dreno câmara',
    'Válvulas',
    'Válvula de dreno da câmara (via de despressurização do programa do CLP real; no modo virtual só abre se comandada).' +
      BORE_HELP +
      ' Típico: 6–15 mm. Aumentar: despressurização pelo dreno mais rápida. Diminuir: mais lenta. Não confundir com o purgador passivo de condensado.',
  ),
  {
    id: 'plant.vacuum.speed',
    family: 'plant',
    categoria: 'Vácuo',
    label: 'Velocidade nominal bomba vácuo',
    unit: 'm³/h',
    default: PUMP_DEFAULT.S_nom_m3_h,
    min: 5,
    max: 1000,
    step: 1,
    timing: 'live',
    help: 'Velocidade de bombeamento nominal S_nom (vazão volumétrica na sucção, m³/h). A velocidade efetiva cai perto da pressão final: S(p) = S_nom·(1 − p_final/p); vazão mássica = densidade do gás × S (vapor com fator 1,7 pelo efeito condensador do anel líquido). Típico: 40–250 m³/h para câmaras de 100–500 L. Aumentar: pulsos de vácuo e secagem mais rápidos. Diminuir: prevac lento.',
    get: (rt) => rt.params.vacuum_pump!.S_nom_m3_per_s * 3600,
    set: (rt, v) => {
      rt.params.vacuum_pump!.S_nom_m3_per_s = v / 3600;
    },
  },
  {
    id: 'plant.vacuum.p_ult',
    family: 'plant',
    categoria: 'Vácuo',
    label: 'Pressão final bomba vácuo',
    unit: 'mbar',
    default: PUMP_DEFAULT.p_ult_mbar,
    min: 0.5,
    max: 300,
    step: 1,
    timing: 'live',
    help: 'Pressão final (última) da bomba, mbar absoluto: abaixo dela a bomba não tira mais gás. Típico: 25–80 mbar (anel líquido, conforme a temperatura da água), 1–10 mbar (com ejetor ou bomba seca). Aumentar: vácuo mínimo pior e evacuação perto do alvo mais lenta; acima do alvo de prevac o pulso de vácuo nunca termina. Diminuir: vácuo mais profundo.',
    get: (rt) => rt.params.vacuum_pump!.p_ult_Pa / 100,
    set: (rt, v) => {
      rt.params.vacuum_pump!.p_ult_Pa = v * 100;
    },
  },
  {
    id: 'plant.chamber.volume',
    family: 'plant',
    categoria: 'Câmara',
    label: 'Volume câmara',
    unit: 'L',
    default: CHAMBER_REF.V * 1000,
    min: 20,
    max: 2000,
    step: 5,
    timing: 'reset',
    help: 'Volume interno da câmara (litros). A camisa (volume e massa da parede) escala proporcionalmente (referência: 150 L ↔ camisa 25 L / 15 kg). Só muda com a máquina parada e aplica um reset da planta (preset do último reset). Típico: 50–600 L. Aumentar: mais gás para evacuar e aquecer — pulsos de vácuo/vapor e subida mais lentos com a mesma bomba e válvulas. Diminuir: tudo mais rápido.',
    get: (rt) => rt.params.chamber.V * 1000,
    set: (rt, v) =>
      setGeometry(rt, () => {
        const V = v / 1000;
        const p = rt.params;
        if (V === p.chamber.V) return false;
        const k = V / CHAMBER_REF.V;
        p.chamber.V = V;
        p.jacket.V = CHAMBER_REF.jacket_V * k;
        p.jacket.wall_mass_kg = CHAMBER_REF.jacket_wall_kg * k;
        return true;
      }),
  },
  {
    id: 'plant.chamber.wall_mass',
    family: 'plant',
    categoria: 'Câmara',
    label: 'Massa parede câmara',
    unit: 'kg',
    default: CHAMBER_REF.wall_kg,
    min: 5,
    max: 2000,
    step: 1,
    timing: 'reset',
    help: 'Massa metálica da parede interna da câmara (kg, aço inox, cp ≈ 500 J/kg·K). Só muda com a máquina parada e aplica um reset da planta. Típico: 30–400 kg. Aumentar: mais inércia térmica — mais condensado na subida, temperatura mais estável, aquecimento mais lento. Diminuir: câmara responde mais rápido e oscila mais.',
    get: (rt) => rt.params.chamber.wall_mass_kg!,
    set: (rt, v) =>
      setGeometry(rt, () => {
        if (v === rt.params.chamber.wall_mass_kg) return false;
        rt.params.chamber.wall_mass_kg = v;
        return true;
      }),
  },

  {
    id: 'plant.chamber.h_gas_wall_steam',
    family: 'plant',
    categoria: 'Câmara',
    label: 'Troca gás-parede (vapor)',
    unit: 'W/K',
    default: 200,
    min: 1,
    max: 2000,
    step: 1,
    timing: 'live',
    help: 'Coeficiente de troca gás↔parede interna com vapor puro condensando na parede (W/K, referência ρ = 0,6 kg/m³; escala com a densidade do gás). O coeficiente efetivo interpola pela fração molar de vapor: h = h_ar + (h_vapor − h_ar)·y, e só usa o termo de vapor se a parede está abaixo do ponto de orvalho. Aumentar: parede e gás se igualam mais rápido no aquecimento/esterilização.',
    get: (rt) => rt.params.chamber.wall_h_W_per_K ?? 200,
    set: (rt, v) => {
      rt.params.chamber.wall_h_W_per_K = v;
    },
  },
  {
    id: 'plant.chamber.h_gas_wall_air',
    family: 'plant',
    categoria: 'Câmara',
    label: 'Troca gás-parede (ar)',
    unit: 'W/K',
    default: 15,
    min: 0,
    max: 500,
    step: 1,
    timing: 'live',
    help: 'Coeficiente de troca gás↔parede interna com ar seco, convecção natural (W/K, referência ρ = 0,6 kg/m³; ar a 1 atm ≈ 1,7×). Típico: 5–30 W/K (~10× menor que com vapor). Define quanto a parede quente (camisa) reaquece o ar admitido na quebra de vácuo. Aumentar: câmara/dreno sobem mais depois da quebra. Diminuir: ficam mais perto da carga/ambiente.',
    get: (rt) => rt.params.chamber.wall_h_air_W_per_K ?? 15,
    set: (rt, v) => {
      rt.params.chamber.wall_h_air_W_per_K = v;
    },
  },
  {
    id: 'plant.chamber.h_gas_wall_steam_dry',
    family: 'plant',
    categoria: 'Câmara',
    label: 'Troca gás-parede (vapor seco)',
    unit: 'W/K',
    default: 100,
    min: 0,
    max: 1000,
    step: 1,
    timing: 'live',
    help: 'Coeficiente de troca gás↔parede com vapor SECO mais quente que a parede (parede acima do orvalho, sem filme): convecção forçada do jato superaquecido da admissão (W/K, referência ρ = 0,6 kg/m³). h = h_ar·(1−y) + h_vapor_seco·y; só vale com gás mais quente que a parede (parede aquecendo o gás = convecção natural, h_ar). Aumentar: câmara fica mais perto da T da parede quando o vapor entra superaquecido.',
    get: (rt) => rt.params.chamber.wall_h_steam_dry_W_per_K ?? 100,
    set: (rt, v) => {
      rt.params.chamber.wall_h_steam_dry_W_per_K = v;
    },
  },

  {
    id: 'plant.ambient.T',
    family: 'plant',
    categoria: 'Ambiente',
    label: 'Temperatura ambiente',
    unit: '°C',
    default: 23,
    min: 0,
    max: 45,
    step: 0.5,
    decimals: 1,
    timing: 'live',
    help: 'Temperatura do ar da sala (°C): máquina fria, carga nova, ar admitido e destino do resfriamento com a porta aberta. Típico: 18–30 °C. Aumentar: carga e câmara partem mais quentes, menos condensado. Diminuir: o contrário.',
    get: (rt) => rt.params.external.atmosphere_T - C_to_K(0),
    set: (rt, v) => {
      rt.params.external.atmosphere_T = C_to_K(v);
    },
  },
  {
    id: 'plant.door.h_open',
    family: 'plant',
    categoria: 'Portas',
    label: 'Perda parede com porta aberta',
    unit: 'W/K',
    default: DOOR_H_OPEN_DEFAULT,
    min: 0,
    max: 500,
    step: 1,
    timing: 'live',
    help: 'Perda de calor da parede interna para o ambiente por porta totalmente aberta (W/K); porta entreaberta conta proporcional, duas portas somam. Padrão 40 W/K (~3,5 m² de parede × ~10 W/m²K de convecção natural, câmara de 500 L). Aumentar: câmara esfria mais rápido com a porta aberta. Calibrar medindo a queda de temperatura da parede na máquina real.',
    get: (rt) => rt.params.door_h_open_W_per_K ?? DOOR_H_OPEN_DEFAULT,
    set: (rt, v) => {
      rt.params.door_h_open_W_per_K = v;
    },
  },
  {
    id: 'plant.door.tau_gas_s',
    family: 'plant',
    categoria: 'Portas',
    label: 'Troca de ar com porta aberta',
    unit: 's',
    default: DOOR_TAU_GAS_DEFAULT,
    min: 1,
    max: 600,
    step: 1,
    timing: 'live',
    help: 'Constante de tempo (s) para o gás da câmara virar ar ambiente a 1 atm com UMA porta aberta (com duas, metade). Padrão 20 s (~25 L/s de troca por empuxo numa câmara de 500 L). Diminuir: vapor sai e ar entra mais rápido.',
    get: (rt) => rt.params.door_tau_gas_s ?? DOOR_TAU_GAS_DEFAULT,
    set: (rt, v) => {
      rt.params.door_tau_gas_s = v;
    },
  },
  {
    id: 'plant.door.tau_pressao_s',
    family: 'plant',
    categoria: 'Portas',
    label: 'Equalização de pressão com porta aberta',
    unit: 's',
    default: DOOR_TAU_PRESSURE_DEFAULT,
    min: 0.05,
    max: 10,
    step: 0.05,
    timing: 'live',
    help: 'Constante de tempo (s) para a pressão da câmara igualar à atmosférica com a porta aberta (abertura > 2%), independente da troca lenta de ar. Padrão 0,1 s (um vão de porta iguala quase na hora). Aumentar: a pressão demora mais a voltar a 1 atm e fica um pouco acima dela enquanto o gás esquenta na parede quente (pode tirar o pressostato de câmara atmosférica).',
    get: (rt) => rt.params.door_tau_pressure_s ?? DOOR_TAU_PRESSURE_DEFAULT,
    set: (rt, v) => {
      rt.params.door_tau_pressure_s = v;
    },
  },
  {
    // Valor guardado = índice (padrão de knob de lista): 0 → tipo 1, 1 → tipo 2, 2 → tipo 3.
    id: 'plant.door.tipo',
    family: 'plant',
    categoria: 'Portas',
    label: 'Tipo de porta',
    unit: '',
    default: 2,
    min: 0,
    max: 2,
    step: 1,
    options: ['1', '2', '3'],
    optionLabels: ['1 — Manual volante central', '2 — Manual guilhotina', '3 — Automática guilhotina'],
    timing: 'live',
    help: 'Tipo de porta da máquina; deve ser igual ao tipo configurado no CLP. 1 = manual com volante central (guarnição estática, selada com a porta fechada). 2 = manual guilhotina (guarnição pressurizada pelo CLP quando o operador trava). 3 = automática guilhotina (o CLP abre/fecha). Nos tipos 1 e 2 o CLP não move a porta: abra/feche pelos botões do card de portas.',
    get: (rt) => rt.doorTipo - 1,
    set: (rt, v) => {
      rt.doorTipo = (Math.round(v) + 1) as 1 | 2 | 3;
      // duck typing: o runtime em globalThis pode carregar outra cópia da classe do bridge
      const b = rt.bridge as { tipo?: number };
      if ('tipo' in b) b.tipo = rt.doorTipo;
    },
  },

  materialKnob(
    'plant.load.material_a',
    'material_a',
    'Carga A — material',
    'STAINLESS_316',
    'Material da carga A (instrumental, cestos). Metais esquentam rápido e condensam muito no início; têxteis e plásticos retêm água.',
  ),
  massKnob(
    'plant.load.mass_a_kg',
    'mass_a_kg',
    'Carga A — massa',
    20,
    'Massa da carga A (kg). Típico: 5–100 kg. Mais massa: mais condensado e subida mais lenta.',
  ),
  materialKnob(
    'plant.load.material_b',
    'material_b',
    'Carga B — material',
    'COTTON_TEXTILE',
    'Material da carga B. B é o testemunho do F0 (ponto de medida); sem B o testemunho é A.',
  ),
  embalagemKnob('plant.load.embalagem_a', 'embalagem_a', 'Carga A — embalagem', 'Embalagem da carga A.' + EMBALAGEM_HELP),
  embalagemKnob('plant.load.embalagem_b', 'embalagem_b', 'Carga B — embalagem', 'Embalagem da carga B.' + EMBALAGEM_HELP),
  massKnob(
    'plant.load.mass_b_kg',
    'mass_b_kg',
    'Carga B — massa',
    5,
    'Massa da carga B (kg); 0 = sem carga B (testemunho passa a ser A).',
  ),
  {
    id: 'plant.load.T_initial',
    family: 'plant',
    categoria: 'Carga',
    label: 'Carga — temperatura inicial',
    unit: '°C',
    default: -1,
    min: -1,
    max: 100,
    step: 0.5,
    decimals: 1,
    timing: 'live',
    help:
      'Temperatura (°C) com que a carga entra no início de cada ciclo, mesmo com a câmara quente. -1 (sentinela, padrão) = segue a temperatura ambiente, inclusive se o ambiente mudar depois. Qualquer outro valor fixa a carga nessa temperatura, não importa o ambiente. Carga fria: mais condensado e subida mais lenta.' +
      LOAD_HELP,
    // -1 é devolvido como -1 (sentinela, não resolvido para a T ambiente atual) — resolver só
    // em cycleLoadState(), na hora de montar a carga do ciclo.
    get: (rt) => rt.loadKnobs.T_initial_C,
    set: (rt, v) => setLoad(rt, () => (rt.loadKnobs.T_initial_C = v)),
  },

  // ---- CONTROLLER (live: reference bang-bang bands) ----
  {
    id: 'controller.band_low',
    family: 'controller',
    categoria: 'Histerese',
    label: 'Banda baixa (abrir < SP+)',
    unit: '°C',
    default: 0.1,
    min: 0,
    max: 2,
    step: 0.05,
    timing: 'live',
    help: 'Histerese inferior do controlador bang-bang de referência (°C acima do setpoint): abaixo de SP + banda baixa a válvula de vapor abre. Típico: 0–0,5 °C. Aumentar: temperatura média sobe. Diminuir: abre mais tarde, média mais baixa.',
    get: (rt) => rt.controller.band_low,
    set: (rt, v) => {
      rt.controller.band_low = v;
    },
  },
  {
    id: 'controller.band_high',
    family: 'controller',
    categoria: 'Histerese',
    label: 'Banda alta (fechar > SP+)',
    unit: '°C',
    default: 0.5,
    min: 0,
    max: 3,
    step: 0.05,
    timing: 'live',
    help: 'Histerese superior do controlador de referência (°C acima do setpoint): acima de SP + banda alta a válvula de vapor fecha. Típico: 0,3–1 °C. Aumentar: oscilação maior e menos chaveamentos. Diminuir: controle mais justo, mais chaveamentos da válvula.',
    get: (rt) => rt.controller.band_high,
    set: (rt, v) => {
      rt.controller.band_high = v;
    },
  },

  // ---- TIME ----
  {
    id: 'time.scale',
    family: 'time',
    categoria: 'Simulação',
    label: 'Velocidade simulação (ticks/firing)',
    unit: '×',
    default: 2,
    min: 1,
    max: 50,
    step: 1,
    timing: 'live',
    help: 'Velocidade da simulação: ticks de física por disparo do relógio (2 = tempo real). Faixa: 1–50. Aumentar acelera o ciclo (só modo virtual; com CLP real fica travado em 1×). Não muda a física, só o relógio.',
    get: (rt) => rt.timeScale,
    set: (rt, v) => {
      rt.timeScale = Math.max(1, Math.round(v));
    },
  },
];

export function knobById(id: string): KnobDescriptor | undefined {
  return KNOBS.find((k) => k.id === id);
}

export function knobMeta(): KnobMeta[] {
  return KNOBS.map(({ get: _g, set: _s, ...meta }) => meta);
}

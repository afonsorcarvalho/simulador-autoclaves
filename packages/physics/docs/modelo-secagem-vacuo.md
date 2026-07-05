# Modelo físico da secagem a vácuo + arrefecimento evaporativo da carga

> Documento de referência. Consolida a teoria discutida antes da implementação.
> Alvo: `packages/physics` (`chamber.ts`, `load.ts`, `constants.ts`, novo `materials.ts`).
> Estado: **teoria fechada, implementação por especificar** (ver secção 9).

---

## 1. Problema observado

No live/trace, ao ~15 min (fases EXHAUST → DRY), a **pressão da câmara colapsa** de 3.04 → 0.01 bar mas a **temperatura fica presa** em ~134 °C (tanto gás da câmara `T_ch` como testemunho `T_test`).

Evidência (trace determinístico, amostrado 5 s):

| t (s) | fase | P (bar) | T_ch modelo | T_sat(P) real | superaquecimento |
|------:|------|--------:|------------:|--------------:|-----------------:|
| 850 | HOLD | 3.04 | 134.5 | ~134 | ~0 ✓ |
| 910 | EXHAUST | 2.64 | 130.4 | ~130 | ~0 ✓ |
| 930 | EXHAUST | 1.08 | 133.8 | ~101 | **+33 °C** |
| 940 | DRY | 0.12 | 133.7 | ~49 | **+85 °C** |
| 950 | DRY | 0.011 | 134.1 | ~8 | **+126 °C** |

A câmara é **vapor quase puro** (`m_air ≈ 2e-5 kg`), logo `P ≈ p_vap`. Vapor a 0.011 bar / 134 °C é fisicamente absurdo (fortemente superaquecido).

## 2. Causa-raiz no modelo atual

1. **`chamber_pressure()`** (`chamber.ts:38`): `p_vap = min(m_vap·R·T/V, p_sat(T))`. Ao ventilar vapor, a pressão cinética cai abaixo de `p_sat`; o `min` escolhe a cinética e o vapor fica **não-saturado**. Nada força `T` de volta à curva de saturação.
2. **Parede de 50 kg** (`wall_C ≈ 25 000 J/K`) acoplada por convecção constante (`wall_h = 200 W/K`) ao gás quase sem massa (`gas_C ~ 1–100 J/K`) → **T_gás fixa em T_parede** (`chamber.ts:144-147`), independente da pressão.
3. **Sem termo de arrefecimento por expansão** na blowdown (`chamber.ts:104`: `H_out = dm·cp·T`, a T constante).
4. **`m_liq` chega a 0 ainda no HOLD** → sem líquido para *flash* na exaustão.
5. **`load.ts` não tem humidade, evaporação nem radiação** → o testemunho não pode arrefecer; só troca convectiva com o gás.

## 3. Física correta (validada na literatura)

### 3.1 Acoplamento de saturação
Vapor saturado tem P e T travados na curva de saturação (Antoine, já em `saturation.ts`). Duas fases (líquido+vapor) presentes ⇒ o sistema segue a curva.

### 3.2 Flash / arrefecimento evaporativo
Queda súbita de P abaixo de `p_sat(T_água)` ⇒ a humidade vaporiza; **calor sensível → calor latente**; a fonte (carga) arrefece rumo a `T_sat(P_câmara)`. **Auto-limitado**: à medida que `T_carga` cai, `p_sat(T_carga) → P_câmara` e a taxa → 0.
Refs: Hindawi *flash evaporation* (2018); ScienceDirect *vacuum flash evaporation cooling* (2015).

### 3.3 Radiação sob vácuo
Sem gás não há convecção. A jaqueta transfere por radiação (Stefan-Boltzmann):
```
Q_rad = ε · σ · A · (T_jaqueta⁴ − T_carga⁴)      σ = 5.670e-8 W/(m²·K⁴)
```
Modesto; trava a queda e re-seca/re-aquece quando a humidade acaba.
Ref: Stefan-Boltzmann (nuclear-power.com).

### 3.4 Convecção ∝ densidade do gás
`h_conv,eff = h_0 · (ρ_gas / ρ_gas,atm)`. No vácuo `ρ_gas → 0` ⇒ `h_eff → 0`. Corrige o "fixar T à parede". Aplica-se a gás↔carga (`load.ts`) e gás↔parede (`chamber.ts`, `wall_h`). (Escolhido: ∝ densidade, o mais físico.)

### 3.5 Condensação acumulada durante o ciclo
Novo estado **`m_water_load` (kg)**, evolui o ciclo inteiro:
- **Aquecimento** (vapor presente, `T_carga < T_sat(P)`): vapor condensa na carga →
  `Q_cond = h_film·A·(T_sat − T_carga)` **aquece** a carga; água depositada
  `ṁ_cond = Q_cond / h_vap`, limitada a `m·capacidade_água`. `m_water_load` ↑.
- **Secagem** (`P < p_sat(T_carga)`): flash → `ṁ_ev = k_ev·A·(p_sat(T_carga) − p_vap_câmara)`;
  `Q_ev = ṁ_ev·h_vap` **retirado** da carga → arrefece. `m_water_load` ↓ até 0.
Simétrico e conservativo (a mesma água que condensou é a que evapora).
Refs: retenção têxtil PMC steam sterilization; condensação de vapor (EngineeringToolbox / tandfonline).

## 3.6 Nomenclatura — variáveis, constantes e unidades

Toda a simbologia usada nas §§3–4. SI internamente. **Estado** = evolui no tempo (integrado);
**parâmetro** = knob calibrável (default em `constants.ts`/`materials.ts`); **derivada** = calculada a cada passo.

### Constantes físicas (fixas, não calibráveis)

| Símbolo | Nome | Valor | Unidade | Onde |
|---|---|--:|---|---|
| `σ` | Constante de Stefan-Boltzmann | 5.670e-8 | W/(m²·K⁴) | `constants.ts` |
| `R` | Constante específica do vapor de água | 461.5 | J/(kg·K) | `constants.ts` |
| `cp_água` | Calor específico da água líquida | 4186 | J/(kg·K) | `materials.ts` (água) |

### Estados (integrados no tempo)

| Símbolo | Nome | Unidade | Notas |
|---|---|---|---|
| `T_load` (`T_carga`) | Temperatura do nó de carga | K (mostra °C) | nó lumped; testemunho `T_test` é nó próprio |
| `T_gas` (`T_ch`) | Temperatura do gás da câmara | K | quase sem massa no vácuo |
| `T_jaqueta` | Temperatura da parede/jaqueta | K | fonte radiante na secagem |
| `m_water_load` | Água condensada retida na carga | kg | §3.5; sobe no aquecimento, desce na secagem, ≥0 |
| `m_vap` | Massa de vapor na câmara | kg | acopla com `m_water_load` (conservação) |
| `m_liq` | Massa de líquido na câmara | kg | fonte de flash na exaustão |

### Parâmetros calibráveis (defaults; hardware real desvia)

| Símbolo | Nome | Unidade | Papel |
|---|---|---|---|
| `h0` | Coef. convecção base (à densidade atm) | W/(m²·K) | escala com densidade → ~0 no vácuo (§3.4) |
| `wall_h` | Condutância gás↔parede | W/K | mesma correção ∝ densidade |
| `wall_C` | Capacidade térmica da parede | J/K | ~25 000 (parede 50 kg) |
| `ε` (`emissivity`) | Emissividade da superfície | — (0..1) | por material, §5.1 |
| `A` | Área de troca (convectiva/radiante) | m² | por item; efetiva = `Σ ε·A` |
| `h_film` | Coef. de condensação em filme | W/(m²·K) | taxa de deposição de água (§3.5) |
| `k_ev` | Coef. de evaporação (flash) | kg/(s·m²·Pa) | taxa de secagem vs. sub-saturação |
| `C` | Massa térmica do nó de carga | J/K | `Σ mᵢ·cpᵢ (+ m_water·cp_água)` |
| `cp` | Calor específico do material | J/(kg·K) | §5.1 |
| `ρ_gas,atm` | Densidade do gás à referência (atm) | kg/m³ | normaliza `ρ_gas/ρ_gas,atm` |

### Derivadas / auxiliares (calculadas por passo)

| Símbolo | Nome | Unidade | Fórmula/origem |
|---|---|---|---|
| `ρ_gas` | Densidade instantânea do gás | kg/m³ | do estado da câmara; →0 no vácuo |
| `h_conv,eff` | Convecção efetiva | W/(m²·K) | `h0·(ρ_gas/ρ_gas,atm)` (§3.4) |
| `p_sat(T)` | Pressão de saturação a T | Pa | Antoine, `saturation.ts` |
| `T_sat(P)` | Temperatura de saturação a P | K | inversa de Antoine |
| `p_vap_câmara` | Pressão parcial de vapor na câmara | Pa | estado da câmara |
| `h_vap(T)` | Entalpia de vaporização a T | J/kg | latente; sinal define aquecer/arrefecer |
| `Q_conv` | Fluxo de calor convectivo | W | `h_conv,eff·A·(T_gas−T_load)` |
| `Q_rad` | Fluxo de calor radiante | W | `ε·σ·A·(T_jaqueta⁴−T_load⁴)` |
| `Q_lat` | Fluxo de calor latente | W | `±ṁ·h_vap`; + condensa, − evapora |
| `ṁ_cond` | Taxa de condensação | kg/s | `h_film·A·(T_sat−T_load)/h_vap` |
| `ṁ_ev` | Taxa de evaporação | kg/s | `k_ev·A·max(0, p_sat(T_load)−p_vap_câmara)` |
| `dt` | Passo do integrador Euler | s | — |

## 4. Equações do modelo proposto (por passo Euler, dt)

Para cada nó de carga (massa térmica `C = Σ mᵢ·cpᵢ (+ m_water·cp_água)`):
```
# fluxos de calor (W)
Q_conv = h0 · (ρ_gas/ρ_gas,atm) · A · (T_gas   − T_load)     # ~0 no vácuo
Q_rad  = ε · σ · A · (T_jaqueta⁴ − T_load⁴)                  # domina no vácuo
Q_lat  = ± ṁ · h_vap(T_load)                                 # + condensação, − evaporação

dT_load/dt = (Q_conv + Q_rad + Q_lat) / C

# massa de água na carga
if aquecimento & vapor:  ṁ_cond = h_film·A·(T_sat−T_load)/h_vap , cap a capacidade
if secagem:              ṁ_ev   = k_ev·A·max(0, p_sat(T_load)−p_vap_câmara)
d(m_water_load)/dt = ṁ_cond − ṁ_ev
```
Acoplamento à câmara: o vapor evaporado da carga entra em `chamber` (e é ventilado); a condensação retira vapor da câmara. Conservação de massa de água carga↔câmara.

## 5. Sistema de materiais (pragmático)

`packages/physics/materials.ts`:
```ts
interface MaterialProps {
  rho: number;                     // kg/m³
  cp: number;                      // J/(kg·K)
  k: number;                       // W/(m·K)  — só p/ Biot / validade lumped
  emissivity: number;              // 0..1
  waterCapacity_kg_per_kg: number; // condensado máx retido por kg seco
}
```
Registry por nome: `STAINLESS_316`, `CARBON_STEEL`, `ALUMINUM`, `GLASS`, `POLYPROPYLENE`, `PEEK`, `SILICONE`, `COTTON_TEXTILE`.

Load = lista de itens `{ material, mass_kg, surfaceArea_m2 }`. Agrega:
massa térmica `Σ m·cp`, área radiante efetiva `Σ ε·A`, capacidade de água `Σ m·cap`.

### 5.1 Tabela de propriedades (valores base)

| Material | ρ (kg/m³) | cp (J/kg·K) | k (W/m·K) | ε | água (kg/kg) |
|---|--:|--:|--:|--:|--:|
| Aço inox 316 | 8000 | 500 | 16 | 0.35–0.85 | ~0.02 |
| Aço carbono | 7870 | 460 | 50 | 0.6–0.8 | ~0.02 |
| Alumínio | 2700 | 900 | 200 | 0.05–0.2 | ~0.02 |
| Vidro | 2500 | 840 | 1.0 | 0.9 | ~0.02 |
| Polipropileno | 905 | 1920 | 0.2 | 0.9 | ~0.05 |
| PEEK | 1300 | 1340 | 0.25 | 0.9 | ~0.05 |
| Silicone | 1200 | 1300 | 0.2 | 0.9 | ~0.1 |
| Tecido algodão | ~1500 (fibra) | 1400 | 0.04 | 0.8 | **0.3–1.0** |
| Água (condensado) | 1000 | 4186 | 0.6 | — | — |

Fontes: AIST thermophysical DB; EngineeringToolbox material properties; retenção têxtil PMC.
Todos os valores são **knobs calibráveis** com defaults — hardware real desvia (calibração).

## 6. Decisões fechadas (pragmático)

- **Nós**: poucos nós lumped (não N por item, não gradientes internos). Testemunho = nó próprio (crítico p/ F0).
- **Convecção vs vácuo**: ∝ densidade do gás (o mais físico).
- **k**: só para checar validade lumped (Biot); sem sub-nós na v1.
- **Condensação**: acumulada durante todo o ciclo (fiel), não semeada.
- **Materiais**: registry configurável; utilizador configura itens (material, massa, área).
- **Âmbito**: `load.ts` + `chamber.ts` + `constants.ts` + novo `materials.ts` + testes.

## 7. Comportamento esperado após implementação

Início da secagem → P cai → carga húmida faz flash → `T_carga` cai rumo a `T_sat(P)`;
radiação da jaqueta equilibra num patamar (não cai até ~8 °C); humidade esgota → radiação
re-aquece/seca. **Câmara-gás e testemunho ambos descem** na secagem (correção do bug da §1).
Esterilização (HOLD) inalterada — testemunho na temperatura de esterilização.

## 8. Invariantes a manter

- SI internamente; constantes em `constants.ts`, sem magic numbers inline.
- Conservação de massa de água (carga ↔ câmara) e de energia (latente aplicada nos dois lados).
- F0 continua a referenciar a temperatura da carga/testemunho.
- Sem regressão nas fases pré-secagem (prevac/pressurize/hold) — cobertas por testes existentes.

## 8b. Bloqueador atual: superaquecimento do gás da câmara (2026-07-05)

Estado após implementar N-nós + pinning + come-up wetting: o testemunho **molha** no come-up
(~0.38 kg de condensado) e fica preso a 134 °C no HOLD. Mas a **queda na secagem ainda não aparece**
(testemunho sobe a ~138 e cai pouco). Diagnóstico com a coluna `m_water_load` do trace:

1. No início do DRY o testemunho tem ~0.3 kg de água e faz flash (água → 0), MAS **sobe** 135→138 em
   vez de arrefecer.
2. Causa: o **gás da câmara superaquece** (~217 °C) e, enquanto ainda há densidade no início do DRY
   (`rho_gas` não-nula), aquece o testemunho por **convecção** (~660 W) — mais do que o flash arrefece.
   Quando P→0 (`rho_gas`→0) a convecção morre e aí o testemunho arrefece lentamente (mas já secou).
3. Origem do 217 °C: dois mecanismos degenerados da câmara em vácuo:
   - **Spike de latente** (`chamber.ts:213-215`): o vapor que a carga faz flash entra na câmara,
     ultrapassa a saturação e condensa; o latente é depositado no gás com `denom` no floor de 500 J/K
     → T dispara. (Feedback: carga faz flash → câmara condensa → gás dispara → aquece a carga.)
   - **Teto T_MAX** (`chamber.ts:126`): com `m_liq=0` e vácuo, a massa de gás é quase-nula e T bate no
     teto de 220 °C (T ill-defined com heat capacity ~0).

Tentativa rejeitada: clamp `T ≤ T_sat(p_vap)` quando `m_liq>0` — ajuda parcialmente (217→155) mas (a)
não cobre o caso `m_liq=0`, (b) com o vapor supersaturado o `p_vap` cinético dá T_sat alto (clamp fraco),
(c) abrandou a remoção de líquido da câmara (quebrou `drying.test.ts`). Precisa de redesenho, não patch.

**Abordagem a desenhar (próximo):** modelar a câmara como sistema bifásico próprio, pinned a T_sat(P)
enquanto duas fases, com a energia latente a ir para a parede/removida em vez de superaquecer o gás
quase-nulo; e/ou tratar o gás vac­uo-só (massa < limiar) como termodinamicamente irrelevante (T pegada
a T_sat(p_vap) ou à parede, não ao teto). Alvo: gás da câmara não excede a saturação → convecção deixa
de aquecer a carga no início do DRY → o flash da água (0.38 kg) faz a queda aparecer end-to-end.

### 8b.1 Diagnóstico refinado + protótipo provado (2026-07-05, sessão)

Observação-chave do utilizador (correta): **vapor saturado tem T travada à pressão (curva de saturação),
sempre**; a jaqueta não pode superaquecê-lo. Medido no trace: o gás da câmara estava **+24 °C acima de
T_sat** no HOLD/PRESSURIZE (subia 137→158 °C a P constante 3.04 bar) — supersaturado, impossível.

**Duas causas:** (1) a condução jaqueta→câmara (`jacket_chamber_h_W_per_K`) era somada ao `Q_external`
do **gás** (devia ir para a **parede**); (2) T do gás era livre, sem pin de saturação.

**Protótipo (implementado e revertido — provou o princípio, mas não é direto):**
- Rotear a condução para a parede (`ChamberFluxes.Q_wall_external`) + **pin do gás a T_sat(p_vap)**
  quando dominado por vapor (excesso devolvido à parede). → **Resultado: gás SATURADO, dT ≈ 0.0–0.3 °C**
  o ciclo todo (era +24). O núcleo funciona.
- **Fallout que o torna sub-projeto (spec→plano, não patch):**
  1. Com o gás pinned a saturação, o **líquido da câmara não evapora** (sem sub-saturação) → é preciso o
     lado **flash bidirecional** da câmara (líquido vaporiza para alimentar a bomba, arrefecendo — igual à
     carga). A versão quase-estática desse flash **desestabilizou numericamente** o ciclo (o floor
     `MIN_HEAT_CAP` e o `k_evap` lento originais existem justamente para evitar estes spikes) → precisa de
     integração implícita/limitada, com cuidado.
  2. O ciclo **estagna em PRESSURIZE**: vapor saturado a 3.04 bar é 133.7 °C < 134 → o testemunho nunca
     atinge o setpoint. Correto! Antes "atingia" só por estar superaquecido. Requer subir o alívio da
     câmara p/ ~3.2 bar (o Antoine do modelo dá p_sat(134)≈3.09) — retuning de cenários.
  3. Migração de ~4 testes (wall-coupling passa a aquecer a parede; drying-liquid; hardness/F0 no drying).

**Conclusão:** o pin de saturação é a correção certa e provada, mas landing limpo = redesenho bifásico da
câmara + estabilidade numérica + retuning de pressão + migração de testes. Candidato a mini-spec dedicado.

## 9. Questões em aberto (para brainstorm / plano)

1. Nº de nós lumped: 1 carga agregada + testemunho, ou 2 (metal + têxtil) + testemunho?
2. Área de superfície: fornecida por item vs estimada `A ≈ fator·(m/ρ)^(2/3)`?
3. Capacidade de água: `kg/kg` (escolhido) vs `g/m²` — confirmar unidade de config.
4. `h_film` (condensação) e `k_ev` (evaporação): defaults + gama de calibração.
5. Onde vive a config de load no web (SP posterior) e como serializa (YAML de cenário?).
6. Estratégia de teste: cenário de secagem com asserção `T_test` desce e `m_water_load → 0`.

## 10. Fontes

- Flash evaporation — Hindawi Int. J. Aerospace Eng. (2018): https://www.hindawi.com/journals/ijae/2018/3686802/
- Vacuum flash evaporation cooling — ScienceDirect (2015): https://www.sciencedirect.com/science/article/abs/pii/S0017931015000095
- Stefan-Boltzmann — nuclear-power.com: https://www.nuclear-power.com/nuclear-engineering/heat-transfer/radiation-heat-transfer/stefan-boltzmann-law-stefan-boltzmann-constant/
- Propriedades termofísicas — AIST DB: https://tpds.db.aist.go.jp/detail/stainless_en.html
- Material properties — EngineeringToolbox: https://www.engineeringtoolbox.com/material-properties-t_24.html
- Retenção de humidade têxtil — PMC steam sterilization review: https://pmc.ncbi.nlm.nih.gov/articles/PMC12947077/
- Drying de meios porosos — Hindawi IJChE (2018): https://www.hindawi.com/journals/ijce/2018/9456418/

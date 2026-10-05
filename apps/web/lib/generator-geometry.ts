/** Geometria pura do desenho do vaso do gerador (GeneratorView) — sem JSX, testável isolada. */

// vaso: x 40..160, y 40..240 (fundo)
export const VASO_TOP = 40;
export const VASO_H = 200;

/** Fração da altura do vaso ocupada por `kg` de água (0 = fundo, 1 = cheio), dada a capacidade do
 *  gerador. Mesma fração usada pelos limiares dos eletrodos (LVL_GEN_MIN_FRAC/MAX_FRAC em
 *  @sim/physics) — o desenho e o sensor simulado ficam sempre de acordo. */
export function fracaoNivel(kg: number, capacidadeKg: number): number {
  if (capacidadeKg <= 0) return 0;
  return Math.min(Math.max(kg / capacidadeKg, 0), 1);
}

/** Posição y (SVG) do nível de `kg` de água no vaso. */
export function yNivel(kg: number, capacidadeKg: number): number {
  return VASO_TOP + VASO_H * (1 - fracaoNivel(kg, capacidadeKg));
}

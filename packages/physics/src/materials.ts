// packages/physics/src/materials.ts
export interface MaterialProps {
  rho: number; // kg/m³
  cp: number; // J/(kg·K)
  k: number; // W/(m·K) — só p/ checagem de Biot (informativo na v1)
  emissivity: number; // 0..1
  waterCapacity_kg_per_kg: number; // condensado máx retido / kg seco
  shapeFactor: number; // A ≈ shapeFactor·(m/ρ)^(2/3)
}

export const MATERIALS = {
  STAINLESS_316: { rho: 8000, cp: 500, k: 16, emissivity: 0.5, waterCapacity_kg_per_kg: 0.02, shapeFactor: 6 },
  CARBON_STEEL: { rho: 7870, cp: 460, k: 50, emissivity: 0.7, waterCapacity_kg_per_kg: 0.02, shapeFactor: 6 },
  ALUMINUM: { rho: 2700, cp: 900, k: 200, emissivity: 0.1, waterCapacity_kg_per_kg: 0.02, shapeFactor: 6 },
  GLASS: { rho: 2500, cp: 840, k: 1.0, emissivity: 0.9, waterCapacity_kg_per_kg: 0.02, shapeFactor: 6 },
  POLYPROPYLENE: { rho: 905, cp: 1920, k: 0.2, emissivity: 0.9, waterCapacity_kg_per_kg: 0.05, shapeFactor: 6 },
  PEEK: { rho: 1300, cp: 1340, k: 0.25, emissivity: 0.9, waterCapacity_kg_per_kg: 0.05, shapeFactor: 6 },
  SILICONE: { rho: 1200, cp: 1300, k: 0.2, emissivity: 0.9, waterCapacity_kg_per_kg: 0.1, shapeFactor: 6 },
  COTTON_TEXTILE: { rho: 400, cp: 1400, k: 0.04, emissivity: 0.8, waterCapacity_kg_per_kg: 0.6, shapeFactor: 10 },
} as const satisfies Record<string, MaterialProps>;

export type MaterialName = keyof typeof MATERIALS;

/** Área de troca estimada da massa e densidade: A ≈ shapeFactor·(m/ρ)^(2/3) (m²). */
export function estimateArea(mass_kg: number, m: MaterialProps): number {
  if (mass_kg <= 0) return 0;
  return m.shapeFactor * Math.cbrt((mass_kg / m.rho) ** 2);
}

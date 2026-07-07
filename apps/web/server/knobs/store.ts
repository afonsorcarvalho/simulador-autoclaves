import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Runtime } from '../runtime/singleton.js';
import { KNOBS, knobById } from './registry.js';

/** Default override-file path (relative to cwd = apps/web when running dev/start). */
export function defaultOverridePath(): string {
  return resolve(process.cwd(), 'knobs.override.json');
}

/** Versioned factory-defaults file (committed). Baseline for reset; falls back to
 * registry `default` per-knob if the file is missing or a key is absent/invalid. */
export function defaultFactoryPath(): string {
  return resolve(process.cwd(), 'knobs.factory.json');
}

/** Factory value for one knob: file value if valid, else the registry default. */
function factoryValue(k: (typeof KNOBS)[number], factory: Record<string, number>): number {
  const v = factory[k.id];
  return v !== undefined && Number.isFinite(v) && v >= k.min && v <= k.max ? v : k.default;
}

function readFile(path: string): Record<string, number> {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, number>;
  } catch {
    return {};
  }
}

function writeFile(path: string, data: Record<string, number>): void {
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf8');
}

function validate(id: string, value: number): void {
  const k = knobById(id);
  if (!k) throw new Error(`unknown knob "${id}"`);
  if (!Number.isFinite(value)) throw new Error(`value must be finite`);
  if (value < k.min || value > k.max) {
    throw new Error(`value ${value} out of range [${k.min}, ${k.max}] for "${id}"`);
  }
}

/** Apply the factory baseline to the runtime (boot, before overrides). */
export function applyFactory(rt: Runtime, path = defaultFactoryPath()): void {
  const factory = readFile(path);
  for (const k of KNOBS) k.set(rt, factoryValue(k, factory));
}

/** Apply persisted overrides on top of defaults (boot). */
export function applyOverrides(rt: Runtime, path = defaultOverridePath()): void {
  const overrides = readFile(path);
  for (const k of KNOBS) {
    const v = overrides[k.id];
    if (v !== undefined && Number.isFinite(v) && v >= k.min && v <= k.max) {
      k.set(rt, v);
    }
  }
}

/** Apply one knob, validate, mutate runtime, persist. */
export function applyOne(
  rt: Runtime,
  id: string,
  value: number,
  path = defaultOverridePath(),
): void {
  validate(id, value);
  knobById(id)!.set(rt, value);
  const overrides = readFile(path);
  overrides[id] = value;
  writeFile(path, overrides);
}

/** Current effective value of every knob. */
export function currentValues(rt: Runtime): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of KNOBS) out[k.id] = k.get(rt);
  return out;
}

/** Restore the factory baseline and delete the override file. */
export function resetAll(
  rt: Runtime,
  path = defaultOverridePath(),
  factoryPath = defaultFactoryPath(),
): void {
  const factory = readFile(factoryPath);
  for (const k of KNOBS) k.set(rt, factoryValue(k, factory));
  if (existsSync(path)) rmSync(path);
}

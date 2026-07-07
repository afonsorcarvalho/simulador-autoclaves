import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Runtime } from '../runtime/singleton.js';
import { KNOBS, knobById } from './registry.js';

/** Default override-file path (relative to cwd = apps/web when running dev/start). */
export function defaultOverridePath(): string {
  return resolve(process.cwd(), 'knobs.override.json');
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
export function applyOne(rt: Runtime, id: string, value: number, path = defaultOverridePath()): void {
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

/** Restore all defaults and delete the override file. */
export function resetAll(rt: Runtime, path = defaultOverridePath()): void {
  for (const k of KNOBS) k.set(rt, k.default);
  if (existsSync(path)) rmSync(path);
}

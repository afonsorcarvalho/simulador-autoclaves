import { describe, it, expect, beforeEach } from 'vitest';
import { getRuntime, resetRuntime } from '../../server/runtime/singleton.js';
import { setManualValve } from '../../server/runtime/manual-control.js';
import { RegisterAccess } from '../../server/bridge/register-access.js';

describe('setManualValve', () => {
  beforeEach(() => resetRuntime());

  it('writes the requested valve discrete input when no cycle running', async () => {
    const r = getRuntime();
    await setManualValve(r, 'V_VAC', true);
    const access = new RegisterAccess(r.bridge);
    expect(await access.getDiscrete('V_VAC')).toBe(true);
  });

  it('throws when a cycle is running (would conflict with PLC)', async () => {
    const r = getRuntime();
    r.startCycle({
      name: 't', sterilization_T_C: 134, sterilization_P_bar: 3.04, hold_duration_s: 60,
      prevac_pulses: 0, prevac_vacuum_target_bar: 0.2, prevac_steam_target_bar: 2,
      preheat_duration_s: 10, dry_duration_s: 60, f0_target_min: 1,
    });
    await expect(setManualValve(r, 'V_VAC', true)).rejects.toThrow(/cycle running/i);
  });

  it('rejects unknown valve ids', async () => {
    const r = getRuntime();
    await expect(setManualValve(r, 'V_NONSENSE' as never, true)).rejects.toThrow(/unknown/i);
  });
});

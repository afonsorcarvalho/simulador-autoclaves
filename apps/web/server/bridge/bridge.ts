/**
 * Abstract Modbus-shaped interface sitting between the orchestrator (which owns
 * the physics model) and the PLC (real ESP32 or virtual in-process). Both sides
 * see the same 4-space register layout from @sim/protocol.
 */
export interface ModbusBridge {
  /** Discrete Inputs (0x0000-0x0FFF): PLC outputs read by ESP32.
   *  These are the COMMANDS the PLC sent (valve open/close, relay on/off). */
  readDiscreteInputs(addr: number, count: number): Promise<boolean[]>;
  /** Test/virtual-only: write DI directly (simulates PLC commanding). Real bridge throws. */
  writeDiscreteInputs(addr: number, values: boolean[]): Promise<void>;

  /** Coils (0x1000-0x1FFF): discrete states ESP32 publishes to PLC.
   *  Pressure switches, limit switches, level switches. */
  readCoils(addr: number, count: number): Promise<boolean[]>;
  writeCoils(addr: number, values: boolean[]): Promise<void>;

  /** Holding registers (0x3000-0x3FFF + 0x4000-0x4FFF diagnostics).
   *  PC writes analog values for the PLC to read (P, T, F0, tick, watchdog).
   *  int16, with per-register scale defined in @sim/protocol. */
  readHoldingRegisters(addr: number, count: number): Promise<number[]>;
  writeHoldingRegisters(addr: number, values: number[]): Promise<void>;

  connect(): Promise<void>;
  disconnect(): Promise<void>;
}

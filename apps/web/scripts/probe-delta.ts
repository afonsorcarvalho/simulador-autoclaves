// Sonda SÓ LEITURA do CLP Delta: imprime M40..M59 e D10..D13 / D30..D32.
// Uso: pnpm --filter @sim/web probe:delta [host]
import { ModbusTcpClient, deltaD, deltaM } from '../server/bridge/modbus-tcp.js';
import { PLC_OUTPUTS } from '../server/bridge/delta-plc.js';

const host = process.argv[2] ?? process.env.SIM_PLC_HOST ?? '127.0.0.1';
const c = new ModbusTcpClient(host);
try {
  const m = await c.readBits(deltaM(40), PLC_OUTPUTS.length);
  PLC_OUTPUTS.forEach(([name], i) => console.log(`M${40 + i}\t${name}\t${m[i] ? 1 : 0}`));
  const pt = await c.readRegs(deltaD(10), 4);
  const p = await c.readRegs(deltaD(30), 3);
  pt.forEach((v, i) => console.log(`D${10 + i}\tBRUTO_PT_${i + 1}\t${v}`));
  ['PCI', 'PCE', 'PGER'].forEach((n, i) => console.log(`D${30 + i}\tBRUTO_${n}\t${p[i]}`));
} catch (err) {
  console.error(`falha falando com ${host}:`, (err as Error).message);
  process.exitCode = 1;
} finally {
  c.close();
}

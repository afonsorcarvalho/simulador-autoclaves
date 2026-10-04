import { Socket } from 'node:net';

/** Operações Modbus que a DeltaPlcBridge usa. Injetável para testes (transport fake). */
export interface ModbusTransport {
  readBits(addr: number, count: number): Promise<boolean[]>; // FC1
  writeBits(addr: number, values: boolean[]): Promise<void>; // FC15
  readRegs(addr: number, count: number): Promise<number[]>; // FC3 (int16)
  writeRegs(addr: number, values: number[]): Promise<void>; // FC16
  close(): void;
}

/** Endereços Modbus do Delta DVP: M n = 0x0800+n, D n = 0x1000+n. */
export const deltaM = (n: number): number => 0x0800 + n;
export const deltaD = (n: number): number => 0x1000 + n;

/**
 * Cliente Modbus TCP mínimo (MBAP sobre node:net). Uma requisição por vez;
 * reconecta sozinho na próxima chamada depois de erro.
 * ponytail: sem pipelining — suficiente para ~10 req/s num CLP de bancada.
 */
export class ModbusTcpClient implements ModbusTransport {
  private sock: Socket | null = null;
  private tid = 0;
  private buf = Buffer.alloc(0);
  private pending: {
    tid: number;
    resolve: (pdu: Buffer) => void;
    reject: (e: Error) => void;
  } | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly host: string,
    private readonly port = 502,
    private readonly unit = 1,
    private readonly timeoutMs = 1000,
  ) {}

  private open(): Promise<Socket> {
    if (this.sock) return Promise.resolve(this.sock);
    return new Promise((resolve, reject) => {
      const s = new Socket();
      const fail = (e: Error): void => {
        s.destroy();
        reject(e);
      };
      s.setTimeout(this.timeoutMs, () => fail(new Error(`timeout conectando em ${this.host}`)));
      s.once('error', fail);
      s.connect(this.port, this.host, () => {
        s.setTimeout(0);
        s.removeListener('error', fail);
        s.on('data', (d) => this.onData(d));
        s.on('error', (e) => this.drop(e));
        s.on('close', () => this.drop(new Error('conexão fechada')));
        this.sock = s;
        resolve(s);
      });
    });
  }

  private drop(e: Error): void {
    this.sock?.destroy();
    this.sock = null;
    this.buf = Buffer.alloc(0);
    const p = this.pending;
    this.pending = null;
    p?.reject(e);
  }

  private onData(d: Buffer): void {
    this.buf = Buffer.concat([this.buf, d]);
    while (this.buf.length >= 7) {
      const len = this.buf.readUInt16BE(4);
      if (this.buf.length < 6 + len) return;
      const tid = this.buf.readUInt16BE(0);
      const pdu = this.buf.subarray(7, 6 + len);
      this.buf = this.buf.subarray(6 + len);
      if (this.pending && this.pending.tid === tid) {
        const p = this.pending;
        this.pending = null;
        if (pdu[0]! & 0x80)
          p.reject(new Error(`exceção Modbus FC${pdu[0]! & 0x7f} código ${pdu[1]}`));
        else p.resolve(pdu);
      }
    }
  }

  private request(pdu: Buffer): Promise<Buffer> {
    const run = async (): Promise<Buffer> => {
      const s = await this.open();
      this.tid = (this.tid + 1) & 0xffff;
      const tid = this.tid;
      const head = Buffer.alloc(7);
      head.writeUInt16BE(tid, 0);
      head.writeUInt16BE(0, 2);
      head.writeUInt16BE(pdu.length + 1, 4);
      head.writeUInt8(this.unit, 6);
      return new Promise<Buffer>((resolve, reject) => {
        const t = setTimeout(
          () => this.drop(new Error('timeout na resposta Modbus')),
          this.timeoutMs,
        );
        this.pending = {
          tid,
          resolve: (r) => (clearTimeout(t), resolve(r)),
          reject: (e) => (clearTimeout(t), reject(e)),
        };
        s.write(Buffer.concat([head, pdu]));
      });
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  async readBits(addr: number, count: number): Promise<boolean[]> {
    const pdu = Buffer.alloc(5);
    pdu.writeUInt8(1, 0);
    pdu.writeUInt16BE(addr, 1);
    pdu.writeUInt16BE(count, 3);
    const r = await this.request(pdu);
    return Array.from({ length: count }, (_, i) => ((r[2 + (i >> 3)]! >> (i & 7)) & 1) === 1);
  }

  async writeBits(addr: number, values: boolean[]): Promise<void> {
    const n = Math.ceil(values.length / 8);
    const pdu = Buffer.alloc(6 + n);
    pdu.writeUInt8(15, 0);
    pdu.writeUInt16BE(addr, 1);
    pdu.writeUInt16BE(values.length, 3);
    pdu.writeUInt8(n, 5);
    values.forEach((v, i) => {
      if (v) pdu[6 + (i >> 3)]! |= 1 << (i & 7);
    });
    await this.request(pdu);
  }

  async readRegs(addr: number, count: number): Promise<number[]> {
    const pdu = Buffer.alloc(5);
    pdu.writeUInt8(3, 0);
    pdu.writeUInt16BE(addr, 1);
    pdu.writeUInt16BE(count, 3);
    const r = await this.request(pdu);
    return Array.from({ length: count }, (_, i) => r.readInt16BE(2 + 2 * i));
  }

  async writeRegs(addr: number, values: number[]): Promise<void> {
    const pdu = Buffer.alloc(6 + 2 * values.length);
    pdu.writeUInt8(16, 0);
    pdu.writeUInt16BE(addr, 1);
    pdu.writeUInt16BE(values.length, 3);
    pdu.writeUInt8(2 * values.length, 5);
    values.forEach((v, i) => pdu.writeInt16BE(v, 6 + 2 * i));
    await this.request(pdu);
  }

  close(): void {
    this.drop(new Error('fechado'));
  }
}

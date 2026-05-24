export class CsvTrace<C extends string> {
  private readonly columns: C[];
  private readonly rows: number[][] = [];

  constructor(columns: C[]) {
    this.columns = columns;
  }

  row(values: Record<C, number>): void {
    const arr: number[] = [];
    for (const c of this.columns) {
      if (!(c in values)) throw new Error(`CsvTrace row missing column "${c}"`);
      arr.push(values[c]);
    }
    this.rows.push(arr);
  }

  serialize(): string {
    const fmt = (n: number): string => {
      if (Number.isInteger(n)) return n.toString();
      return n.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
    };
    const lines = [this.columns.join(',')];
    for (const row of this.rows) {
      lines.push(row.map(fmt).join(','));
    }
    return lines.join('\n');
  }
}

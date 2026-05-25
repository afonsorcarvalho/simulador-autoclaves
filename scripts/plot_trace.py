"""Plot a scenario trace CSV produced by @sim/physics CLI.

Usage:
    python scripts/plot_trace.py [csv_path] [--save out.png] [--no-show]

Default csv_path: packages/physics/out/trace.csv
"""

from __future__ import annotations

import argparse
import csv
import math
import sys
from pathlib import Path

import matplotlib.pyplot as plt


def read_csv(path: Path) -> dict[str, list[float]]:
    cols: dict[str, list[float]] = {}
    with path.open("r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        if reader.fieldnames is None:
            raise SystemExit(f"CSV has no header: {path}")
        for c in reader.fieldnames:
            cols[c] = []
        for row in reader:
            for c, v in row.items():
                try:
                    cols[c].append(float(v))
                except ValueError:
                    cols[c].append(math.nan)
    return cols


def plot(cols: dict[str, list[float]], save: Path | None, show: bool) -> None:
    t = cols["t_s"]

    fig, axes = plt.subplots(4, 1, figsize=(12, 11), sharex=True)
    fig.suptitle("Autoclave scenario trace", fontsize=14, fontweight="bold")

    # 1. Pressures
    ax = axes[0]
    ax.plot(t, cols["P_chamber_bar"], label="P_chamber", linewidth=1.5)
    ax.plot(t, cols["P_jacket_bar"], label="P_jacket", linewidth=1.2, alpha=0.8)
    ax.plot(t, cols["P_gen_bar"], label="P_generator", linewidth=1.2, alpha=0.8)
    ax.axhline(1.0, color="gray", linestyle=":", linewidth=0.7, label="1 atm")
    ax.axhline(3.04, color="red", linestyle=":", linewidth=0.7, label="134°C sat (3.04 bar)")
    ax.set_ylabel("Pressure (bar abs)")
    ax.legend(loc="upper right", fontsize=8)
    ax.grid(True, alpha=0.3)

    # 2. Temperatures
    ax = axes[1]
    ax.plot(t, cols["T_chamber_C"], label="T_chamber (gas)", linewidth=1.5)
    ax.plot(t, cols["T_test_C"], label="T_testemunho (fabric)", linewidth=1.5, color="darkorange")
    ax.plot(t, cols["T_jacket_C"], label="T_jacket", linewidth=1.0, alpha=0.7)
    ax.plot(t, cols["T_gen_C"], label="T_generator", linewidth=1.0, alpha=0.7)
    ax.axhline(121.1, color="gray", linestyle=":", linewidth=0.7, label="121.1°C")
    ax.axhline(134.0, color="red", linestyle=":", linewidth=0.7, label="134°C")
    ax.set_ylabel("Temperature (°C)")
    ax.legend(loc="upper left", fontsize=8)
    ax.grid(True, alpha=0.3)

    # 3. F0 (log scale)
    ax = axes[2]
    f0 = [max(v, 1e-3) for v in cols["F0_min"]]
    ax.semilogy(t, f0, label="F0 accumulated", linewidth=1.5, color="purple")
    ax.axhline(15, color="gray", linestyle=":", linewidth=0.7, label="F0=15 (121°C target)")
    ax.axhline(100, color="red", linestyle=":", linewidth=0.7, label="F0=100 (prion target)")
    ax.set_ylabel("F0 (min equivalent)\nlog scale")
    ax.legend(loc="lower right", fontsize=8)
    ax.grid(True, which="both", alpha=0.3)

    # 4. Masses in chamber
    ax = axes[3]
    ax.plot(t, cols["m_air_chamber"], label="m_air", linewidth=1.2)
    ax.plot(t, cols["m_vap_chamber"], label="m_vapor", linewidth=1.2)
    ax.plot(t, cols["m_liq_chamber"], label="m_liquid (condensate)", linewidth=1.2)
    ax.set_ylabel("Mass in chamber (kg)")
    ax.set_xlabel("Time (s)")
    ax.legend(loc="upper right", fontsize=8)
    ax.grid(True, alpha=0.3)

    plt.tight_layout(rect=(0, 0, 1, 0.97))

    if save is not None:
        fig.savefig(save, dpi=120, bbox_inches="tight")
        print(f"[plot] saved to {save}")

    if show:
        plt.show()


def main() -> None:
    parser = argparse.ArgumentParser(description="Plot autoclave scenario trace.")
    parser.add_argument(
        "csv",
        nargs="?",
        default="packages/physics/out/trace.csv",
        help="path to trace CSV (default: packages/physics/out/trace.csv)",
    )
    parser.add_argument("--save", type=Path, default=None, help="save figure to PNG")
    parser.add_argument("--no-show", action="store_true", help="do not open GUI window")
    args = parser.parse_args()

    path = Path(args.csv)
    if not path.is_file():
        sys.exit(f"CSV not found: {path}")

    cols = read_csv(path)
    n = len(cols.get("t_s", []))
    print(f"[plot] loaded {n} rows from {path}")
    if n == 0:
        sys.exit("empty CSV")

    plot(cols, args.save, show=not args.no_show)


if __name__ == "__main__":
    main()

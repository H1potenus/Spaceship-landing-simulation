#!/usr/bin/env python3
"""Regenerates every figure in docs/images from the data in docs/data.

    python3 tools/make_figures.py

Requires: Python 3.9+, numpy, matplotlib, and Node.js (the flights are re-simulated with the
same JavaScript core the browser uses).
"""
import csv
import json
import subprocess
import tempfile
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "docs" / "data"
IMG = ROOT / "docs" / "images"
IMG.mkdir(parents=True, exist_ok=True)

BG, PANEL, GRID = "#0b1119", "#0f1722", "#1f2d3d"
TEXT, MUTED = "#cfd9e4", "#7d90a5"
CYAN, GREEN, ORANGE, RED, BLUE, YELLOW = "#22d3ee", "#34d399", "#f59e0b", "#f87171", "#60a5fa", "#facc15"

plt.rcParams.update({
    "figure.facecolor": BG, "axes.facecolor": PANEL, "savefig.facecolor": BG,
    "axes.edgecolor": GRID, "axes.labelcolor": TEXT, "text.color": TEXT,
    "xtick.color": MUTED, "ytick.color": MUTED, "axes.grid": True, "grid.color": GRID,
    "grid.linewidth": 0.6, "font.size": 10, "axes.titlesize": 11, "axes.titleweight": "bold",
    "axes.titlecolor": TEXT, "legend.facecolor": PANEL, "legend.edgecolor": GRID,
    "font.family": "DejaVu Sans", "axes.spines.top": False, "axes.spines.right": False,
})


def export_flights(tmp: Path, name: str, extra):
    out = tmp / f"{name}.json"
    subprocess.run(["node", str(ROOT / "tools" / "export-flights.js"), "--episodes", "60",
                    "--seed", "5", "--out", str(out), *extra], check=True, stdout=subprocess.DEVNULL, cwd=ROOT)
    return json.loads(out.read_text())


def history(run):
    with open(DATA / run / "history.csv") as f:
        rows = list(csv.DictReader(f))
    return {k: np.array([float(r[k]) for r in rows]) for k in rows[0]}


def smooth(v, n=7):
    k = np.ones(n) / n
    pad = np.pad(v, (n // 2, n - 1 - n // 2), mode="edge")
    return np.convolve(pad, k, mode="valid")


# ------------------------------------------------------------------ 1. learning curves
def fig_learning():
    runs = sorted(p.name for p in DATA.iterdir() if p.name.startswith("seed"))
    H = [history(r) for r in runs]
    fig, ax = plt.subplots(1, 2, figsize=(11.5, 4.1))
    gens = H[0]["gen"]
    best = np.array([h["best_fitness"] for h in H])
    mean = np.array([h["mean_fitness"] for h in H])
    for b in best:
        ax[0].plot(gens, b, color=CYAN, alpha=0.18, lw=1)
    ax[0].plot(gens, np.median(best, 0), color=CYAN, lw=2, label="best of generation (median of 5 runs)")
    ax[0].plot(gens, np.median(mean, 0), color=ORANGE, lw=2, label="population mean (median of 5 runs)")
    ax[0].axhline(0, color=MUTED, lw=0.8, ls=":")
    ax[0].set_xlabel("generation"); ax[0].set_ylabel("episode fitness")
    ax[0].set_title("Fitness convergence"); ax[0].legend(loc="lower right", fontsize=8.5)

    onpad = np.array([h["on_pad"] for h in H])
    for o in onpad:
        ax[1].plot(gens, smooth(o), color=GREEN, alpha=0.25, lw=1)
    ax[1].plot(gens, smooth(onpad.mean(0)), color=GREEN, lw=2.2, label="mean of 5 runs (7-gen moving average)")
    ax[1].set_xlabel("generation"); ax[1].set_ylabel("brains landing on the pad (of 40)")
    ax[1].set_title("On-pad landings per generation"); ax[1].legend(loc="upper left", fontsize=8.5)
    ax[1].set_ylim(0, 40)
    fig.tight_layout()
    fig.savefig(IMG / "learning_curves.png", dpi=170)
    plt.close(fig)


# ------------------------------------------------------------------ 2. trajectory funnel
def fig_funnel(champ, gen1):
    fig, ax = plt.subplots(1, 2, figsize=(11.5, 5.0), sharey=True)
    for a, data, color, title in ((ax[0], gen1, RED, "Generation 1 (best brain of a random population)"),
                                  (ax[1], champ, GREEN, "Trained champion (generation 150)")):
        for f in data["flights"]:
            a.plot(f["x"], f["y"], color=color, alpha=0.35, lw=1)
            a.plot(f["x"][-1], f["y"][-1], "o", color=color, ms=3, alpha=0.8)
        pad = data["padHalfWidth"]
        a.add_patch(plt.Rectangle((-pad, 0), 2 * pad, data["padHeight"], color=YELLOW, alpha=0.9, lw=0))
        a.axhline(0, color=MUTED, lw=1)
        landed = sum(f["reason"] == "LANDED" for f in data["flights"])
        a.set_title(f"{title}\n{landed} / {len(data['flights'])} landed on the pad", fontsize=10)
        a.set_xlabel("x [m]"); a.set_xlim(-80, 80); a.set_ylim(-5, 260)
    ax[0].set_ylabel("altitude [m]")
    fig.tight_layout()
    fig.savefig(IMG / "trajectory_funnel.png", dpi=170)
    plt.close(fig)


# ------------------------------------------------------------------ 3. one flight in detail
def fig_flight(champ, gen1):
    c, g = champ["flights"][0], gen1["flights"][0]
    fig, ax = plt.subplots(2, 2, figsize=(11.5, 7.0))
    ax = ax.ravel()
    ax[0].plot(g["t"], g["y"], color=RED, lw=1.6, label=f"Gen 1 brain → {g['reason'].lower()}")
    ax[0].plot(c["t"], c["y"], color=GREEN, lw=1.8, label="trained champion → landed")
    ax[0].axhline(champ["padHeight"], color=YELLOW, lw=1, ls="--", label="pad deck (3 m)")
    ax[0].set_title("Altitude"); ax[0].set_xlabel("t [s]"); ax[0].set_ylabel("y [m]"); ax[0].legend(fontsize=8.5)

    # phase portrait vs the full-thrust (suicide-burn) envelope
    a_brake = 28000 / 1350 - 9.81
    h = np.linspace(0, 240, 200)
    ax[1].plot(-np.sqrt(2 * a_brake * h), h, color=MUTED, ls="--", lw=1.2, label="full-thrust envelope (m = 1350 kg)")
    for f, col in ((g, RED), (c, GREEN)):
        ax[1].plot(f["vy"], np.array(f["y"]) - (champ["padHeight"] + champ["restHeight"]), color=col, lw=1.6)
    ax[1].set_xlim(-70, 5); ax[1].set_ylim(-5, 245)
    ax[1].set_title("Phase portrait"); ax[1].set_xlabel("vertical speed v_y [m/s]"); ax[1].set_ylabel("height above touchdown [m]")
    ax[1].legend(fontsize=8.5, loc="upper left")

    ax[2].plot(c["t"], c["throttle"], color=ORANGE, lw=1.0, alpha=0.55, label="throttle command (NN output)")
    ax[2].plot(c["t"], c["thrust"], color=ORANGE, lw=1.8, label="delivered thrust F / F_max (lagged)")
    ax[2].set_title("Main engine (champion)"); ax[2].set_xlabel("t [s]"); ax[2].set_ylim(-0.02, 1.05); ax[2].legend(fontsize=8.5)

    ax[3].plot(c["t"], np.degrees(c["theta"]), color=CYAN, lw=1.8, label="pitch θ [deg]")
    ax[3].plot(c["t"], np.degrees(c["gimbal"]), color=BLUE, lw=1.2, label="gimbal δ [deg]")
    ax[3].set_title("Attitude and thrust vector (champion)"); ax[3].set_xlabel("t [s]"); ax[3].legend(fontsize=8.5)
    fig.tight_layout()
    fig.savefig(IMG / "flight_detail.png", dpi=170)
    plt.close(fig)


# ------------------------------------------------------------------ 4. robustness
def fig_robustness():
    b = json.loads((DATA / "benchmark.json").read_text())
    groups = list(b["groups"].items())
    names = [c["name"] for c in groups[0][1]]
    y = np.arange(len(names))
    fig, ax = plt.subplots(figsize=(10.5, 4.9))
    cols = (CYAN, ORANGE)
    for gi, (gname, cases) in enumerate(groups):
        vals = [100 * c["meanSuccess"] for c in cases]
        off = (gi - 0.5) * 0.36
        ax.barh(y + off, vals, height=0.34, color=cols[gi], label=gname)
        for c, v, yy in zip(cases, vals, y + off):
            per = [100 * r["successRate"] for r in c["perRun"]]
            ax.plot(per, [yy] * len(per), "o", mfc=BG, mec="white", mew=0.8, ms=3.6, alpha=0.9, zorder=3)
            ax.text(103, yy, f"{v:.0f}%", va="center", fontsize=8.5, color=TEXT)
    ax.set_yticks(y); ax.set_yticklabels(names); ax.invert_yaxis()
    ax.set_xlim(0, 110); ax.set_xticks(range(0, 101, 20))
    ax.set_xlabel("successful on-pad landings out of 500 unseen scenarios [%]   (circles: individual training runs, bars: mean)")
    ax.set_title("Held-out evaluation: 5 independent training runs per group")
    ax.legend(loc="upper center", bbox_to_anchor=(0.45, -0.16), ncol=2, fontsize=9)
    fig.tight_layout()
    fig.savefig(IMG / "robustness.png", dpi=170)
    plt.close(fig)


if __name__ == "__main__":
    with tempfile.TemporaryDirectory() as t:
        tmp = Path(t)
        champ = export_flights(tmp, "champ", ["--genome", str(DATA / "seed1" / "champion.json")])
        gen1 = export_flights(tmp, "gen1", ["--untrained"])
    fig_learning()
    fig_funnel(champ, gen1)
    fig_flight(champ, gen1)
    fig_robustness()
    print("figures written to", IMG)

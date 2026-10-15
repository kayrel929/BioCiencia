"""
Genera los valores de referencia con SciPy/statsmodels para verificar el motor estadístico de BioCiencia.
Uso (solo para desarrolladores): python generar_referencias.py > referencias.json
Los datos «PlantGrowth» son el conjunto clásico de Dobson (1983) incluido en R; los demás son
números aleatorios con semilla fija, usados SOLO para verificar cálculos (no son datos de investigación).
"""
import json
import numpy as np
import pandas as pd
from scipy import stats
import statsmodels.api as sm
from statsmodels.formula.api import ols

out = {"scipy": __import__("scipy").__version__, "statsmodels": sm.__version__ if hasattr(sm, "__version__") else __import__("statsmodels").__version__}

ctrl = [4.17, 5.58, 5.18, 6.11, 4.50, 4.61, 5.17, 4.53, 5.33, 5.14]
trt1 = [4.81, 4.17, 4.41, 3.59, 5.87, 3.83, 6.03, 4.89, 4.32, 4.69]
trt2 = [6.31, 5.12, 5.54, 5.50, 5.37, 5.29, 4.92, 6.15, 5.80, 5.26]
y = ctrl + trt1 + trt2
g = ["ctrl"] * 10 + ["trt1"] * 10 + ["trt2"] * 10
df = pd.DataFrame({"y": y, "g": g})
a = sm.stats.anova_lm(ols("y ~ C(g)", df).fit(), typ=1)
tk = stats.tukey_hsd(ctrl, trt1, trt2)
resid = ols("y ~ C(g)", df).fit().resid
out["plantgrowth"] = {
    "y": y, "g": g,
    "anova": {"ss_trt": a["sum_sq"].iloc[0], "ss_err": a["sum_sq"].iloc[1], "f": a["F"].iloc[0], "p": a["PR(>F)"].iloc[0]},
    "tukey_p": {"ctrl-trt1": tk.pvalue[0][1], "ctrl-trt2": tk.pvalue[0][2], "trt1-trt2": tk.pvalue[1][2]},
    "levene": list(stats.levene(ctrl, trt1, trt2)),
    "shapiro_resid": list(stats.shapiro(resid)),
    "kruskal": list(stats.kruskal(ctrl, trt1, trt2)),
    "describe_ctrl": {"mean": float(np.mean(ctrl)), "sd": float(np.std(ctrl, ddof=1)), "q1": float(np.percentile(ctrl, 25)), "median": float(np.median(ctrl)), "q3": float(np.percentile(ctrl, 75)),
                       "ci95": list(stats.t.interval(0.95, 9, loc=np.mean(ctrl), scale=stats.sem(ctrl)))},
    "welch": list(stats.ttest_ind(ctrl, trt2, equal_var=False)),
    "student": list(stats.ttest_ind(ctrl, trt2, equal_var=True)),
    "paired": list(stats.ttest_rel(ctrl, trt2)),
}

rng = np.random.default_rng(2026)
# DBCA: 5 tratamientos x 4 bloques
trts = [f"T{i}" for i in range(1, 6)]
blks = [f"B{j}" for j in range(1, 5)]
rows = []
for i, t in enumerate(trts):
    for j, b in enumerate(blks):
        rows.append({"y": round(float(20 + 2 * i + 1.5 * j + rng.normal(0, 1.2)), 2), "t": t, "b": b})
d = pd.DataFrame(rows)
m = ols("y ~ C(t) + C(b)", d).fit()
a = sm.stats.anova_lm(m, typ=1)
out["rcbd"] = {"y": d.y.tolist(), "t": d.t.tolist(), "b": d.b.tolist(),
               "ss_t": a["sum_sq"].iloc[0], "ss_b": a["sum_sq"].iloc[1], "ss_e": a["sum_sq"].iloc[2],
               "f_t": a["F"].iloc[0], "p_t": a["PR(>F)"].iloc[0], "f_b": a["F"].iloc[1], "p_b": a["PR(>F)"].iloc[1], "mse": m.mse_resid}

# Factorial 3 x 2 con 3 repeticiones
rows = []
for i, A in enumerate(["A1", "A2", "A3"]):
    for j, B in enumerate(["B1", "B2"]):
        for r in range(3):
            rows.append({"y": round(float(10 + 3 * i + 2 * j + (1.5 if (i == 2 and j == 1) else 0) + rng.normal(0, 1)), 2), "a": A, "b": B})
d = pd.DataFrame(rows)
a = sm.stats.anova_lm(ols("y ~ C(a) * C(b)", d).fit(), typ=1)
out["factorial"] = {"y": d.y.tolist(), "a": d.a.tolist(), "b": d.b.tolist(),
                    "ss": a["sum_sq"].tolist()[:4], "f": a["F"].tolist()[:3], "p": a["PR(>F)"].tolist()[:3]}

x = [round(float(v), 2) for v in rng.uniform(0, 50, 15)]
yy = [round(2.5 + 0.8 * v + float(rng.normal(0, 4)), 2) for v in x]
lr = stats.linregress(x, yy)
out["relacion"] = {"x": x, "y": yy, "pearson": list(stats.pearsonr(x, yy)), "spearman": list(stats.spearmanr(x, yy)),
                   "slope": lr.slope, "intercept": lr.intercept, "r2": lr.rvalue ** 2, "p": lr.pvalue, "se_slope": lr.stderr, "se_intercept": lr.intercept_stderr}

tab = [[18, 7, 5], [9, 14, 12]]
c = stats.chi2_contingency(tab, correction=False)
out["chi2"] = {"table": tab, "chi2": c.statistic, "p": c.pvalue, "df": c.dof}

sw = {}
for n in (3, 5, 8, 11, 12, 30, 100):
    s = [round(float(v), 3) for v in rng.lognormal(0, 0.5, n)]
    sw[str(n)] = {"x": s, "w": stats.shapiro(s).statistic, "p": stats.shapiro(s).pvalue}
out["shapiro"] = sw
print(json.dumps(out, indent=1))

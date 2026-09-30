#!/usr/bin/env python3
"""Aggregate C1_STAGE lines from tools/bench-c1-readpath.sh.

Usage: python3 tools/c1-readpath-report.py <raw-log> [raw-log ...]

Prints per-map stage tables (min/median/p90 over reps), decomposition
cross-checks (reconstructed readAll/read_parse vs the production calls),
and per-stage least-squares slopes vs file bytes across maps (ms/KB).
"""

import re
import statistics
import sys
from collections import defaultdict

STAGES = [
    "disk",
    "host",
    "transfer",
    "env_parse",
    "b64",
    "concat",
    "ascii",
    "parse",
    "validate",
    "world",
    "passage",
    "prod_read",
    "prep_parse",
    "prep_validate",
    "prep_compile",
    "commit",
    "frame1",
    "frame2",
]

LINE = re.compile(r"C1_STAGE (\S+)")


def percentile(values, fraction):
    values = sorted(values)
    if not values:
        return float("nan")
    k = (len(values) - 1) * fraction
    lo = int(k)
    hi = min(lo + 1, len(values) - 1)
    return values[lo] + (values[hi] - values[lo]) * (k - lo)


def main(paths):
    # map -> stage -> list of per-rep values
    data = defaultdict(lambda: defaultdict(list))
    meta = {}
    for path in paths:
        with open(path, encoding="utf-8") as handle:
            for line in handle:
                if "C1_STAGE" not in line:
                    continue
                fields = dict(re.findall(r"(\w+)=([^\s]+)", line))
                name = fields["map"]
                meta[name] = (int(fields["bytes"]), int(fields["chunks"]))
                for stage in STAGES:
                    data[name][stage].append(float(fields[stage]))

    maps = sorted(meta, key=lambda m: meta[m][0])
    print("# Per-map stage stats (ms): min / median / p90 over reps")
    header = ["map", "bytes", "chunks"] + [
        f"{s}({stat})" for s in STAGES for stat in ("min", "med", "p90")
    ]
    print("\t".join(header))
    for name in maps:
        row = [name, str(meta[name][0]), str(meta[name][1])]
        for stage in STAGES:
            values = data[name][stage]
            row.append(f"{min(values):.3f}")
            row.append(f"{statistics.median(values):.3f}")
            row.append(f"{percentile(values, 0.9):.3f}")
        print("\t".join(row))

    print("\n# Decomposition cross-checks (median ms)")
    print("map\tbytes\treadAll_decomp\tprod_read\tread_parse_decomp\tprep_parse\tcompile_decomp\tprep_compile")
    for name in maps:
        med = {s: statistics.median(data[name][s]) for s in STAGES}
        read_all = med["transfer"] + med["env_parse"] + med["b64"] + med["concat"]
        read_parse = read_all + med["ascii"] + med["parse"]
        compile_d = med["validate"] + med["world"] + med["passage"]
        print(
            f"{name}\t{meta[name][0]}\t{read_all:.3f}\t{med['prod_read']:.3f}\t"
            f"{read_parse:.3f}\t{med['prep_parse']:.3f}\t{compile_d:.3f}\t{med['prep_compile']:.3f}"
        )

    print("\n# Per-stage slope vs bytes (ms/KB), least squares over map medians")
    xs = [meta[m][0] / 1024.0 for m in maps]
    for stage in STAGES:
        ys = [statistics.median(data[m][stage]) for m in maps]
        n = len(xs)
        mx = sum(xs) / n
        my = sum(ys) / n
        num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
        den = sum((x - mx) ** 2 for x in xs)
        slope = num / den if den else float("nan")
        print(f"{stage}\t{slope:.4f} ms/KB")


if __name__ == "__main__":
    main(sys.argv[1:])

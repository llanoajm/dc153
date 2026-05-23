"""Tiny MATPOWER `.m` file parser sufficient for the canonical
case30 / case_ACTIVSg200-shaped files we ship as reference networks.

Returns a dict of section_name → list[list[float]] for the bus/branch/gen/gencost
sections, plus the per-system MVA base. The parser is intentionally narrow —
it doesn't try to handle every MATPOWER edge case, just the structure used by
the standard case files in the MATPOWER repo.
"""
from __future__ import annotations

import re
from pathlib import Path


def _to_float(tok: str):
    try:
        return float(tok)
    except ValueError:
        return None


def _extract_matrix(text: str, name: str):
    pattern = rf"mpc\.{name}\s*=\s*\[(.*?)\];"
    m = re.search(pattern, text, re.DOTALL)
    if not m:
        return None
    rows = []
    for raw in m.group(1).strip().split(";"):
        raw = raw.split("%")[0].strip()
        if not raw:
            continue
        tokens = raw.split()
        nums = [_to_float(t) for t in tokens]
        nums = [n for n in nums if n is not None]
        if nums:
            rows.append(nums)
    return rows


def parse_matpower(path: str | Path) -> dict:
    text = Path(path).read_text()
    base_match = re.search(r"mpc\.baseMVA\s*=\s*([\d.eE+-]+)", text)
    base_mva = float(base_match.group(1)) if base_match else 100.0
    return {
        "baseMVA": base_mva,
        "bus": _extract_matrix(text, "bus") or [],
        "branch": _extract_matrix(text, "branch") or [],
        "gen": _extract_matrix(text, "gen") or [],
        "gencost": _extract_matrix(text, "gencost") or [],
    }


# MATPOWER bus type → label (1 PQ, 2 PV, 3 ref/slack, 4 isolated)
BUS_TYPE = {1: "PQ", 2: "PV", 3: "slack", 4: "isolated"}

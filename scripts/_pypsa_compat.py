"""Compatibility shims for running zap against PyPSA + pandas 3.0.

Pandas 3.0 enabled Copy-on-Write by default, which causes ``DataFrame.values``
and ``Series.values`` to hand out read-only ndarrays. Several spots in
``zap.importers.pypsa`` and ``zap.devices.injector`` mutate those arrays
in-place (``+=``, ``/=``), so importing a real PyPSA network blows up with
``ValueError: output array is read-only``.

Importing this module before importing ``zap`` patches ``.values`` to return
a writable copy when the underlying array is read-only. This is a script-local
workaround; we don't touch zap's source.
"""
from __future__ import annotations

import numpy as np
import pandas as pd


def _writable(arr):
    if isinstance(arr, np.ndarray) and not arr.flags.writeable:
        return arr.copy()
    return arr


_orig_df_values = pd.DataFrame.values.fget
_orig_series_values = pd.Series.values.fget


def _df_values(self):
    return _writable(_orig_df_values(self))


def _series_values(self):
    return _writable(_orig_series_values(self))


pd.DataFrame.values = property(_df_values)
pd.Series.values = property(_series_values)

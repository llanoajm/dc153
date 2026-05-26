## Item just worked
- [ ] 2. Fix `parse_generators` for string-typed bus columns in modern pandas (ROADMAP §Phase A.2)

## Notes for the next agent
The roadmap context for item 2 named `.replace(buses_to_index).values.astype(int)`
as the offending line. In practice on this environment (pandas 3.0.3 / pypsa
0.30.2), that pattern still works on string-dtype bus columns. The *real* bug
masked behind the test-suite shim in `zap/tests/conftest.py` /
`zap/tests/__init__.py` (and behind `scripts/_pypsa_compat.py` on the
grid-app side) was `dynamic_costs += rng.random(...)` mutating a read-only
ndarray returned by `.values` under Copy-on-Write. The fix addresses both:
the `.replace(...).values.astype(int)` pattern is replaced with the cleaner
`.map(...).to_numpy(dtype=int)` everywhere, and the offending `+=` becomes an
out-of-place rebind.

The `_pypsa_compat` shims in zap/tests and grid-app/scripts are still in place
— other parts of the import path (`Device.scale_costs`, `Device.scale_power`
mutating `capital_cost` / `p_nom_min` / `p_nom_max`) also touch read-only
arrays. Removing those shims is *not* in this item's scope.

STATUS: done
SUMMARY: parse_generators / parse_loads / get_source_sinks / parse_storage_units / parse_stores now use `.map(...).to_numpy(dtype=int)` and the dynamic_costs perturbation is rebound out-of-place so a read-only pandas 3.0 .values no longer crashes the importer; new pytest in zap covers the string-bus path.
ACCEPTANCE:
  - new regression pytest `zap/tests/test_pypsa_importer_string_buses.py` exercises parse_generators + siblings on a tiny PyPSA net with string bus names — fails on pre-fix main (read-only `.values` mutation in parse_generators), passes after the fix. PASS.
  - existing zap pytest suite: my changes do not regress anything — pre-existing failures (MOSEK, missing network fixtures, Generator name TypeError) were present on `origin/main` before this commit and are unchanged. PASS for the importer-impacting subset.
  - zap fix committed inside /home/agent/zap as 9fd9599 and pushed to origin/main. PASS.
  - `python scripts/smoke_dispatch.py data/networks/ieee-30` from /home/agent/grid-app still exits 0 on the CPU path (solver=HIGHS, 0.13s). PASS.

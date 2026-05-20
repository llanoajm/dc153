"""
Build the PyPSA western US grid dataset on Modal and store it in the zap-data volume.

Run detached (survives if your laptop dies):
    modal run --detach build_data.py

Check progress:
    modal app logs <app-id>          # from the URL printed at start
    modal volume ls zap-data pypsa   # once done

The workflow clones pypsa-usa, runs the Snakemake pipeline with HiGHS (free solver),
then converts the resulting .nc files to the CSV format zap expects.

Output in volume:  pypsa/western/load_medium/elec_s_100/
                   pypsa/western/load_medium/elec_s_100_ec/
"""
import modal

# Geospatial deps (cartopy, rasterio, geopandas) need native libs — use micromamba.
# micromamba handles geospatial native libs (GDAL, GEOS, PROJ) and their Python bindings.
# pip handles snakemake 7.x (not on conda-forge) and other pure-Python extras.
# Do NOT pin numpy/pandas/scipy in pip — conda already installed compatible versions
# and downgrading them would conflict with conda's geopandas/cartopy/rasterio.
image = (
    modal.Image.micromamba(python_version="3.11")
    .micromamba_install(
        # libstdcxx-ng pulls in a libstdc++ new enough for matplotlib's
        # _c_internal_utils.so, which needs CXXABI_1.3.15 (gcc 13+). The
        # debian-base libstdc++.so.6 in the image is older and gets resolved
        # first without this. Pinning >=13 forces a compatible runtime.
        "conda-forge::libstdcxx-ng>=13",
        "conda-forge::cartopy=0.23.0",
        "conda-forge::rasterio=1.3.8",
        "conda-forge::geopandas=1.0.1",
        "conda-forge::shapely=2.0.2",
        "conda-forge::gdal",
        "conda-forge::git",
        "conda-forge::highspy",
    )
    .apt_install("gcc", "g++", "build-essential", "unzip")
    # Ensure conda's libstdc++ wins over the system one (matters when
    # subprocesses like snakemake re-resolve dynamic libs). Modal's .env()
    # sets literals — no ${VAR} expansion — so just point at conda's lib dir.
    .env({"LD_LIBRARY_PATH": "/opt/conda/lib"})
    .pip_install(
        # snakemake 7.x is only on PyPI (conda-forge has 8.x)
        "snakemake==7.32.4",
        "pypsa==0.30.2",
        "atlite==0.3.0",
        "dill>=0.3.8",  # used by add_electricity.py (pickle alternative)
        "dask==2024.12.0",
        "distributed==2024.12.0",
        "duckdb==0.10.0",
        "geopy==2.4.0",
        "linopy==0.3.14",
        "netcdf4==1.6.4",
        "networkx==3.1",
        "openpyxl>=3.1.5",
        "plotly==5.17.0",
        "progressbar2==4.3.2",
        "pulp==2.7.0",
        # pandas>=2.3 requires xarray>=2024.10, which is too new for linopy
        # 0.3.14 (which uses the removed xarray.core.rolling). Pin to 2.2.x.
        "pandas>=2.2.0,<2.3.0",
        "pyarrow==16.1.0",
        "pycountry==22.3.5",
        "pyyaml>=6.0.2",
        "tsam>=2.3.6",
        "xarray==2024.9.0",
        "xlrd==2.0.1",
    )
)

data_vol = modal.Volume.from_name("zap-data", create_if_missing=True)

app = modal.App("zap-build-data", image=image)


@app.function(
    volumes={"/data": data_vol},
    timeout=24 * 60 * 60,
    cpu=8,
    memory=32768,
)
def build_data(clusters: int = 100, efs_case: str = "medium"):
    import os
    import shutil
    import subprocess
    from pathlib import Path

    import pypsa
    import yaml

    WORK = Path("/work")
    WORK.mkdir(exist_ok=True)
    PYPSA_USA = WORK / "pypsa-usa"
    OUT_BASE = Path("/data/pypsa/western") / f"load_{efs_case}"

    # ── Clone pypsa-usa ──────────────────────────────────────────────────────
    if PYPSA_USA.exists():
        print("pypsa-usa already cloned.")
    else:
        print("Cloning pypsa-usa...")
        subprocess.run(
            ["git", "clone", "--depth=1",
             "https://github.com/PyPSA/pypsa-usa.git", str(PYPSA_USA)],
            check=True,
        )
    WORKFLOW = PYPSA_USA / "workflow"

    # ── Patch pypsa-usa scripts ─────────────────────────────────────────────
    # (1) build_powerplants.py's merge_ads_data uses .apply(lambda x: re.sub(...))
    #     on string columns that can contain NaN floats, causing
    #     `TypeError: expected string or bytes-like object, got 'float'`.
    bp_path = WORKFLOW / "scripts" / "build_powerplants.py"
    bp_src = bp_path.read_text()
    for col in ("Name", "Long Name", "SubType"):
        needle = f'ads["{col}"] = ads["{col}"].apply('
        repl = f'ads["{col}"] = ads["{col}"].astype(str).apply('
        if needle in bp_src and repl not in bp_src:
            bp_src = bp_src.replace(needle, repl)
    bp_path.write_text(bp_src)
    print("Patched build_powerplants.py: astype(str) before .apply(re.sub) on ADS cols.")

    # (2) zenodo_downloader.py line 84 calls Path.mkdir(exist_ok=True) for
    #     `data/zenodo/<scenario>/` but the `data/zenodo/` parent doesn't
    #     exist yet, so it fails with FileNotFoundError. Add parents=True.
    zd_path = WORKFLOW / "scripts" / "zenodo_downloader.py"
    zd_src = zd_path.read_text()
    zd_needle = (
        '(self.download_dir / "zenodo" / scenario).mkdir(\n'
        '                exist_ok=True,\n'
        '            )'
    )
    zd_repl = (
        '(self.download_dir / "zenodo" / scenario).mkdir(\n'
        '                parents=True, exist_ok=True,\n'
        '            )'
    )
    if zd_needle in zd_src and zd_repl not in zd_src:
        zd_src = zd_src.replace(zd_needle, zd_repl)
        zd_path.write_text(zd_src)
        print("Patched zenodo_downloader.py: parents=True for scenario mkdir.")
    elif zd_repl in zd_src:
        print("zenodo_downloader.py already patched.")
    else:
        print("WARNING: zenodo_downloader.py mkdir pattern not found — upstream may have changed.")

    # ── Bootstrap config files ───────────────────────────────────────────────
    # pypsa-usa ships TEMPLATES in workflow/repo_data/config — including
    # config.default.yaml (the canonical defaults) and other files referenced
    # by the Snakefile (config.cluster.yaml, config.api.yaml, etc.). The
    # convention is: user copies config.default.yaml → config.yaml and edits.
    # Always sync everything, then build config.yaml from defaults.
    config_dst = WORKFLOW / "config"
    config_src = WORKFLOW / "repo_data" / "config"
    shutil.copytree(str(config_src), str(config_dst), dirs_exist_ok=True)
    print(f"Synced config templates: {sorted(p.name for p in config_dst.iterdir())}")

    # ── Build customized config (HiGHS, N nodes, medium EFS demand) ─────────
    # pypsa-usa's Snakefile loads config.cluster.yaml + config.common.yaml +
    # config.plotting.yaml + config.api.yaml + config.sector.yaml directly via
    # `configfile:` directives, and intentionally leaves `config.default.yaml`
    # commented out — the user is expected to pass it via `--configfile`.
    # That defaults file is the one containing `enable`, `electricity.*`,
    # `solving.*` etc. — referenced throughout the rules.
    default_cfg_path = config_dst / "config.default.yaml"
    if not default_cfg_path.exists():
        raise FileNotFoundError(
            f"Expected pypsa-usa template at {default_cfg_path}. "
            f"Got these files instead: "
            f"{sorted(p.name for p in config_dst.iterdir())}"
        )
    with open(default_cfg_path) as f:
        cfg = yaml.safe_load(f)

    run_name = f"zap_{efs_case}"
    cfg["run"]["name"] = run_name
    cfg["scenario"]["interconnect"] = ["western"]
    cfg["scenario"]["clusters"] = [clusters]
    cfg["scenario"]["planning_horizons"] = [2050]
    # renewable_snapshots default uses end_inclusive=true (Jan 1 → Dec 31 inclusive
    # → 8737 hours), but network snapshots are 8760 hours (Jan 1 → Jan 1 left-inclusive).
    # The 23-hour gap makes add_electricity.broadcast_investment_horizons_index
    # assert len(df.index) == len(sns) fail after merging profile to snapshots.
    # Removing the key triggers the fallback in get_renewable_snapshots which
    # uses the same start/end convention as snapshots (full 8760 hours).
    cfg.pop("renewable_snapshots", None)
    # pypsa-usa's future-climate Zenodo record IDs are all None upstream
    # (only solar_historical / wind_100m_historical have valid IDs). Force
    # the historical scenario so build_renewable_profiles uses available data.
    cfg["renewable_scenarios"] = ["historical"]
    cfg["electricity"]["demand"]["scenario"]["efs_case"] = efs_case
    cfg["electricity"]["extendable_carriers"]["Generator"] = list(
        set(cfg["electricity"]["extendable_carriers"].get("Generator", [])) | {"nuclear"}
    )
    cfg["solving"]["solver"]["name"] = "highs"
    cfg["solving"]["solver"]["options"] = "highs-default"

    custom_cfg = WORK / "zap_config.yaml"
    with open(custom_cfg, "w") as f:
        yaml.dump(cfg, f)
    print(f"Wrote {custom_cfg}: clusters={clusters}, efs_case={efs_case}, "
          f"solver=highs, interconnect=western "
          f"(top-level keys: {sorted(cfg)})")

    # ── Inject synthetic CAISO fuel-price data ──────────────────────────────
    # The `retrieve_caiso_data` rule hits oasis.caiso.com, which times out from
    # Modal containers. Pre-populate its output with a flat-$3.50/MMBtu CSV
    # for the WECC balancing authorities × 365 days; snakemake will then skip
    # the network-dependent rule. Schema must match what build_fuel_prices.py
    # expects (columns: day_of_year, Balancing Authority, PRC).
    caiso_out = WORKFLOW / "data" / "costs" / "caiso_ng_power_prices.csv"
    if not caiso_out.exists():
        caiso_out.parent.mkdir(parents=True, exist_ok=True)
        # build_fuel_prices.py:get_caiso_ng_power_prices pivots by BA, then
        # accesses df[caiso_name] for caiso_name ∈ {CISO, AZPS, BANCSMUD}.
        # Those three names must exist as source rows; other BAs ignored.
        caiso_source_bas = ["CISO", "AZPS", "BANCSMUD"]
        rows = ["day_of_year,Balancing Authority,PRC"]
        for d in range(1, 366):
            for ba in caiso_source_bas:
                rows.append(f"{d},{ba},3.50")
        caiso_out.write_text("\n".join(rows) + "\n")
        print(f"Injected synthetic {caiso_out.name} "
              f"({len(caiso_source_bas)} BAs × 365 days @ $3.50/MMBtu)")

    # ── Run Snakemake ────────────────────────────────────────────────────────
    # pypsa-usa names output: elec_s_c{clusters}_ec.nc  (note the _c prefix)
    # zap expects CSV at:     elec_s_{clusters}_ec/      (no _c)
    target = f"resources/{run_name}/western/elec_s_c{clusters}_ec.nc"
    cmd = [
        "snakemake", target,
        "--cores", "8",
        "--directory", str(WORKFLOW),
        "--snakefile", str(WORKFLOW / "Snakefile"),
        "--configfile", str(custom_cfg),
        "--rerun-incomplete",
    ]
    print("Running:", " ".join(cmd))
    result = subprocess.run(cmd, cwd=str(WORKFLOW))
    if result.returncode != 0:
        print(f"Snakemake exited {result.returncode} — logs in {WORKFLOW}/logs/")

    # ── Convert .nc → CSV folders ────────────────────────────────────────────
    resources = WORKFLOW / "resources" / run_name / "western"
    for ext, label in [("", ""), ("_ec", "_ec")]:
        nc = resources / f"elec_s_c{clusters}{ext}.nc"
        out = OUT_BASE / f"elec_s_{clusters}{label}"
        if not nc.exists():
            print(f"WARNING: {nc} not found — skipping")
            continue
        print(f"Exporting {nc.name} → {out}")
        out.mkdir(parents=True, exist_ok=True)
        pn = pypsa.Network(str(nc))
        pn.export_to_csv_folder(str(out))

    data_vol.commit()
    print("Done. Data committed to zap-data volume.")


@app.local_entrypoint()
def main(clusters: int = 100, efs_case: str = "medium"):
    # .spawn() survives local disconnect; .remote() gets canceled if laptop dies
    call = build_data.spawn(clusters, efs_case)
    print(f"Spawned build_data: {call.object_id}")
    print("Safe to close your laptop — job runs on Modal until complete.")

"""
Run zap planning experiments on Modal H100 GPUs.

Commands:
    modal run modal_run.py                              # smoke test (no data needed)
    modal run modal_run.py --config-name modal_gpu_v01  # planning experiment

Data:
    See build_data.py for building the PyPSA western grid dataset.
"""
import modal
from pathlib import Path

ZAP_ROOT = Path(__file__).parent

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("libsuitesparse-dev")
    .pip_install(
        "torch==2.2.2",
        index_url="https://download.pytorch.org/whl/cu121",
    )
    .pip_install(
        "numpy>=1.26.4,<2",
        "scipy>=1.12.0",
        "attrs>=24.2.0",
        "cvxpy==1.7.1",
        "ortools==9.11.4210",
        "pypsa==0.30.2",
        "h5py>=3.14.0",
        "wandb>=0.18.5",
        "pyyaml",
        "pandas",
        "scikit-sparse>=0.4.16",
        "matplotlib",
        "seaborn",
    )
    .add_local_dir(
        str(ZAP_ROOT),
        "/zap",
        ignore=["data", ".git", "__pycache__", "*.pyc", ".venv", "*.egg-info"],
        copy=True,
    )
    .run_commands("pip install -e /zap --no-deps")
)

data_vol = modal.Volume.from_name("zap-data", create_if_missing=True)

app = modal.App("zap", image=image)


@app.function(gpu="H100", timeout=120)
def smoke_test():
    """Verify H100 is reachable and zap loads on a toy network. No data needed."""
    import torch
    import zap

    gpu_name = torch.cuda.get_device_name(0) if torch.cuda.is_available() else "none"
    print(f"torch {torch.__version__} | CUDA: {torch.cuda.is_available()} | GPU: {gpu_name}")

    net, devices = zap.importers.load_test_network()
    devices = list(devices)
    [d.torchify(machine="cuda") for d in devices]
    t = torch.ones(2000, 2000, device="cuda") @ torch.ones(2000, 2000, device="cuda")
    print(f"Test network: {net.num_nodes} nodes | torchify OK | matmul {t.shape} OK")


@app.function(
    gpu="H100",
    volumes={"/zap/data": data_vol},
    timeout=6 * 60 * 60,
)
def run_experiment(config_name: str, config_num: int = 0):
    """Run a planning experiment. Results land in the zap-data volume."""
    import sys
    sys.path.insert(0, "/zap/experiments/plan")
    import runner

    config_path = f"/zap/experiments/plan/config/{config_name}.yaml"
    configs = runner.expand_config(runner.load_config(config_path))
    config = configs[config_num]

    print(f"Config: {config_name}[{config_num}] ({len(configs)} total variants)")
    runner.run_experiment(config)
    data_vol.commit()


@app.local_entrypoint()
def main(config_name: str = "", config_num: int = 0):
    if not config_name:
        smoke_test.remote()
    else:
        run_experiment.remote(config_name, config_num)

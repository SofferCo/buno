#!/usr/bin/env bash
# One-shot trainer for a fresh cloud GPU box (RunPod / Lambda / Vast / Higgsfield rental).
# Prereqs on the box: NVIDIA GPU >= 24 GB, git, python3.10+, a Hugging Face token with
# access to black-forest-labs/FLUX.1-dev (accept the licence on the model page first).
#   export HF_TOKEN=hf_...
#   bash train/run_cloud.sh /path/to/quigs-logo-model
set -euo pipefail
PROJ="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
WORK="${WORK:-$HOME/quigs-train}"
mkdir -p "$WORK" && cd "$WORK"

if [ ! -d ai-toolkit ]; then
  git clone https://github.com/ostris/ai-toolkit.git
  (cd ai-toolkit && git submodule update --init --recursive)
fi
cd ai-toolkit
python3 -m venv .venv 2>/dev/null || true
source .venv/bin/activate
pip install -q --upgrade pip
pip install -q torch torchvision --index-url https://download.pytorch.org/whl/cu124
pip install -q -r requirements.txt
pip install -q potracer scipy

# dataset -> train_data (train split) + holdout
rm -rf train_data holdout
python3 "$PROJ/scripts/prepare_training_data.py" --dataset "$PROJ/dataset" --out train_data --mirror
mkdir -p train && cp "$PROJ/train/flux_lora.yaml" train/

[ -n "${HF_TOKEN:-}" ] && huggingface-cli login --token "$HF_TOKEN" --add-to-git-credential >/dev/null 2>&1 || true
python3 run.py train/flux_lora.yaml

echo
echo "LoRA saved under: $WORK/ai-toolkit/output/quigs_logo_flux_lora/"
echo "Samples (every 250 steps) under: $WORK/ai-toolkit/output/quigs_logo_flux_lora/samples/"
echo "Next: python3 $PROJ/scripts/generate.py --lora output/quigs_logo_flux_lora/quigs_logo_flux_lora.safetensors --holdout"

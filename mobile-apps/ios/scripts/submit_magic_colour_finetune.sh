#!/bin/zsh
# Submit the Magic colour-normalized fine-tune as an HF GPU job (L4, ~1 h, ~$1).
# Steps: (1) upload the modified trainer + wrappers to the model repo under jobs/<prefix>/,
# (2) pin the resulting revision, (3) launch the plan wrapper on HF infra.
# usage: submit-finetune.sh [epochs=3] [lr=5e-5]
set -eu
EPOCHS=${1:-3}; LR=${2:-5e-5}
REPO=ahzs645/tcger-universal-arcface
PREFIX=jobs/visual-style-v2-colour
S=$(cd "$(dirname "$0")" && pwd)
for f in train_arcface_encoder.py run_universal_arcface_hf_job.py run_training_set_plan_hf_job.py; do
  hf upload "$REPO" "$S/$f" "$PREFIX/$f" --commit-message "jobs: colour-cast augmentation, query normalization, finetune mode ($f)" --format quiet
done
REV=$(hf models info "$REPO" --format json | python3 -c "import sys,json; print(json.load(sys.stdin)['sha'])")
VARIANT="visual-style-v2-colour-${REV:0:8}"
echo "model revision $REV -> artifact variant $VARIANT"
hf jobs uv run "$S/run_training_set_plan_hf_job.py" --flavor l4x1 --timeout 6h --secrets "HF_TOKEN=$(hf auth token)" \
  --name "tcger-magic-$VARIANT" --detach \
  --game magic \
  --plan-repo ahzs645/tcger-scanner-images --plan-revision 5f93713698454c612f29f0474d0b457c74513bbc \
  --plan-path training-plans/magic/visual-style-v2 \
  --source-library-repo ahzs645/tcger-scanner-images --source-library-revision 6f5f954cb7573e02cf1c801ee9396e76328e1fa8 \
  --source-library-path releases/magic/two-stage-v2-107fe33b \
  --model-repo "$REPO" --model-revision "$REV" \
  --runner-path "$PREFIX/run_universal_arcface_hf_job.py" --trainer-path "$PREFIX/train_arcface_encoder.py" \
  --artifact-variant "$VARIANT" --epochs "$EPOCHS" --batch 256 --lr "$LR" \
  --query-normalization grey-world-autocontrast \
  --finetune-from-hub-path exports/magic/full/visual-style-v2-5c27e506-r2/arcface-checkpoint.pt
echo "follow with: hf jobs logs --follow <job id>; export lands under exports/magic/full/$VARIANT/"

#!/usr/bin/env python3
"""Run the repaired pinned YOLOX training and validation loops on generated fixtures."""

import argparse
import json
import math
from pathlib import Path

from PIL import Image, ImageDraw

from train_yolox_pose import write_config, materialize_coco, download_verified
from launch_geometry_bakeoff import MMYOLO_BASE_URL, MMYOLO_BASE_SHA256
from yolox_validation_fix import repair_source

POLICY = {'kind':'fraction-of-long-side','fraction':.125,'rounding':'ceil','application':'each-side'}


def generate_fixture(root: Path):
    root.mkdir(parents=True)
    entries=[]
    for split in ('train','validation'):
        for i in range(4):
            record_id=f'{split}-{i}'
            image=Image.new('RGB',(160,120),(30+i*10,50,70))
            ImageDraw.Draw(image).rectangle((40,20,100,100),fill=(200,180,100+i*10))
            image.save(root/f'{record_id}.png')
            corners=[{'coordinateKnown':True,'visibility':'visible','point':{'x':x/160,'y':y/120}}
                     for x,y in ((40,20),(100,20),(100,100),(40,100))]
            known={'instanceId':'known','corners':corners}
            unknown={'instanceId':'unknown','corners':[],
                     'box':{'left':.25,'top':1/6,'right':.625,'bottom':5/6}}
            instances=[unknown] if i==0 else [known]
            if i==2:
                instances.append({'instanceId':'unknown-2','corners':[],
                                  'box':{'left':.7,'top':.2,'right':.9,'bottom':.6}})
                ImageDraw.Draw(image).rectangle((112,24,144,72),fill=(100,200,180))
                image.save(root/f'{record_id}.png')
            record={'source':{'kind':'real','path':f'{record_id}.png','width':160,'height':120},'instances':instances}
            (root/f'{record_id}.json').write_text(json.dumps(record))
            entries.append({'recordId':record_id,'split':split,'path':f'{record_id}.json'})
    (root/'manifest.json').write_text(json.dumps({'diagnosticFixture':True,'corpusHash':'fixture-only','records':entries}))


def run(root: Path, mmyolo_root: Path):
    # Patch before any framework import can cache the original head bytecode.
    repair=repair_source(mmyolo_root)
    from mmengine.config import Config
    from mmengine.runner import Runner
    from mmengine.dataset import pseudo_collate
    from mmyolo.utils import register_all_modules
    import torch

    torch.set_num_threads(4)
    root.mkdir(parents=True,exist_ok=True)
    register_all_modules()
    import dis
    from mmyolo.models.dense_heads.yolox_pose_head import YOLOXPoseHead
    assert any(i.opname in {"STORE_FAST", "STORE_DEREF"} and i.argval == "cfg"
               for i in dis.get_instructions(YOLOXPoseHead.predict_by_feat)), "unpatched loaded head"
    generate_fixture(root/'fixture')
    materialization=materialize_coco(root/'fixture',root/'coco',POLICY)
    config_path=write_config(mmyolo_root=mmyolo_root,dataset=root/'coco',output=root,
                            epochs=1,batch=16,workers=0,seed=20260904)
    cfg=Config.fromfile(config_path)
    for name in ('train_dataloader','val_dataloader','test_dataloader'):
        cfg[name].persistent_workers=False
    cfg.default_hooks.logger.interval=1
    checkpoint=root/'base.pth'
    download_verified(MMYOLO_BASE_URL,MMYOLO_BASE_SHA256,checkpoint)
    cfg.load_from=str(checkpoint)
    cfg.work_dir=str(root/'training')
    cfg.env_cfg.dist_cfg.backend='gloo'
    runner=Runner.from_cfg(cfg)
    runner.train()
    # A separate wholly unknown batch exercises the zero-visible-keypoint path.
    dataset=runner.train_dataloader.dataset
    counts=[]
    unknown_sample=None
    for i in range(len(dataset)):
        sample=dataset[i]
        instances=sample['data_samples'].gt_instances
        counts.append(len(instances))
        if not torch.as_tensor(instances.keypoints_visible).any():
            unknown_sample=sample
    assert sorted(counts)==[1,1,1,2], counts
    assert unknown_sample is not None
    losses=runner.model.train_step(pseudo_collate([unknown_sample]*2),runner.optim_wrapper)
    box_losses={key:float(value) for key,value in losses.items()}
    assert all(math.isfinite(value) for value in box_losses.values()), box_losses
    validation=runner.val()
    report={'diagnosticOnly':True,'sourceRepair':repair,'materialization':materialization,
            'retainedInstancesPerImage':counts,'boxOnlyBatchLosses':box_losses,
            'validation':validation,'learningRate':cfg.optim_wrapper.optimizer.lr,
            'validationBegin':cfg.train_cfg.val_begin,'validationInterval':cfg.train_cfg.val_interval,
            'batchAugments':cfg.model.data_preprocessor.batch_augments}
    (root/'runtime-validation.json').write_text(json.dumps(report,indent=2,sort_keys=True)+'\n')
    print('TCGER_RUNTIME_EVIDENCE='+json.dumps(report,sort_keys=True),flush=True)
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--mmyolo-root',type=Path,required=True)
    args=parser.parse_args()
    run(args.output,args.mmyolo_root)

#!/usr/bin/env python3
"""Paired, generated-fixture probe of YOLOX targets, decoder and corner gradients.

Both arms start from the same verified checkpoint. This diagnostic never reads
held-out benchmark labels or changes the frozen training configuration.
"""
import argparse
import copy
import json
from pathlib import Path

import numpy as np
import torch
from PIL import Image

from train_yolox_pose import materialize_coco, write_config, sha256_file
from validate_yolox_runtime import generate_fixture, POLICY
from yolox_validation_fix import repair_source
from yolox_corner_loss import NormalizedCornerLoss
from evaluate_geometry_candidate import as_numpy, yolox_array_pipeline, candidate_result, DECODER_CONFIG
from reference_geometry import process_candidates


def target_audit(runner, coco):
    annotations = {a['id']: a for a in json.loads((coco/'annotations/train.json').read_text())['annotations']}
    rows=[]
    for i in range(len(runner.train_dataloader.dataset)):
        sample=runner.train_dataloader.dataset[i]['data_samples']
        ids=np.asarray(sample.id).reshape(-1).tolist()
        instances=sample.gt_instances
        points=instances.keypoints
        if hasattr(points, 'keypoints'):
            points=points.keypoints
        points=as_numpy(points)
        visible=as_numpy(instances.keypoints_visible)
        scale=np.asarray(sample.scale_factor)
        expected=np.asarray([annotations[n]['keypoints'] for n in ids]).reshape(-1,4,3)
        np.testing.assert_allclose(points,expected[:,:,:2]*scale,atol=0.001)
        np.testing.assert_array_equal(visible>0,expected[:,:,2]>0)
        rows.append({'annotationIds':ids,'maxCoordinateError':float(np.abs(points-expected[:,:,:2]*scale).max()),
                     'points':points.tolist(),'visible':visible.tolist()})
    return rows


def run(args):
    if sha256_file(args.checkpoint)!=args.checkpoint_sha256:
        raise ValueError('checkpoint SHA-256 mismatch')
    repair=repair_source(args.mmyolo_root)
    from mmengine.config import Config
    from mmengine.runner import Runner
    from mmyolo.utils import register_all_modules
    from mmcv.transforms import Compose
    from mmdet.apis import inference_detector
    register_all_modules()
    torch.set_num_threads(4)
    args.output.mkdir(parents=True,exist_ok=False)
    generate_fixture(args.output/'fixture')
    materialize_coco(args.output/'fixture',args.output/'coco',POLICY)
    config_path=write_config(mmyolo_root=args.mmyolo_root,dataset=args.output/'coco',output=args.output,
                            epochs=args.steps,batch=4,workers=0,seed=20260906)
    base=Config.fromfile(config_path)
    base.load_from=str(args.checkpoint)
    base.param_scheduler=[]
    base.custom_hooks=[]
    base.default_hooks.checkpoint.interval=args.steps
    base.default_hooks.logger.interval=1
    base.train_cfg.val_begin=args.steps
    base.train_cfg.val_interval=args.steps
    for key in ('train_dataloader','val_dataloader','test_dataloader'):
        base[key].persistent_workers=False
    base.train_dataloader.sampler.shuffle=False
    report={'diagnosticOnly':True,'checkpointSha256':args.checkpoint_sha256,'stepsPerArm':args.steps,
            'fixtureOnly':True,'seed':20260906,'learningRate':0.004*4/256,
            'sourceRepair':repair,'arms':{}}
    for arm in ('oks','normalized_l1'):
        cfg=copy.deepcopy(base)
        cfg.work_dir=str(args.output/arm)
        runner=Runner.from_cfg(cfg)
        audit=target_audit(runner,args.output/'coco')
        head=runner.model.bbox_head
        # Test the actual pinned decode function with distinct known corners.
        grids=torch.tensor([[32.,64.],[64.,96.]])
        target=torch.tensor([[[[2.,4.],[40.,5.],[42.,60.],[3.,62.]],
                              [[20.,10.],[70.,15.],[80.,80.],[15.,85.]]]])
        stride=torch.tensor([8.,16.])
        offsets=((target-grids[None,:,None,:])/stride[None,:,None,None]).reshape(1,2,8)
        torch.testing.assert_close(head.decode_pose(grids,offsets,stride),target)
        if arm=='normalized_l1':
            head.loss_pose=NormalizedCornerLoss(loss_weight=30)
        device=next(head.parameters()).device
        analytic_target=torch.tensor([[[0.,0.],[200.,0.],[200.,300.],[0.,300.]]],device=device)
        analytic_output=analytic_target.clone()
        analytic_output[0,2]=torch.tensor([2.,2.],device=device)
        analytic_output.requires_grad_()
        analytic_loss=head.loss_pose(analytic_output,analytic_target,torch.ones(1,4,device=device),
                                    torch.tensor([[0.,0.,200.,300.]],device=device))
        analytic_gradient=torch.autograd.grad(analytic_loss.sum(),analytic_output)[0]
        analytic={'loss':float(analytic_loss.detach().mean()),
                  'gradient':analytic_gradient.detach().cpu().tolist()}
        observations=[]
        def observe(module, inputs, value):
            output,truth,weights,boxes=inputs
            grad=torch.autograd.grad(value.sum(),output,retain_graph=True)[0]
            valid=weights>0
            error=torch.linalg.vector_norm(output-truth,dim=-1)
            row={'loss':float(value.detach().mean()),'cornerMeanPixelError':[],
                 'zeroGradientFraction':[], 'visibleTargetCount':valid.sum(0).tolist()}
            for corner in range(4):
                mask=valid[:,corner]
                row['cornerMeanPixelError'].append(float(error[mask,corner].detach().mean()) if mask.any() else None)
                row['zeroGradientFraction'].append(float((grad[mask,corner].abs().sum(-1)==0).float().mean()) if mask.any() else None)
            if not observations:
                row['sampleTargets']=truth[:4].detach().cpu().tolist()
                row['samplePredictions']=output[:4].detach().cpu().tolist()
            observations.append(row)
        handle=head.loss_pose.register_forward_hook(observe)
        runner.train()
        handle.remove()
        runner.model.eval()
        runner.model.cfg=cfg
        predictions=[]
        for entry in json.loads((args.output/'coco/annotations/train.json').read_text())['images']:
            path=args.output/'coco/images/train'/entry['file_name']
            image=np.asarray(Image.open(path).convert('RGB'))[:,:,::-1].copy()
            result=inference_detector(runner.model,image,
                test_pipeline=Compose(yolox_array_pipeline(cfg.inference_pipeline))).pred_instances
            points=as_numpy(result.keypoints)
            scores=as_numpy(result.scores)
            vis=as_numpy(result.keypoint_scores)
            candidates=[candidate_result([(float(x)/entry['width'],float(y)/entry['height']) for x,y in quad],float(score),v.tolist())
                        for quad,score,v in zip(points,scores,vis)]
            accepted=process_candidates(candidates,DECODER_CONFIG,{'releaseVersion':1,'artifactSha256':args.checkpoint_sha256})
            predictions.append({'imageId':entry['id'],'rawDetections':len(points),'acceptedQuads':len(accepted),
                                'firstKeypoints':points[:2].tolist()})
        report['arms'][arm]={'analyticProbe':analytic,'targetAudit':audit,'decodeRoundtripPassed':True,'observations':observations,
                             'fixturePredictions':predictions}
        (args.output/'corner-learning-diagnostic.json').write_text(json.dumps(report,indent=2)+'\n')
        print('ARM_COMPLETE='+json.dumps({'arm':arm,'first':observations[0],'last':observations[-1],
                                          'acceptedQuads':sum(p['acceptedQuads'] for p in predictions)}),flush=True)
        del runner,head
        torch.cuda.empty_cache()
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mmyolo-root',type=Path,required=True)
    parser.add_argument('--checkpoint',type=Path,required=True)
    parser.add_argument('--checkpoint-sha256',required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--steps',type=int,default=80)
    run(parser.parse_args())

#!/usr/bin/env node
/* Use the editor's exact measurement implementation for offline coverage. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const G=require('./corner-editor/geometry.js');
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));

function audit(records){
  const cards=[],counts={upright:0,'sideways-clockwise':0,'sideways-counterclockwise':0,'upside-down':0,unknown:0,invalid:0};
  for(const r of records){
    r.instances.forEach((item,index)=>{
      const row={recordId:r.recordId,reference:r.reference||r.recordId,card:index+1,split:r.split||'evaluation',sourceKind:r.source.kind||'real',orientationKnown:item.orientationKnown===true};
      try{
        if(item.corners.some(c=>!c.coordinateKnown))throw Error('Not all four corner coordinates are known');
        Object.assign(row,G.measureQuad(item.corners.map(c=>[c.point.x,c.point.y]),r.source.width,r.source.height,row.orientationKnown));
        counts[row.rotationBin]++;
      }catch(error){row.error=error.message;counts.invalid++;}
      cards.push(row);
    });
  }
  return {schema:'tcger-angle-coverage/v1',frames:records.length,cardInstances:cards.length,counts,cards,
    convention:'Printed TL→TR edge in source pixels; 0° upright, positive clockwise, ±180° upside-down. Upright: |angle|<45°; sideways: 45°≤|angle|≤135°.',
    perspective:'Skew is the largest image corner-angle deviation from 90°. It is not a calibrated camera/card tilt angle.',
    futureImages:'Append new sessions with their saved corners; assign whole related groups to one split before training. Original test snapshots stay frozen.'};
}

if(require.main===module){
  const [mode,input,output]=process.argv.slice(2);
  if(!['--session-inputs','--release'].includes(mode)||!input||!output)throw Error('Usage: audit_quad_angles.cjs --session-inputs FILE|--release DIRECTORY OUTPUT.json');
  if(fs.existsSync(output))throw Error('Preserve existing angle snapshots; choose a fresh output');
  const source=mode==='--release'?path.join(input,'manifest.json'):input;
  const data=read(source);
  const records=mode==='--release'?data.records.map(e=>{const p=path.join(input,e.path);if(sha(p)!==e.sha256)throw Error('Record hash mismatch');return {...read(p),split:e.split};}):Array.isArray(data)?data:data.records;
  const result=audit(records);result.input={path:path.resolve(source),sha256:sha(source)};
  result.implementationSha256=sha(path.join(__dirname,'corner-editor/geometry.js'));
  fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({frames:result.frames,cardInstances:result.cardInstances,counts:result.counts}));
}
module.exports={audit};

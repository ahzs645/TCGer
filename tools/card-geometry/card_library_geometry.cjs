/* Shared editor measurements plus image-location and overlap coverage. */
'use strict';
const fs=require('node:fs');
const G=require('./corner-editor/geometry.js');
const area=q=>Math.abs(q.reduce((s,p,i)=>{const n=q[(i+1)%q.length];return s+p[0]*n[1]-n[0]*p[1];},0))/2;
function clip(subject,boundary){
  let out=subject;
  for(let i=0;i<boundary.length;i++){
    const a=boundary[i],b=boundary[(i+1)%boundary.length],side=p=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);
    const input=out;out=[];if(!input.length)break;
    let p=input.at(-1),pd=side(p);
    for(const q of input){const qd=side(q);
      if((qd>=0)!==(pd>=0)){const t=pd/(pd-qd);out.push([p[0]+t*(q[0]-p[0]),p[1]+t*(q[1]-p[1])]);}
      if(qd>=0)out.push(q);p=q;pd=qd;
    }
  }return out;
}
function measure(quad,width,height,known){
  const metrics=G.measureQuad(quad,width,height,known),surface=area(quad);
  const center=G.project(G.squareToQuad(quad),.5,.5);
  const inside=area(clip(quad,[[0,0],[1,0],[1,1],[0,1]]));
  const col=center[0]<0||center[0]>1?-1:Math.min(2,Math.floor(center[0]*3));
  const row=center[1]<0||center[1]>1?-1:Math.min(2,Math.floor(center[1]*3));
  const visible=inside/surface;
  const p=quad.map(([x,y])=>[x*width,y*height]);
  const pairs=[[0,1,3,2],[0,3,1,2]].map(([a,b,c,d])=>({
    vector:[p[b][0]-p[a][0]+p[d][0]-p[c][0],p[b][1]-p[a][1]+p[d][1]-p[c][1]],
    length:Math.hypot(p[b][0]-p[a][0],p[b][1]-p[a][1])+Math.hypot(p[d][0]-p[c][0],p[d][1]-p[c][1])}));
  const axis=pairs[0].length>=pairs[1].length?pairs[0].vector:pairs[1].vector;
  const borderAxisDegrees=(Math.atan2(axis[1],axis[0])*180/Math.PI+180)%180;
  return {...metrics,center,areaFraction:surface,insidePhotoFraction:Math.min(1,Math.max(0,visible)),
    borderAxisDegrees,borderAxis15:String(Math.min(165,Math.floor(borderAxisDegrees/15)*15)),
    location:row<0||col<0?'outside-center':['top','middle','bottom'][row]+'-'+['left','center','right'][col],
    sizeBin:surface<.02?'tiny':surface<.1?'small':surface<.35?'medium':'large',
    skewBin:metrics.skewDegrees<10?'mild':metrics.skewDegrees<25?'moderate':metrics.skewDegrees<45?'strong':'extreme',
    edgeBin:metrics.outsideCorners?'cut-off':Math.min(...quad.flatMap(([x,y])=>[x,1-x,y,1-y]))<.05?'near-edge':'interior',
    rotation15:metrics.printedRotationDegrees===null?'unknown':String(Math.min(345,Math.floor(((metrics.printedRotationDegrees+360)%360)/15)*15))};
}
function analyze(frames){
  const cards=[];
  for(const frame of frames){
    const current=frame.instances.map((item,i)=>{
      const row={...item,id:frame.id+':'+item.instanceId,photoId:frame.id,card:i+1,sourceKind:frame.sourceKind,
        collection:frame.collection,split:frame.split,scene:frame.scene,session:frame.session||'',valid:false,
        rotationBin:'unknown',location:'unknown',sizeBin:'unknown',skewBin:'unknown',edgeBin:'unknown',overlapCount:0,overlapWith:[]};
      if(!item.quad){row.error='No saved four-corner outline';return row;}
      try{Object.assign(row,measure(item.quad,frame.width,frame.height,item.orientationKnown===true),{valid:true});}
      catch(error){row.error=error.message;}
      return row;
    });
    for(let i=0;i<current.length;i++)for(let j=i+1;j<current.length;j++){
      const a=current[i],b=current[j];if(!a.valid||!b.valid)continue;
      const overlap=area(clip(a.quad,b.quad));
      if(overlap>Math.min(a.areaFraction,b.areaFraction)*.01){a.overlapWith.push(b.card);b.overlapWith.push(a.card);}
    }
    for(const row of current){row.overlapCount=row.overlapWith.length;row.overlapBin=!row.valid?'unknown':row.overlapCount?'overlapping':'separate';cards.push(row);}
    frame.cardCount=current.length;frame.measuredCards=current.filter(r=>r.valid).length;
    delete frame.instances;
  }
  return {frames,cards};
}
if(require.main===module){const [input,output]=process.argv.slice(2);fs.writeFileSync(output,JSON.stringify(analyze(JSON.parse(fs.readFileSync(input,'utf8')))));}
module.exports={area,clip,measure,analyze};

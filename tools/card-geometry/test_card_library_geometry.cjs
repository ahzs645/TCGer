const test=require('node:test'),assert=require('node:assert/strict');
const {measure,analyze}=require('./card_library_geometry.cjs');
test('pixel scaling, orientation uncertainty and phase are separate',()=>{
 const q=[[.2,.2],[.7,.3],[.65,.8],[.15,.7]],m=measure(q,1000,500,true);
 assert.ok(Math.abs(m.printedRotationDegrees-Math.atan2(50,500)*180/Math.PI)<1e-9);
 assert.equal(measure(q,1000,500,false).printedRotationDegrees,null);
 assert.equal(measure(q.slice(2).concat(q.slice(0,2)),1000,500,true).rotationBin,'upside-down');
 assert.equal(measure(q,1000,500,false).location,m.location);
 assert.ok(Math.abs(measure(q,1000,500,false).borderAxisDegrees-m.borderAxisDegrees)<1e-9);
 assert.ok(Math.abs(measure(q.slice(1).concat(q.slice(0,1)),1000,500,false).borderAxisDegrees-m.borderAxisDegrees)<1e-9);
});
test('outside-photo fraction is geometric and touching edges are not overlap',()=>{
 const q=[[-.2,.2],[.2,.2],[.2,.6],[-.2,.6]],m=measure(q,100,100,true);
 assert.ok(Math.abs(m.insidePhotoFraction-.5)<1e-9);assert.equal(m.edgeBin,'cut-off');
 const a=analyze([{id:'a',width:100,height:100,instances:[{instanceId:'a',quad:[[0,0],[.5,0],[.5,1],[0,1]]},{instanceId:'b',quad:[[.5,0],[1,0],[1,1],[.5,1]]}]}]);
 assert.deepEqual(a.cards.map(c=>c.overlapCount),[0,0]);
});
test('checks every overlapping card and leaves incomplete geometry unmeasured',()=>{
 const box=(a,b,c,d)=>[[a,b],[c,b],[c,d],[a,d]];
 const result=analyze([{id:'f',width:100,height:100,instances:[box(.1,.1,.9,.9),box(.2,.2,.3,.3),box(.4,.4,.5,.5),box(.6,.6,.7,.7),null].map((quad,i)=>({instanceId:String(i),quad}))}]);
 assert.deepEqual(result.cards.map(c=>c.overlapCount),[3,1,1,1,0]);assert.equal(result.cards[4].valid,false);
 assert.equal(result.frames[0].measuredCards,4);
});

const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs/promises');
const path=require('node:path');
const {chromium}=require('playwright');

test('suggestions stay separate until added and cannot follow navigation to another photo',async t=>{
  const quad=(x,y)=>[[x,y],[x+.3,y],[x+.3,y+.35],[x,y+.35]];
  const fixture={id:'one',key:'session/one',game:'pokemon',sceneSlice:'binder_page',width:600,height:800,
    imageUrl:'/photo.svg',quads:[quad(.05,.05),quad(.1,.1)],finalized:true,draftSource:null,
    metadata:[0,1].map(i=>({physicalCardId:`existing-${i}`,occlusionOrder:i?4:0,orientationKnown:true,
      side:'faceUp',cornerVisibility:Array(4).fill('visible')})),occlusionRelations:[{above:0,below:1}]};
  const second={...structuredClone(fixture),id:'two',key:'session/two'};
  const candidates=[fixture.quads[0],quad(.6,.05),quad(.6,.6)].map(q=>({quad:q,score:.95}));
  const writes=[],jobs=new Map(); let sequence=0,mode='complete',polls=0;
  const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://fixture');
    res.setHeader('Content-Type','application/json');
    if (req.method==='PUT') {
      let body=''; for await (const chunk of req) body+=chunk;
      writes.push(JSON.parse(body)); return res.end(JSON.stringify({ok:true}));
    }
    if (req.method==='POST') {
      const job={id:String(++sequence),sampleId:url.pathname.split('/').at(-1),status:'running',message:'Finding regions…'};
      jobs.set(job.id,job); return res.end(JSON.stringify(job));
    }
    if (url.pathname.startsWith('/api/outline-suggestions/jobs/')) {
      polls++; const job=jobs.get(url.pathname.split('/').at(-1));
      return res.end(JSON.stringify({...job,status:mode,message:mode==='error'?'Model unavailable':'Finding regions…',result:{candidates,seconds:1}}));
    }
    if (url.pathname==='/api/samples') return res.end(JSON.stringify({view:'suggestion-fixture',
      samples:[fixture,second].map(s=>({...s,cards:2})),progress:{minimum:20,finalizedInstances:4,ready:false}}));
    if (url.pathname.startsWith('/api/sample/')) return res.end(JSON.stringify(url.pathname.endsWith('/two')?second:fixture));
    if (url.pathname==='/photo.svg') {
      res.setHeader('Content-Type','image/svg+xml');
      return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="#333"/><rect x="30" y="40" width="180" height="280" fill="#693"/><rect x="360" y="40" width="180" height="280" fill="#369"/><rect x="360" y="480" width="180" height="280" fill="#963"/></svg>');
    }
    const name=url.pathname==='/'?'index.html':url.pathname.slice(1);
    if (!['index.html','editor.js','geometry.js','layers.js','editor.css'].includes(name)) return res.writeHead(404).end();
    res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');
    res.end(await fs.readFile(path.join(__dirname,name==='layers.js'?'../archive-labeler/layers.js':name)));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const browser=await chromium.launch({headless:true}); t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  const base=`http://127.0.0.1:${server.address().port}`;
  const ready=()=>page.waitForFunction(()=>state.sourcePixels&&!state.loading&&!state.saving);
  await page.goto(base); await ready();
  await page.locator('#suggest-outlines').click();
  await page.waitForFunction(()=>state.suggestions?.status==='complete');
  assert.equal(await page.locator('#suggestion-cards .suggestion-card').count(),3);
  assert.equal(await page.getByRole('button',{name:'Already Card 1',exact:true}).isDisabled(),true);
  assert.deepEqual(await page.evaluate(()=>state.sample.quads),fixture.quads);
  assert.equal(writes.length,0);
  await page.getByRole('button',{name:'Suggestion 2',exact:true}).click();
  assert.equal(await page.evaluate(()=>state.suggestions.highlight),1);
  await page.getByRole('button',{name:'Add draft',exact:true}).first().click();
  assert.equal(await page.locator('#cards button').count(),3);
  assert.equal(writes.length,0,'adding a proposal does not approve it');
  await page.locator('#add-suggestions').click();
  const added=await page.evaluate(()=>structuredClone(state.sample));
  assert.equal(added.quads.length,4,'bulk add suppresses already added proposals');
  assert.deepEqual(added.quads.slice(0,2),fixture.quads);
  assert.deepEqual(added.metadata.slice(0,2),fixture.metadata);
  assert.deepEqual(added.occlusionRelations,fixture.occlusionRelations);
  assert.equal(added.metadata[2].orientationKnown,false);
  assert.equal(added.metadata[2].side,'unknown');
  assert.equal(new Set(added.metadata.map(m=>m.occlusionOrder)).size,4);
  assert.equal(writes.length,0);
  await page.locator('#rotate-left').click();
  await page.locator('#save-visible').click(); await ready();
  assert.equal(writes.length,1); assert.equal(writes[0].finalize,true);
  assert.deepEqual(writes[0].quads.slice(0,2),fixture.quads);
  assert.deepEqual(writes[0].occlusionRelations,fixture.occlusionRelations);
  await page.locator('#next').click(); await ready();
  assert.equal(await page.locator('#suggestion-panel').isVisible(),false);
  // A model result for a previous photo must never populate the new photo.
  mode='running'; await page.locator('#suggest-outlines').click();
  const oldPolls=polls; await page.waitForFunction(()=>state.suggestions?.status==='running');
  await page.locator('#previous').click(); await ready(); mode='complete';
  await page.waitForTimeout(1200);
  assert.equal(await page.locator('#suggestion-panel').isVisible(),false);
  assert.deepEqual(await page.evaluate(()=>state.sample.quads),fixture.quads);
  assert.ok(polls<=oldPolls+1);
  // Failure is visible and retry remains available without any label mutation.
  mode='error'; await page.locator('#suggest-outlines').click();
  await page.waitForFunction(()=>state.suggestions?.status==='error');
  assert.match(await page.locator('#suggestion-status').textContent(),/Model unavailable/);
  assert.equal(await page.locator('#suggest-outlines').isDisabled(),false);
  assert.equal(writes.length,1);
  await page.locator('#close-suggestions').click();
  // Real pointer clicks in reverse perimeter order create a normal, unmirrored card.
  await page.locator('#add-card-top').click();
  await page.locator('#editor').scrollIntoViewIfNeeded();
  const clicked=[[.6,.55],[.6,.9],[.9,.9],[.9,.55]];
  for (const point of clicked) {
    const position=await page.evaluate(point=>{
      const r=editor.getBoundingClientRect(),[x,y]=toCanvas(point);
      return {x:r.left+x*r.width/editor.width,y:r.top+y*r.height/editor.height};
    },point);
    await page.mouse.click(position.x,position.y);
  }
  assert.equal(await page.locator('#cards button').count(),3);
  const actual=await page.evaluate(()=>state.sample.quads[2]);
  const expected=[clicked[0],clicked[3],clicked[2],clicked[1]];
  actual.forEach((p,i)=>p.forEach((v,j)=>assert.ok(Math.abs(v-expected[i][j])<1e-4,`${v} != ${expected[i][j]}`)));
  assert.equal(writes.length,1,'four-click addition waits for explicit save');
  // Focus loss while magnifying releases the invisible pointer and rolls back.
  const corner=await page.evaluate(()=>{
    const r=editor.getBoundingClientRect(),[x,y]=toCanvas(state.sample.quads[2][0]);
    return {x:r.left+x*r.width/editor.width,y:r.top+y*r.height/editor.height};
  });
  await page.mouse.move(corner.x,corner.y); await page.mouse.down();
  assert.equal(await page.locator('#editor').evaluate(el=>getComputedStyle(el).cursor),'none');
  await page.mouse.move(corner.x+10,corner.y+10);
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
  assert.equal(await page.locator('#editor').evaluate(el=>getComputedStyle(el).cursor),'crosshair');
  assert.equal(await page.locator('#floating-magnifier').isVisible(),false);
  assert.deepEqual(await page.evaluate(()=>state.sample.quads[2]),actual);
  await page.mouse.up();
  assert.deepEqual(errors,[]);
});

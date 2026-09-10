const {test} = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const {chromium} = require('playwright');

// Serve fixtures locally so these interactions cannot write real review labels.
test('corner drags preserve where the handle was grabbed', async t => {
  const fixture = {
    id:'drag-fixture', key:'drag-fixture', game:'pokemon', sceneSlice:'single_handheld',
    width:600, height:800, imageUrl:'/fixture.svg', finalized:false, draftSource:'detector',
    quads:[[[.1,.1],[.9,.1],[.9,.9],[.1,.9]]],
    metadata:[{physicalCardId:'fixture-card', occlusionOrder:0, orientationKnown:true,
      side:'faceUp', cornerVisibility:Array(4).fill('visible')}],
  };
  const writes = [];
  const second = {...structuredClone(fixture),id:'second-fixture',key:'session/frame-2.jpg',
    quads:[fixture.quads[0],fixture.quads[0],fixture.quads[0]],
    metadata:[0,1,2].map(i=>({...structuredClone(fixture.metadata[0]),physicalCardId:`second-card-${i}`,occlusionOrder:i}))};
  let catalogView='fixture-review';
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'PUT') {
      let body = '';
      for await (const chunk of req) body += chunk;
      writes.push(JSON.parse(body));
      res.setHeader('Content-Type','application/json');
      res.end(JSON.stringify({ok:true}));
    } else if (url.pathname.startsWith('/api/')) {
      res.setHeader('Content-Type','application/json');
      res.end(JSON.stringify(url.pathname === '/api/samples' ? {
        view:catalogView,
        samples:[{...fixture, cards:1},{...second,cards:second.quads.length}],
        progress:{minimum:1, finalizedInstances:0, ready:false},
      } : url.pathname.endsWith('/second-fixture') ? second : fixture));
    } else if (url.pathname === '/fixture.svg') {
      res.setHeader('Content-Type','image/svg+xml');
      res.end('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="white"/><rect x="60" y="80" width="480" height="640" fill="green"/></svg>');
    } else if (url.pathname === '/layers.js') {
      res.setHeader('Content-Type','text/javascript');
      res.end(await fs.readFile(path.join(__dirname,'../archive-labeler/layers.js')));
    } else {
      const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      if (!['index.html','editor.js','geometry.js','editor.css'].includes(name)) {
        res.writeHead(404).end(); return;
      }
      res.setHeader('Content-Type',name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html');
      res.end(await fs.readFile(path.join(__dirname,name)));
    }
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const browser = await chromium.launch({headless:true});
  t.after(()=>browser.close());

  for (const [width, density] of [[1440,1],[1440,2],[640,2]]) {
    await t.test(`${width}px at ${density}× density`, async () => {
      const page = await browser.newPage({viewport:{width,height:1000},deviceScaleFactor:density});
      const errors = [];
      page.on('pageerror',e=>errors.push(e.message));
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.waitForFunction(()=>state.sourcePixels);
      await page.locator('#editor').scrollIntoViewIfNeeded();
      const position = index => page.evaluate(index => {
        const r=editor.getBoundingClientRect(), [x,y]=toCanvas(state.sample.quads[0][index]);
        return {x:r.left+x*r.width/editor.width, y:r.top+y*r.height/editor.height};
      },index);
      const near = (actual,expected) => assert.ok(Math.abs(actual-expected)<.05, `${actual} != ${expected}`);
      // Space temporarily pans, even when the press starts on a corner.
      // Releasing it must return to normal corner editing without a mode click.
      await page.locator('#photo-zoom').fill('200');
      await page.locator('#editor').scrollIntoViewIfNeeded();
      const panCorner=await position(0);
      const initial=await page.evaluate(()=>({quads:structuredClone(state.sample.quads),view:{...state.view},scroll:scrollY}));
      await page.mouse.move(panCorner.x,panCorner.y);
      await page.keyboard.down('Space');
      assert.equal(await page.evaluate(()=>state.spacePan),true);
      assert.equal(await page.locator('#editor').evaluate(el=>getComputedStyle(el).cursor),'grab');
      await page.mouse.down(); await page.mouse.move(panCorner.x+25,panCorner.y+15);
      assert.equal(await page.locator('#editor').evaluate(el=>getComputedStyle(el).cursor),'grabbing');
      const panned=await page.evaluate(()=>({...state.view}));
      near(panned.tx-initial.view.tx,25); near(panned.ty-initial.view.ty,15);
      assert.deepEqual(await page.evaluate(()=>state.sample.quads),initial.quads);
      assert.equal(await page.evaluate(()=>scrollY),initial.scroll);
      assert.equal(await page.locator('#floating-magnifier').isVisible(),false);
      await page.keyboard.up('Space'); await page.mouse.up();
      assert.equal(await page.evaluate(()=>state.spacePan || !!state.panning || state.panMode),false);
      // Losing focus cannot leave Space/panning latched.
      await page.keyboard.down('Space'); await page.mouse.down();
      await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
      assert.equal(await page.evaluate(()=>state.spacePan || !!state.panning),false);
      await page.mouse.up(); await page.keyboard.up('Space');
      // Space still activates a focused form control normally.
      const checkbox=page.locator('#metadata input[type="checkbox"]');
      await checkbox.focus(); const checked=await checkbox.isChecked();
      await page.keyboard.press('Space');
      assert.equal(await checkbox.isChecked(),!checked);
      assert.equal(await page.evaluate(()=>state.spacePan),false);
      await page.keyboard.press('Space');
      await page.locator('#fit-photo').click();
      await page.locator('#editor').scrollIntoViewIfNeeded();
      for (let corner=0; corner<4; corner++) {
        const before = await position(corner);
        const original = await page.evaluate(()=>structuredClone(state.sample.quads));
        // Grab off-center but within the visible handle, then move one pixel.
        const grab = {x:before.x+6,y:before.y+3};
        await page.mouse.move(grab.x,grab.y); await page.mouse.down();
        assert.equal(await page.locator('#editor').evaluate(el=>getComputedStyle(el).cursor),'none');
        assert.deepEqual(await page.evaluate(()=>state.sample.quads),original);
        await page.mouse.move(grab.x,grab.y);
        assert.deepEqual(await page.evaluate(()=>state.sample.quads),original, 'stationary pointer must not move the corner');
        await page.mouse.move(grab.x+1,grab.y+2);
        const moved = await position(corner);
        near(moved.x-before.x,1); near(moved.y-before.y,2);
        const lens = await page.locator('#magnifier').boundingBox();
        near(lens.x+lens.width/2,moved.x); near(lens.y+lens.height/2,moved.y);
        await page.mouse.up();
        assert.equal(await page.locator('#floating-magnifier').isVisible(),false);
        const after = await page.evaluate(()=>state.sample.quads);
        for (let i=0;i<4;i++) if (i!==corner) assert.deepEqual(after[0][i],original[0][i]);
      }
      // Cancel restores both the outline and the corner's visibility label.
      const beforeCancel = await page.evaluate(()=>({quads:structuredClone(state.sample.quads),metadata:structuredClone(state.sample.metadata)}));
      const p=await position(0);
      await page.mouse.move(p.x+6,p.y+3); await page.mouse.down();
      await page.mouse.move(p.x-30,p.y-30);
      await page.locator('#editor').dispatchEvent('pointercancel',{pointerId:1});
      await page.mouse.up();
      assert.deepEqual(await page.evaluate(()=>({quads:state.sample.quads,metadata:state.sample.metadata})),beforeCancel);
      assert.equal(await page.locator('#floating-magnifier').isVisible(),false);
      assert.equal(await page.locator('body').evaluate(el=>el.classList.contains('corner-magnifying')),false);
      // An off-center grab beyond the editing margin still moves smoothly;
      // only the corner itself is constrained to the permitted area.
      await page.evaluate(()=>{
        state.sample.quads[0][0][0]=-MARGIN+.005;
        state.sample.quads[0][3][0]=-MARGIN+.005;
        draw();
      });
      const edge=await position(0), edgeGrab={x:edge.x-6,y:edge.y+3};
      await page.mouse.move(edgeGrab.x,edgeGrab.y); await page.mouse.down();
      await page.mouse.move(edgeGrab.x+1,edgeGrab.y+2);
      const edgeMoved=await position(0);
      near(edgeMoved.x-edge.x,1); near(edgeMoved.y-edge.y,2);
      await page.mouse.move(edgeGrab.x-10,edgeGrab.y);
      assert.equal(await page.evaluate(()=>state.sample.quads[0][0][0]),-.4);
      await page.mouse.move(edgeGrab.x,edgeGrab.y);
      near((await position(0)).x,edge.x);
      await page.mouse.up();
      assert.equal(writes.length,0,'detector draft changes must stay unsaved');
      assert.deepEqual(errors,[]);
      await page.close();
    });
  }
  await t.test('refresh restores photo/card, explicit links win, and views keep separate positions', async()=>{
    const context=await browser.newContext();
    const page=await context.newPage();
    const base=`http://127.0.0.1:${server.address().port}`;
    const ready=()=>page.waitForFunction(()=>state.sourcePixels&&!state.loading);
    await page.goto(base); await ready();
    await page.locator('#sample').selectOption('second-fixture');
    await page.waitForFunction(()=>state.sample.id==='second-fixture'&&!state.loading);
    await page.locator('#cards button').nth(2).click();
    assert.equal(new URL(page.url()).searchParams.get('photo'),'session/frame-2.jpg');
    assert.equal(new URL(page.url()).searchParams.get('card'),'C3');
    await page.reload(); await ready();
    assert.equal(await page.locator('#sample').inputValue(),'second-fixture');
    assert.equal(await page.locator('#cards button[aria-selected="true"]').textContent(),'Card 3');
    await page.goto(base); await ready();
    assert.equal(await page.locator('#sample').inputValue(),'second-fixture');
    assert.equal(await page.locator('#cards button[aria-selected="true"]').textContent(),'Card 3');
    // Stable physical ID survives a different card being removed externally.
    second.quads.splice(0,1); second.metadata.splice(0,1);
    await page.reload(); await ready();
    assert.equal(await page.locator('#cards button[aria-selected="true"]').textContent(),'Card 2');
    await page.goto(base+'/?photo=drag-fixture&card=C1'); await ready();
    assert.equal(await page.locator('#sample').inputValue(),'drag-fixture');
    await page.goto(base+'/?photo=session%2Fframe-2.jpg&card=C99'); await ready();
    assert.equal(await page.locator('#cards button[aria-selected="true"]').textContent(),'Card 2');
    catalogView='other-review';
    await page.goto(base); await ready();
    assert.equal(await page.locator('#sample').inputValue(),'drag-fixture');
    catalogView='fixture-review';
    await page.goto(base); await ready();
    assert.equal(await page.locator('#sample').inputValue(),'second-fixture');
    // Blocked local storage still leaves a usable refresh/bookmark URL.
    await page.addInitScript(()=>{Storage.prototype.setItem=()=>{throw Error('storage blocked')};});
    await page.goto(base+'/?photo=drag-fixture&card=C1'); await ready();
    await page.reload(); await ready();
    assert.equal(await page.locator('#sample').inputValue(),'drag-fixture');
    assert.equal(writes.length,0,'remembering position never saves or approves labels');
    await context.close();
  });
});

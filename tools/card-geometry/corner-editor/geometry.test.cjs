const {test} = require('node:test');
const assert = require('node:assert/strict');
const G = require('./geometry.js');

const square = [[0,0],[1,0],[1,1],[0,1]];
const near = (a,b) => assert.ok(Math.abs(a-b)<1e-9, `${a} != ${b}`);

test('angle measurement uses source pixels, preserves orientation uncertainty and never changes corners', () => {
  const q=[[.125,.125],[.375,.625],[.25,.875],[0,.375]],before=JSON.stringify(q);
  const known=G.measureQuad(q,200,100,true);
  near(known.printedRotationDegrees,45);
  near(known.cornerAnglesDegrees[0],90);
  near(known.skewDegrees,0);
  near(known.oppositeWidthRatio,1);
  assert.equal(known.rotationBin,'sideways-clockwise');
  assert.equal(G.measureQuad(q,200,100,false).printedRotationDegrees,null);
  assert.equal(G.measureQuad(q,200,100,false).rotationBin,'unknown');
  assert.equal(JSON.stringify(q),before);
  const upside=G.measureQuad(square.slice(2).concat(square.slice(0,2)),100,200,true);
  assert.equal(upside.rotationBin,'upside-down');
  assert.equal(G.measureQuad(square.slice(3).concat(square.slice(0,3)),100,200,true).rotationBin,'sideways-counterclockwise');
  assert.throws(()=>G.measureQuad([...square].reverse(),100,100,true));
  assert.throws(()=>G.measureQuad(square,0,100,true));
});

test('Tab and Shift+Tab wrap without creating an invalid active index', () => {
  assert.equal(G.cycleCard(8,9,1),0);
  assert.equal(G.cycleCard(0,9,-1),8);
  assert.equal(G.cycleCard(0,0,1),0);
  assert.equal(G.cycleCard(0,1,-1),0);
});

test('hidden card handles cannot intercept the active card', () => {
  const quads = [square, [[0.01,0],[2,0],[2,2],[0,2]]];
  assert.deepEqual(G.nearestActiveHandle(quads,0,[0.01,0],.1),[0,0]);
  assert.equal(G.nearestActiveHandle(quads,0,[2,2],.1),null);
  assert.deepEqual(G.nearestActiveHandle(quads,1,[2,2],.1),[1,2]);
  assert.equal(G.nearestActiveHandle([],0,[0,0],.1),null);
});

test('card selection hits interiors and nearby borders, without using bounding boxes', () => {
  const quads = [[[50,0],[100,50],[50,100],[0,50]], [[150,0],[250,0],[250,100],[150,100]]];
  assert.equal(G.cardAtPoint(quads,[50,50],1),0);
  assert.equal(G.cardAtPoint(quads,[254,50],0),1);
  assert.equal(G.cardAtPoint(quads,[259,50],0),null);
  assert.equal(G.cardAtPoint(quads,[2,2],1),null);
  assert.equal(G.cardAtPoint([[],...quads],[50,50],0),1);
});

test('repeated overlap clicks cycle through every intersecting card', () => {
  const quads = [0,20,40].map(x => [[x,0],[x+100,0],[x+100,100],[x,100]]);
  const original = JSON.stringify(quads);
  assert.equal(G.cardAtPoint(quads,[70,50],0),2);
  assert.equal(G.cardAtPoint(quads,[70,50],2),1);
  assert.equal(G.cardAtPoint(quads,[70,50],1),0);
  assert.equal(G.cardAtPoint(quads,[5,50],0),0);
  assert.equal(JSON.stringify(quads),original);
});

test('perspective projection maps all four ordered corners exactly', () => {
  const quad = [[.1,.2],[.8,.1],[1.1,.9],[-.1,1.2]];
  const h = G.squareToQuad(quad);
  square.forEach(([u,v],i) => G.project(h,u,v).forEach((c,j)=>near(c,quad[i][j])));
  // Midpoints remain on straight projective lines.
  const [x,y] = G.project(h,.5,0);
  near((x-quad[0][0])*(quad[1][1]-quad[0][1]),(y-quad[0][1])*(quad[1][0]-quad[0][0]));
});

test('crop uses image-edge mapping and bilinear pixel interpolation', () => {
  const source={width:2,height:2,data:Uint8ClampedArray.from([
    0,0,0,255,100,0,0,255, 0,100,0,255,100,100,0,255,
  ])};
  const quad = [[0,0],[.5,0],[.5,.5],[0,.5]];
  const out=G.rectify(source,quad,3,3);
  assert.deepEqual(Array.from(out.data.slice(16,20)),[50,50,0,255]);
  assert.deepEqual(Array.from(out.data.slice(-4)),[100,100,0,255]);
  assert.equal(out.outsideFraction,0);
});

test('outside capture stays transparent; no extrapolated pixels are invented', () => {
  const source={width:2,height:2,data:new Uint8ClampedArray(16).fill(255)};
  const quad=[[-.5,0],[.5,0],[.5,1],[-.5,1]];
  const original=JSON.stringify(quad);
  const out=G.rectify(source,quad,3,3);
  near(out.outsideFraction,1/3);
  assert.equal(out.data[3],0);
  assert.equal(out.data[7],255);
  assert.equal(JSON.stringify(quad),original);
});

test('invalid, non-finite and crossed quads fail closed', () => {
  for (const q of [[],[[0,0],[1,1],[1,0],[0,1]],[[0,0],[1,0],[2,0],[3,0]],[[NaN,0],...square.slice(1)]]) {
    assert.throws(()=>G.squareToQuad(q));
  }
});

test('label quads require TL, TR, BR, BL winding but allow cyclic rotations', () => {
  const ordered = [[0, 0], [1, 0], [1, 1], [0, 1]];
  for (let turn = 0; turn < 4; turn++) {
    const rotated = ordered.slice(turn).concat(ordered.slice(0, turn));
    assert.equal(G.labelQuadError(rotated), null);
  }
  assert.match(
    G.labelQuadError([[0, 1], [1, 1], [1, 0], [0, 0]]),
    /ordered TL, TR, BR, BL/
  );
  // Generic projective preview math still accepts either winding.
  assert.doesNotThrow(() => G.squareToQuad([[0, 1], [1, 1], [1, 0], [0, 0]]));
});

test('card presets retain their stated ratio and game-specific default', () => {
  near(G.PROFILES.standard.width/G.PROFILES.standard.height,63/88);
  near(G.PROFILES.small.width/G.PROFILES.small.height,59/86);
  near(G.PROFILES.pipeline.width/G.PROFILES.pipeline.height,720/1000);
  assert.equal(G.defaultProfile('pokemon'),'standard');
  assert.equal(G.defaultProfile('magic'),'standard');
  assert.equal(G.defaultProfile('yugioh'),'small');
});

test('four clicked corners accept either direction and crossing click order without mirroring', () => {
  const quad=[[.1,.2],[.7,.1],[.8,.9],[.05,.8]];
  const permutations=items=>items.length ? items.flatMap((p,i)=>permutations(items.filter((_,j)=>j!==i)).map(rest=>[p,...rest])) : [[]];
  for (const input of permutations(quad)) {
    const original=structuredClone(input), ordered=G.orderClickedCorners(input);
    assert.equal(G.labelQuadError(ordered),null);
    assert.deepEqual(ordered[0],input[0],'first printed corner stays first');
    assert.deepEqual(input,original,'do not rewrite unfinished click history');
    near(G.quadIoU(ordered,quad),1);
  }
  for (const input of [[[0,0],[1,0],[0,1],[.1,.1]],[[0,0],[1,0],[1,0],[0,1]],[[0,0],[1,0],[2,0],[3,0]]]) {
    assert.ok(G.labelQuadError(G.orderClickedCorners(input)),'invalid four-corner geometry stays blocked');
  }
});

test('suggestion duplicate matching respects actual polygon area and cyclic corner order', () => {
  near(G.quadIoU(square,square.slice(2).concat(square.slice(0,2))),1);
  near(G.quadIoU(square,[[.5,0],[1.5,0],[1.5,1],[.5,1]]),1/3);
  near(G.quadIoU(square,[[2,0],[3,0],[3,1],[2,1]]),0);
  near(G.quadIoU(square,[[.2,.2],[.8,.2],[.8,.8],[.2,.8]]),.36);
  near(G.quadIoU(square,square.slice().reverse()),1);
});

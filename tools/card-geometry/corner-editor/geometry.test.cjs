const {test} = require('node:test');
const assert = require('node:assert/strict');
const G = require('./geometry.js');

const square = [[0,0],[1,0],[1,1],[0,1]];
const near = (a,b) => assert.ok(Math.abs(a-b)<1e-9, `${a} != ${b}`);

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

test('card presets retain their stated ratio and game-specific default', () => {
  near(G.PROFILES.standard.width/G.PROFILES.standard.height,63/88);
  near(G.PROFILES.small.width/G.PROFILES.small.height,59/86);
  near(G.PROFILES.pipeline.width/G.PROFILES.pipeline.height,720/1000);
  assert.equal(G.defaultProfile('pokemon'),'standard');
  assert.equal(G.defaultProfile('magic'),'standard');
  assert.equal(G.defaultProfile('yugioh'),'small');
});

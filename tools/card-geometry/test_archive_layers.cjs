const {test} = require('node:test');
const assert = require('node:assert/strict');
const L = require('./archive-labeler/layers.js');
const G = require('./corner-editor/geometry.js');

test('partial order supports separated cards and transitive layers without renumbering', () => {
  const keys = ['4', '12', '20', '99'];
  let layers = L.setRelation([], 4, 12, keys);
  layers = L.setRelation(layers, 12, 20, keys);
  assert.deepEqual(L.above(layers, 20), [12, 4]);
  assert.deepEqual(L.above(layers, 99), [], 'unrelated card order stays unknown');
  assert.throws(() => L.setRelation(layers, 20, 4, keys), /cycle/);
  assert.equal(layers.length, 2, 'failed changes preserve the original graph');
  assert.throws(() => L.setRelation(layers, 12, 12, keys), /itself/);
  assert.throws(() => L.setRelation(layers, 500, 12, keys), /Restore/);
  assert.deepEqual(L.setRelation([{above:4,below:12}], 12, 4, keys), [{above:12,below:4}], 'an explicit pair can be reversed');
});

test('one move puts a card above all three targets and reflects on each target', () => {
  const keys=[0,1,2,3,4,5];
  const original=[{above:1,below:0},{above:2,below:1},{above:3,below:2},{above:4,below:5}];
  const before=JSON.stringify(original);
  const front=L.moveRelativeTo(original,0,[1,2,3],'above',keys);
  for (const other of [1,2,3]) {
    assert.ok(L.above(front,other).includes(0), `card ${other} must show card 0 above it`);
    assert.ok(!L.above(front,0).includes(other));
  }
  assert.deepEqual(front.filter(r=>r.above!==0 && r.below!==0),original.filter(r=>r.above!==0 && r.below!==0));
  assert.equal(L.above(front,4).includes(0),false,'unrelated card remains unordered relative to the selection');
  assert.equal(L.error(front,keys),null);
  assert.equal(JSON.stringify(original),before,'the input graph is unchanged');
  const back=L.moveRelativeTo(front,0,[1,2,3],'below',keys);
  for (const other of [1,2,3]) assert.ok(L.above(back,0).includes(other));
  assert.equal(L.error(back,keys),null);
});

test('batch moves resolve indirect conflicts at the selected card without changing other cards', () => {
  const original=[{above:1,below:2},{above:2,below:0},{above:3,below:0}];
  const front=L.moveRelativeTo(original,0,[1],'above',[0,1,2,3]);
  assert.ok(L.above(front,1).includes(0));
  assert.ok(L.above(front,2).includes(1),'existing order between other cards stays intact');
  assert.ok(L.above(front,0).includes(3),'compatible order to an unrelated card stays intact');
  assert.ok(!front.some(r=>r.above===2 && r.below===0),'the conflicting path is detached only at the selection');
  assert.equal(L.error(front,[0,1,2,3]),null);
  const back=L.moveRelativeTo(front,0,[2],'below',[0,1,2,3]);
  assert.ok(L.above(back,0).includes(2));
  assert.ok(L.above(back,2).includes(1));
  assert.equal(L.error(back,[0,1,2,3]),null);
});

test('covered pixels become transparent while full geometry and visible pixels are retained', () => {
  const source = {width:8, height:8, data:new Uint8ClampedArray(8*8*4).fill(190)};
  const card = [[0,0],[1,0],[1,1],[0,1]], cover = [[.6,0],[1,0],[1,1],[.6,1]];
  const before = JSON.stringify([card, cover]);
  const raw = G.rectify(source, card, 5, 5), clipped = G.rectify(source, card, 5, 5, [cover]);
  assert.equal(clipped.coveredFraction, .4);
  assert.equal(clipped.data[3], 255);
  assert.equal(clipped.data[4*4+3], 0);
  assert.deepEqual(clipped.data.slice(0,12), raw.data.slice(0,12));
  assert.equal(JSON.stringify([card,cover]), before);
  const separate = G.rectify(source, card, 5, 5, [[[1.1,0],[1.3,0],[1.3,1],[1.1,1]]]);
  assert.deepEqual(separate.data, raw.data, 'no intersection means no clipping');
  assert.equal(G.pointInQuad([.8,.5], cover), true);
  assert.equal(G.pointInQuad([.2,.5], cover), false);
  assert.deepEqual(G.rectify(source, card, 5, 5, [cover.slice().reverse()]).data, clipped.data);
});

test('preview modes distinguish covered pixels, top-card pixels, and the original photograph', () => {
  const source = {width:8, height:8, data:new Uint8ClampedArray(8*8*4).fill(180)};
  const card = [[0,0],[1,0],[1,1],[0,1]], right = [[.6,0],[1,0],[1,1],[.6,1]], left = [[0,0],[.4,0],[.4,1],[0,1]];
  const raw = G.rectify(source,card,5,5);
  const original = G.layerPreview(source,card,5,5,[right],[left],'original');
  assert.deepEqual(original.data,raw.data);
  const masked = G.layerPreview(source,card,5,5,[right],[left],'masked');
  assert.equal(masked.data[3],255);
  assert.equal(masked.data[19],0);
  const colored = G.layerPreview(source,card,5,5,[right],[left],'layers');
  assert.equal(colored.coveredFraction,.4);
  assert.equal(colored.onTopFraction,.4);
  assert.ok(colored.data[1]>colored.data[0], 'selected card on top is green');
  assert.ok(colored.data[16]>colored.data[17], 'covering card is pink');
  assert.deepEqual(colored.data.slice(8,12),raw.data.slice(8,12), 'unaffected center retains its original pixels');
  assert.equal(colored.data[19],255, 'the color view shows the covered region rather than inventing underlying art');
  const precedence = G.layerPreview(source,card,5,5,[right],[card],'layers');
  assert.equal(precedence.onTopFraction,.6, 'an upper card wins where upper and lower regions intersect');
  const reversed = G.layerPreview(source,card,5,5,[],[right],'masked');
  assert.equal(reversed.coveredFraction,0);
  assert.deepEqual(reversed.data,raw.data, 'a foreground card keeps its visible portion');
});

test('overlap suggestions handle crossed edges, containment, separated cards, and touching edges', () => {
  const h=[[0,.4],[1,.4],[1,.6],[0,.6]], v=[[.4,0],[.6,0],[.6,1],[.4,1]];
  assert.equal(G.quadsOverlap(h,v),true);
  assert.equal(G.quadsOverlap([[0,0],[1,0],[1,1],[0,1]],h),true);
  assert.equal(G.quadsOverlap(h,[[2,0],[3,0],[3,1],[2,1]]),false);
  assert.equal(G.quadsOverlap(h,[[0,.6],[1,.6],[1,.8],[0,.8]]),false);
});

test('combined masking uses the union of every covering card without double-counting', () => {
  const source = {width:8,height:8,data:new Uint8ClampedArray(8*8*4).fill(180)};
  const card = [[0,0],[1,0],[1,1],[0,1]];
  const left = [[0,0],[.3,0],[.3,1],[0,1]], right = [[.6,0],[1,0],[1,1],[.6,1]];
  const topRight = [[.5,0],[1,0],[1,.3],[.5,.3]];
  const result = G.layerPreview(source,card,5,5,[left,right,topRight],[],"masked");
  assert.equal(result.data[3],0, 'left covering card is masked');
  assert.equal(result.data[19],0, 'right covering card is masked at the same time');
  assert.equal(result.data[11],0, 'a third covering card adds its own area');
  assert.equal(result.data[(2*5+2)*4+3],255, 'the remaining center stays visible');
  assert.equal(result.coveredFraction,22/25, 'intersections of cover masks count once');
  assert.deepEqual(G.layerPreview(source,card,5,5,[topRight,right,left],[],"masked").data,result.data, 'masking is independent of comparison order');
});

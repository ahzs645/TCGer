import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateEvidence} from './evidence.mjs';
import {renderReport} from './parity.mjs';

test('UI evidence rejects changed source, another run, old timestamps, and altered XML', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tcger-ui-evidence-'));
  t.after(() => fs.rmSync(root, {recursive:true,force:true}));
  const file = path.join(root, 'ios.xml');
  const xml = '<testsuite><testcase name="[home.dashboard] smoke"/></testsuite>';
  fs.writeFileSync(file, xml);
  const identity = {fingerprint:'current',revision:'revision',runID:'run'};
  const now = Date.now();
  const evidence = {schemaVersion:1,platform:'ios',...identity,startedAt:new Date(now-1000).toISOString(),completedAt:new Date(now).toISOString(),xmlDigest:createHash('sha256').update(xml).digest('hex')};
  const write = value => fs.writeFileSync(file+'.evidence.json', JSON.stringify(value));
  assert.equal(validateEvidence(file,'ios',identity,now),'Unbound evidence');
  write(evidence);
  assert.equal(validateEvidence(file,'ios',identity,now),null);
  assert.equal(validateEvidence(file,'ios',{...identity,fingerprint:'new'},now),'Stale source');
  assert.equal(validateEvidence(file,'ios',{...identity,runID:'other'},now),'Different run');
  assert.equal(validateEvidence(file,'ios',identity,now+86401000),'Expired evidence');
  fs.appendFileSync(file,'modified');
  assert.equal(validateEvidence(file,'ios',identity,now),'Changed results');
});

test('passing unbound XML cannot produce Verified in a real report', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tcger-ui-report-'));
  t.after(() => fs.rmSync(root,{recursive:true,force:true}));
  const file = path.join(root,'ios.xml');
  fs.writeFileSync(file,'<testsuite><testcase name="[home.dashboard] smoke"/></testsuite>');
  const manifest = {platforms:['ios'],features:[{id:'home.dashboard',title:'Dashboard',policy:'parity',flow:'home.yaml',ios:{status:'implemented',sources:['test.swift']}}]};
  const report = renderReport(manifest,{results:{ios:file}});
  assert.match(report,/Unbound evidence/);
  assert.doesNotMatch(report,/\| Verified \|/);
});

import fs from "node:fs";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { root, main as check, loadContracts } from "./contracts.mjs";
import { fingerprint, parseAPIJUnit, parseXCTest, apiReport } from "./report.mjs";
import { requiredScope } from "../mobile-parity/verification-scope.mjs";

const registry = loadContracts();
const resultsDir = path.resolve(process.env.API_CONTRACT_RESULTS_DIR ?? path.join(root, "mobile-parity/results/api"));
fs.mkdirSync(resultsDir, { recursive: true });
const command = process.argv[2];
if (command === 'ios' && process.env.GITHUB_ACTIONS === 'true') throw new Error('iOS API tests run locally only; GitHub Actions execution is disabled.');
const runFingerprint = fingerprint(registry);
const revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const file = name => path.join(resultsDir, name);
const save = (target, results, successfulRun) => fs.writeFileSync(file(`${target}.json`), `${JSON.stringify({ fingerprint: runFingerprint, revision, successfulRun, results }, null, 2)}\n`);
const run = (binary, args, cwd = root) => spawnSync(binary, args, { cwd, stdio: "inherit", env: process.env }).status === 0;
const xmlResults = name => fs.existsSync(file(name)) ? parseAPIJUnit(fs.readFileSync(file(name), "utf8")) : {};

if (command === "report") {
  const evidence = Object.fromEntries([...Object.keys(registry.consumers), ...Object.keys(registry.providers)].filter(target => fs.existsSync(file(`${target}.json`))).map(target => [target, JSON.parse(fs.readFileSync(file(`${target}.json`), "utf8"))]));
  const scoped = process.argv.includes('--require-targets');
  const scope = requiredScope(process.argv, '--require-targets', [...Object.keys(registry.consumers), ...Object.keys(registry.providers)]);
  const report = apiReport(registry, evidence, runFingerprint, revision, scoped ? scope : undefined);
  fs.writeFileSync(file("REPORT.md"), report.markdown);
  fs.writeFileSync(file("summary.json"), `${JSON.stringify(report.rows, null, 2)}\n`);
  console.log(report.markdown);
  if (process.argv.includes("--require-pass") && !report.passed) process.exitCode = 1;
  if (scoped && !report.scopePassed) process.exitCode = 1;
} else {
  check("check");
  const targets = command === "js" ? ["web", "express"] : [command];
  for (const target of targets) fs.rmSync(file(`${target}.json`), { force: true });
  let success = false;
  if (command === "js") {
    fs.rmSync(file("js.xml"), { force: true });
    success = run("npm", ["exec", "--workspace=@tcg/convex-backend", "--", "vitest", "run", "--config", "../tools/api-contracts/vitest.config.mts", "--reporter=default", "--reporter=junit", "--outputFile", file("js.xml")]);
    const results = xmlResults("js.xml");
    for (const target of targets) save(target, results[target] ?? {}, success);
  } else if (command === "convex") {
    fs.rmSync(file("convex.xml"), { force: true });
    success = run("npm", ["exec", "--", "vitest", "run", "convex/serverApiContracts.test.ts", "--reporter=default", "--reporter=junit", "--outputFile", file("convex.xml")], path.join(root, "convex-backend"));
    save("convex", xmlResults("convex.xml").convex ?? {}, success);
  } else if (command === "android") {
    const output = path.join(root, "mobile-apps/android/app/build/test-results/testDebugUnitTest/TEST-com.ahmadjalil.tcger.data.remote.ServerAPIContractTest.xml");
    fs.rmSync(output, { force: true });
    success = run(path.join(root, "mobile-apps/android/gradlew"), ["-p", path.join(root, "mobile-apps/android"), "testDebugUnitTest", "--tests", "*ServerAPIContractTest", "--no-daemon", "--rerun-tasks"]);
    const results = fs.existsSync(output) ? parseAPIJUnit(fs.readFileSync(output, "utf8")).android : {};
    if (fs.existsSync(output)) fs.copyFileSync(output, file("android.xml"));
    save("android", results, success);
  } else if (command === "ios") {
    const bundle = file(`ios-${Date.now()}.xcresult`);
    const destination = process.env.API_CONTRACT_IOS_DESTINATION ?? `platform=iOS Simulator,name=${process.env.IOS_SIMULATOR ?? "iPhone 17 Pro"}`;
    const extraTests = (process.env.API_CONTRACT_IOS_EXTRA_TESTS ?? "").split(",").filter(Boolean);
    if (extraTests.some(name => !/^[A-Za-z][A-Za-z0-9]*$/.test(name))) throw new Error("Invalid extra XCTest class");
    const derivedData = process.env.API_CONTRACT_IOS_DERIVED_DATA;
    success = run("xcodebuild", [...(derivedData ? ["-derivedDataPath", derivedData] : []), ...extraTests.map(name => `-only-testing:TCGerTests/${name}`), "-project", "mobile-apps/ios/TCGer/TCGer.xcodeproj", "-scheme", "TCGer", "-destination", destination, "-only-testing:TCGerTests/ServerAPIContractTests", "-parallel-testing-enabled", "NO", "-resultBundlePath", bundle, "test"]);
    let results = {};
    if (fs.existsSync(bundle)) {
      try {
        const tree = JSON.parse(execFileSync("xcrun", ["xcresulttool", "get", "test-results", "tests", "--path", bundle], { encoding: "utf8" }));
        fs.writeFileSync(file("ios-tests.json"), `${JSON.stringify(tree, null, 2)}\n`);
        results = parseXCTest(tree, registry);
      } catch (error) { console.error(`Unable to read iOS execution evidence: ${error.message}`); success = false; }
    }
    save("ios", results, success);
  } else throw new Error("Usage: run.mjs js|convex|android|ios|report [--require-pass]");
  if (!success) process.exitCode = 1;
}

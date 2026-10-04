import { sourceRoots } from "./source-contract.mjs";

export function featureImpact(manifest, changedFiles) {
  const changed = new Set(changedFiles);
  const covered = new Set();
  const productDefinitionsChanged = changed.has("mobile-parity/features.definitions.json");
  const affected = manifest.features.flatMap((feature) => manifest.platforms.flatMap((platform) => {
    const state = feature[platform];
    const inputs = [...state.sources, ...(state.tests ?? []).flatMap((test) => test.path ? [test.path] : []), ...(feature.flow ? [`mobile-parity/${feature.flow}`] : [])];
    const paths = [...new Set(inputs.filter((file) => changed.has(file)))];
    paths.forEach((file) => covered.add(file));
    if (productDefinitionsChanged) paths.push("mobile-parity/features.definitions.json");
    return paths.length ? [{ id: feature.id, title: feature.title, platform, status: state.status, policy: feature.policy, paths }] : [];
  }));
  const unregisteredSources = [...changed].filter((file) => sourceRoots.some((root) => file.startsWith(`${root}/`)) && /\.(ts|tsx|swift|kt)$/.test(file) && !covered.has(file) && !/\/(generated|Generated)\//.test(file)).sort();
  return { affected, unregisteredSources };
}

export function renderFeatureImpact(impact) {
  const lines = ["# Feature impact", "", "Changes affect registered source/test paths as follows. This is a review aid, not behavioral verification.", "", "| Feature | Platform | Support | Policy | Changed paths |", "|---|---|---|---|---|"];
  for (const row of impact.affected) lines.push(`| ${row.id} | ${row.platform} | ${row.status} | ${row.policy} | ${row.paths.join(", ")} |`);
  if (!impact.affected.length) lines.push("", "No registered feature paths changed.");
  if (impact.unregisteredSources.length) lines.push("", "## Source changes requiring coverage review", "", "These files are not directly listed in any feature's source/test paths. They may be shared infrastructure or an unregistered capability; review rather than inferring coverage.", "", ...impact.unregisteredSources.map((file) => `- ${file}`));
  return `${lines.join("\n")}\n`;
}

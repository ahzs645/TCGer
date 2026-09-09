/* Explicit partial order of cards. Card numbers and geometry never change. */
(function (root) {
  "use strict";
  function above(relations, key) {
    const found = new Set(), pending = [Number(key)];
    while (pending.length) {
      const below = pending.pop();
      for (const relation of relations) {
        if (relation.below === below && !found.has(relation.above)) {
          found.add(relation.above); pending.push(relation.above);
        }
      }
    }
    return [...found];
  }
  function error(relations, keys) {
    const available = new Set(keys.map(Number)), seen = new Set();
    for (const r of relations) {
      if (!Number.isInteger(r.above) || !Number.isInteger(r.below) || !available.has(r.above) || !available.has(r.below)) return "Restore skipped cards before setting their layers.";
      if (r.above === r.below) return "A card cannot be above itself.";
      const key = `${r.above}:${r.below}`;
      if (seen.has(key)) return "This relationship is already set.";
      seen.add(key);
    }
    if (keys.some((key) => above(relations, key).includes(Number(key)))) return "These layers form a cycle. Remove a conflicting relationship first.";
    return null;
  }
  function setRelation(relations, upper, lower, keys) {
    const next = relations.filter((r) => !((r.above === upper && r.below === lower) || (r.above === lower && r.below === upper)));
    next.push({ above: upper, below: lower });
    const message = error(next, keys);
    if (message) throw Error(message);
    return next;
  }
  const api = { above, error, setRelation };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CardLabelLayers = api;
})(typeof window !== "undefined" ? window : {});

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
  function moveRelativeTo(relations, key, others, direction, keys) {
    if (!["above", "below"].includes(direction)) throw Error("Choose above or below.");
    const targets = [...new Set(others)].filter(other => other !== key);
    // Break conflicting paths at the selected card only. Relationships between
    // the other cards stay intact, including their existing stacking order.
    let next = relations.filter(r => direction === "above"
      ? !(r.below === key && targets.some(t => t === r.above || above(relations, r.above).includes(t)))
      : !(r.above === key && targets.some(t => t === r.below || above(relations, t).includes(r.below))));
    for (const other of targets) {
      const [upper, lower] = direction === "above" ? [key, other] : [other, key];
      if (!above(next, lower).includes(upper)) next = setRelation(next, upper, lower, keys);
    }
    const message = error(next, keys);
    if (message) throw Error(message);
    return next;
  }
  const api = { above, error, setRelation, moveRelativeTo };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CardLabelLayers = api;
})(typeof window !== "undefined" ? window : {});

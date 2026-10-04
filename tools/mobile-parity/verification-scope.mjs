// A scoped CI gate never replaces the full three-platform verification gate.
export function requiredScope(args, flag, allowed) {
  const index = args.indexOf(flag);
  if (index < 0) return [...allowed];
  const value = args[index + 1];
  const selected = value?.split(',').map(item => item.trim()) ?? [];
  if (!selected.length || selected.some(item => !allowed.includes(item)) || new Set(selected).size !== selected.length) {
    throw new Error(`${flag} requires a nonempty, unique subset of ${allowed.join(',')}`);
  }
  return selected;
}

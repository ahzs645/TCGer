export function hasEnabledGame(
  enabledGames: Readonly<Record<string, boolean>>,
): boolean {
  return Object.values(enabledGames).some(Boolean);
}

export function needsGameInstallation(
  enabledGames: Readonly<Record<string, boolean>>,
  installedPackageCount: number,
): boolean {
  return !hasEnabledGame(enabledGames) && installedPackageCount === 0;
}

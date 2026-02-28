export function getAppRoute(targetPath: string, currentPathname?: string | null): string {
  const normalizedTarget = targetPath.startsWith('/') ? targetPath : `/${targetPath}`;
  const pathname = currentPathname ?? '';
  const inDemo = pathname === '/demo' || pathname.startsWith('/demo/');

  if (!inDemo) {
    return normalizedTarget;
  }

  if (normalizedTarget === '/') {
    return '/demo/dashboard';
  }

  return normalizedTarget.startsWith('/demo/') ? normalizedTarget : `/demo${normalizedTarget}`;
}

export const appLinkRedirects = [
  { source: '/search', destination: '/cards', permanent: false },
  { source: '/binder/:id', destination: '/collections?binder=:id', permanent: false },
  { source: '/wishlist/:id', destination: '/wishlists?wishlist=:id', permanent: false },
];

export function appLinkFallback(raw) {
  try {
    const url = new URL(raw);
    if (url.username || url.password || (url.port && url.port !== '443')) return null;
    if (url.protocol !== 'tcger:' && !(url.protocol === 'https:' && url.hostname === 'tcger.ahmadjalil.com')) return null;
    const parts = [...(url.protocol === 'tcger:' ? [url.hostname] : []), ...url.pathname.split('/').filter(Boolean).map(decodeURIComponent)];
    const [route, id] = parts;
    if (parts.length > 2 || (id && !/^[A-Za-z0-9_.:-]+$/.test(id))) return null;
    if (route === 'search' && !id) {
      const query = url.searchParams.get('q')?.trim();
      return '/cards' + (query ? `?q=${encodeURIComponent(query)}` : '');
    }
    if (route === 'binder') return id ? `/collections?binder=${encodeURIComponent(id)}` : '/collections';
    if (route === 'wishlist') return id ? `/wishlists?wishlist=${encodeURIComponent(id)}` : '/wishlists';
    if (!id && ['scan', 'packs', 'collections', 'wishlists'].includes(route)) return `/${route}`;
    return null;
  } catch { return null; }
}

// Pages hosts a sample-data demo, so retain the destination through its entry screen.
export function demoAppLinkFallback(raw) {
  const destination = appLinkFallback(raw);
  return destination ? `/demo/?next=${encodeURIComponent(`/demo${destination}`)}` : null;
}

export function demoReturnTarget(raw) {
  const fallback = '/demo/dashboard';
  if (typeof raw !== 'string' || !raw.startsWith('/demo/') || raw.includes('\\')) return fallback;
  try {
    const url = new URL(raw, 'https://tcger.ahmadjalil.com');
    const routes = { cards: 'q', collections: 'binder', wishlists: 'wishlist', scan: null, packs: null };
    const route = url.pathname.slice('/demo/'.length).replace(/\/$/, '');
    if (url.origin !== 'https://tcger.ahmadjalil.com' || !Object.hasOwn(routes, route)) return fallback;
    const parameter = routes[route];
    const value = parameter ? url.searchParams.get(parameter)?.trim() : null;
    if (value && parameter !== 'q' && !/^[A-Za-z0-9_.:-]+$/.test(value)) return fallback;
    return `/demo/${route}` + (value ? `?${parameter}=${encodeURIComponent(value)}` : '');
  } catch { return fallback; }
}

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

/* Read-only status. The backup service owns the configurable destination. */
(() => {
  const links = document.querySelectorAll('[data-backup-status]');
  async function refresh() {
    try {
      const r = await fetch('http://127.0.0.1:8774/api/status', {signal: AbortSignal.timeout(5000)});
      if (!r.ok) throw Error('Service unavailable');
      const s = await r.json();
      const stale = !s.lastSuccess || Date.now() - Date.parse(s.lastSuccess) > 60000;
      const failure = s.error || s.fiftyoneError;
      for (const link of links) {
        link.textContent = failure ? 'Backup needs attention' : s.state === 'saved' && !stale ? 'Backups · copied' : 'Backups · pending';
        link.title = failure || `${s.folder || 'Choose a backup folder'}\nLast verified file check: ${s.lastSuccess ? new Date(s.lastSuccess).toLocaleString() : 'pending'}\nOpen for database export times. Drive upload completion is not measured.`;
        link.style.color = failure || stale ? '#d99339' : '';
      }
    } catch (_) {
      for (const link of links) { link.textContent = 'Backups · unavailable'; link.title = 'Automatic backup service is not reachable. Local studio saves still work.'; }
    }
  }
  refresh(); setInterval(refresh, 10000);
})();

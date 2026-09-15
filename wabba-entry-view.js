/** Local, immediately usable account link; the shared SDK progressively enhances it. */
export function mountWabbaEntry(loadLauncher, accountURL, { onResultRetry } = {}) {
  // accountURL is built from the validated deployment origin by wabba.js.
  if (!document.getElementById('wabba-entry-styles')) {
    const css = document.createElement('link');
    css.id = 'wabba-entry-styles'; css.rel = 'stylesheet';
    css.href = new URL('./wabba-entry.css?v=widget-20260915-5', import.meta.url).href;
    document.head.append(css);
  }
  let shell = document.getElementById('wabba-entry-shell');
  let entry = document.getElementById('wabba-local-entry');
  if (entry?.dataset.wabbaReady === 'true') return entry.wabbaController;
  if (!entry) {
    if (!shell) {
      shell = document.createElement('aside');
      shell.id = 'wabba-entry-shell'; shell.className = 'wabba-entry-shell';
      shell.setAttribute('aria-label', 'Wabba game connection');
      document.body.append(shell);
    }
    entry = document.createElement('a');
    entry.id = 'wabba-local-entry'; entry.className = 'wabba-local-entry';
    const logo = document.createElement('img');
    logo.src = new URL('./wabba-logo.png', import.meta.url).href;
    logo.alt = ''; logo.width = logo.height = 40;
    const text = document.createElement('span'); text.className = 'wabba-entry-text';
    const title = document.createElement('strong'); title.textContent = 'Connect to Wabba';
    const subtitle = document.createElement('small'); subtitle.textContent = 'Win games. Get gift cards.';
    text.append(title, subtitle);
    const arrow = document.createElement('span'); arrow.className = 'wabba-entry-arrow';
    arrow.setAttribute('aria-hidden', 'true'); arrow.textContent = '→';
    entry.append(logo, text, arrow);
    shell.append(entry);
  }
  entry.href = accountURL;
  entry.target = '_blank'; entry.rel = 'noopener noreferrer';
  entry.setAttribute('aria-label', 'Connect to Wabba. Opens in a new tab.');
  entry.dataset.wabbaReady = 'true';
  let launcher;
  let destroyed = false;
  let resultState = { status: 'idle', message: '' };
  const resultMessage = document.createElement('p');
  resultMessage.className = 'wabba-entry-result'; resultMessage.hidden = true;
  resultMessage.setAttribute('role', 'status'); resultMessage.setAttribute('aria-live', 'polite'); resultMessage.setAttribute('aria-atomic', 'true');
  const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'wabba-entry-retry';
  retry.textContent = 'Check result again'; retry.hidden = true;
  retry.addEventListener('click', () => { void onResultRetry?.(); });
  shell.append(resultMessage, retry);
  const context = { playing: false, connected: false, ready: true };
  const controller = {
    setResultState(update) {
      resultState = update;
      if (launcher) { launcher.setResultState?.(update); return; }
      resultMessage.hidden = !update.message;
      if (resultMessage.textContent !== update.message) resultMessage.textContent = update.message;
      retry.hidden = !onResultRetry || !['pending', 'unavailable'].includes(update.status);
    },
    setContext(update = {}) {
      for (const key of ['playing', 'connected', 'ready']) if (typeof update[key] === 'boolean') context[key] = update[key];
      if (launcher) launcher.setContext(context);
    },
    destroy() {
      destroyed = true;
      launcher?.destroy();
      shell.remove();
    },
  };
  entry.wabbaController = controller;
  // No click handler: the native link works during loading and after failures.
  // The loader resolves only once a usable shared launcher exists.
  void (async () => {
    let ready;
    try {
      ready = await loadLauncher();
      if (!ready || !['setContext', 'destroy'].every(name => typeof ready[name] === 'function')) {
        throw new Error('The launcher API is unavailable.');
      }
      if (destroyed) { ready.destroy(); return; }
      // Preserve game context while handing off to the persistent shared card.
      ready.setContext(context);
      ready.setResultState?.(resultState);
      launcher = ready;
      (shell || entry).remove();
    } catch {
      try { ready?.destroy?.(); } catch { /* Keep the fallback independent of SDK failures. */ }
      // Keep the account link usable if the optional SDK cannot load or mount.
    }
  })();
  return controller;
}

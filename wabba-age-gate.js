/** Local-only age gate. No Wabba asset/API requests occur before adult selection. */
export function mountWabbaEntry(onAdult) {
  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = new URL('./wabba-entry.css', import.meta.url).href;
  document.head.append(css);
  const entry = document.createElement('button');
  entry.type = 'button'; entry.className = 'wabba-local-entry';
  const logo = document.createElement('img');
  logo.src = new URL('./wabba-logo.png', import.meta.url).href;
  logo.alt = ''; logo.width = logo.height = 40;
  const text = document.createElement('span'); text.textContent = 'Play with Wabba';
  entry.append(logo, text);
  const dialog = document.createElement('dialog'); dialog.className = 'wabba-age-dialog';
  dialog.setAttribute('aria-labelledby', 'wabba-age-heading');
  const heading = document.createElement('h2'); heading.id = 'wabba-age-heading'; heading.textContent = 'Your age group';
  const label = document.createElement('label'); label.textContent = 'Select your age group to continue.';
  const select = document.createElement('select');
  for (const [value, title] of [['', 'Choose an age group'], ['under13', 'Under 13'], ['teen', '13–17'], ['adult', '18 or older']]) {
    const option = document.createElement('option'); option.value = value; option.textContent = title; select.append(option);
  }
  label.append(select);
  const status = document.createElement('p'); status.setAttribute('role', 'status');
  const next = document.createElement('button'); next.type = 'button'; next.textContent = 'Continue';
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => dialog.close());
  entry.addEventListener('click', () => dialog.showModal());
  next.addEventListener('click', async () => {
    if (!select.value) { status.textContent = 'Please select an age group.'; return; }
    if (select.value !== 'adult') { status.textContent = 'Wabba connections are currently available to adults only.'; return; }
    next.disabled = true; status.textContent = 'Loading Wabba…';
    try { await onAdult(); dialog.close(); entry.remove(); dialog.remove(); }
    catch { status.textContent = 'Wabba could not load. Please try again.'; }
    finally { next.disabled = false; }
  });
  dialog.append(heading, label, status, next, cancel);
  document.body.append(entry, dialog);
}

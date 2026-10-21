// View-only disclosure, sheet sizing and keyboard affordances. No domain state or requests.
const view = document.getElementById('view');
const sizes = { recommendations: 'medium', detail: 'medium' };
let preferencesOpen = false;
let sessionFocus = null;
let previousStage = null;
let examplesOpen = false;
let homeShortcuts = null;
const mobileLayout = matchMedia('(max-width: 767px)');
mobileLayout.addEventListener('change', decorate);

document.addEventListener('focusin', (event) => {
  const target = event.target;
  sessionFocus = target.closest('#d-activity')
    ? target.id ? `#${target.id}` : target.dataset.act ? `[data-act="${target.dataset.act}"]` : null
    : null;
});

document.addEventListener('click', (event) => {
  if (event.target.closest('.skip-link')) { event.preventDefault(); view.focus(); return; }
  if (event.target.closest('[data-close]')) view.querySelector('#d-map')?.focus({ preventScroll: true });
  const control = event.target.closest('[data-sheet-size], [data-detail-size]');
  if (!control) return;
  const detail = control.hasAttribute('data-detail-size');
  sizes[detail ? 'detail' : 'recommendations'] = detail ? control.dataset.detailSize : control.dataset.sheetSize;
  decorate();
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  const tools = document.querySelector('.demo-tools[open]');
  if (tools) { tools.open = false; tools.querySelector('summary').focus(); }
  if (event.target.closest('.recommendation-sheet')) {
    sizes.recommendations = 'medium'; decorate();
    view.querySelector('[data-sheet-size="medium"]')?.focus();
  }
});

function setSize(panel, value, attribute) {
  if (!panel) return;
  if (panel.dataset.sheet !== value) panel.dataset.sheet = value;
  panel.querySelectorAll(`[${attribute}]`).forEach((button) => {
    const pressed = String(button.getAttribute(attribute) === value);
    if (button.getAttribute('aria-pressed') !== pressed) button.setAttribute('aria-pressed', pressed);
    if (button.getAttribute(attribute) === 'expanded') {
      button.setAttribute('aria-expanded', String(value === 'expanded'));
      button.setAttribute('aria-controls', attribute === 'data-sheet-size' ? 'd-results' : 'd-detail');
    }
  });
}

function decorate() {
  const suggestions = view.querySelector('.chat-suggest');
  if (suggestions && !suggestions.closest('.prompt-examples')) {
    const examples = document.createElement('details');
    examples.className = 'prompt-examples';
    const label = document.createElement('summary');
    label.textContent = 'Try an example';
    suggestions.before(examples); examples.append(label, suggestions);
    examples.open = mobileLayout.matches ? examplesOpen : true;
    examples.addEventListener('toggle', () => { if (mobileLayout.matches) examplesOpen = examples.open; });
  }
  const home = view.querySelector('.tab-home');
  const homeBody = home?.querySelector('#d-home-body');
  const shortcuts = home?.querySelector('.quick') || (home ? homeShortcuts : null);
  homeShortcuts = shortcuts;
  const pick = homeBody?.querySelector('.home-pick');
  if (pick && shortcuts) {
    if (mobileLayout.matches && shortcuts.parentElement !== homeBody) pick.after(shortcuts);
    if (!mobileLayout.matches && shortcuts.parentElement === homeBody) home.insertBefore(shortcuts, homeBody);
  }
  setSize(view.querySelector('.recommendation-sheet'), sizes.recommendations, 'data-sheet-size');
  setSize(view.querySelector('#d-detail'), sizes.detail, 'data-detail-size');
  const preferences = view.querySelector('[data-preferences]');
  if (preferences && !preferences.dataset.bound) {
    preferences.dataset.bound = 'true'; preferences.open = preferencesOpen;
    preferences.addEventListener('toggle', () => { preferencesOpen = preferences.open; });
  }
  const summary = preferences?.querySelector('.preference-summary');
  if (summary) {
    const car = view.querySelector('#d-car')?.selectedOptions[0]?.textContent;
    const battery = view.querySelector('#d-batt-out')?.textContent;
    const from = view.querySelector('#d-from')?.value;
    const to = view.querySelector('#d-to')?.value;
    const stay = view.querySelector('#d-arrive-wrap')?.hidden
      ? view.querySelector('[name="d-park"]:checked')?.parentElement.textContent
      : `arrive with ${view.querySelector('#d-arrive-out')?.textContent}`;
    const text = `${car} · ${battery} · ${from} → ${to} · ${stay}`;
    if (summary.textContent !== text) summary.textContent = text;
  }
  const stage = view.querySelector('.journey [aria-current="step"]')?.textContent || null;
  if (stage && stage !== previousStage) {
    const heading = view.querySelector('#d-activity h2');
    if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
  }
  previousStage = stage;
  // Scroll containers expose a keyboard entry point and a contextual name.
  view.querySelectorAll('.tbl').forEach((table) => {
    if (table.hasAttribute('tabindex')) return;
    table.tabIndex = 0; table.setAttribute('role', 'region');
    table.setAttribute('aria-label', `${table.closest('section, details, .card')?.querySelector('h3,h4,summary')?.textContent || 'Data'} table, scroll to see all columns`);
  });
  view.querySelectorAll('th').forEach((th) => {
    if (!th.hasAttribute('scope')) th.scope = 'col';
    if (!th.textContent.trim()) th.setAttribute('aria-label', 'Actions');
  });
  // The simulated timer replaces this subtree each second. Keep the active control usable.
  if (sessionFocus && document.activeElement === document.body) {
    view.querySelector(`#d-activity ${sessionFocus}`)?.focus({ preventScroll: true });
  }
}

new MutationObserver(decorate).observe(view, { childList: true, subtree: true });
decorate();

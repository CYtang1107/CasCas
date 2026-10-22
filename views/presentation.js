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
// Plan page: the charge-options panel floats over the map. Inactive it is hidden and the map can
// be used through; hovering its tab hints it (mouse only); a click on the tab or a pin activates it.
const panel = { state: 'inactive', selected: null };
const canHover = matchMedia('(hover: hover) and (pointer: fine)');
const calm = matchMedia('(prefers-reduced-motion: reduce)');
const setPanel = (state) => { if (panel.state !== state) { panel.state = state; decorate(); } };

document.addEventListener('mouseover', (event) => {
  if (canHover.matches && panel.state === 'inactive' && event.target.closest('[data-panel-toggle]')) setPanel('hovered');
});
document.addEventListener('mouseout', (event) => {
  const tab = event.target.closest('[data-panel-toggle]');
  if (tab && panel.state === 'hovered' && !tab.contains(event.relatedTarget)) setPanel('inactive');
});
// Only empty-map clicks (from Leaflet) close it; clicks inside the panel, its menus and popups do not.
document.addEventListener('cassama:mapclick', () => setPanel('inactive'));
document.addEventListener('cassama:select', (event) => {
  const sheet = view.querySelector('.charging-workspace .recommendation-sheet');
  panel.selected = event.detail.id;
  if (!sheet) return;
  // On a phone the open panel covers the map, so "On map" steps it back to show the pin and its details.
  if (event.detail.fromList) { setPanel(mobileLayout.matches ? 'inactive' : 'active'); return; }
  const card = sheet.querySelector(`[data-pick="${CSS.escape(event.detail.id)}"]`);
  // A phone pin that is not in the list shows its own detail sheet; the panel stays out of the way.
  if (mobileLayout.matches && !card) { setPanel('inactive'); return; }
  setPanel('active');
  const list = sheet.querySelector('.results');
  if (card && list) {
    const offset = card.getBoundingClientRect().top - list.getBoundingClientRect().top - 8;
    list.scrollBy({ top: offset, behavior: calm.matches ? 'auto' : 'smooth' });
  }
});

document.addEventListener('focusin', (event) => {
  const target = event.target;
  sessionFocus = target.closest('#d-activity')
    ? target.id ? `#${target.id}` : target.dataset.act ? `[data-act="${target.dataset.act}"]` : null
    : null;
});

document.addEventListener('click', (event) => {
  if (event.target.closest('.skip-link')) { event.preventDefault(); view.focus(); return; }
  if (event.target.closest('[data-panel-toggle]')) { setPanel(panel.state === 'active' ? 'inactive' : 'active'); return; }
  if (event.target.closest('[data-close]')) view.querySelector('#d-map')?.focus({ preventScroll: true });
  const control = event.target.closest('[data-detail-size]');
  if (!control) return;
  sizes.detail = control.dataset.detailSize;
  decorate();
});

document.addEventListener('change', (event) => {
  const control = event.target.closest('select[data-sheet-size]');
  if (!control) return;
  sizes.recommendations = control.value;
  decorate();
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  const tools = document.querySelector('.demo-tools[open]');
  if (tools) { tools.open = false; tools.querySelector('summary').focus(); }
  // Escape steps the floating panel back, unless a sheet or search screen opened over it is showing.
  const overlay = view.querySelector('.sheet-backdrop:not([hidden]), .search-screen:not([hidden])');
  if (panel.state === 'active' && !overlay && view.querySelector('.charging-workspace .recommendation-sheet')) {
    setPanel('inactive');
    view.querySelector('[data-panel-toggle]')?.focus();
  }
});

function setSize(panel, value, attribute) {
  if (!panel) return;
  if (panel.dataset.sheet !== value) panel.dataset.sheet = value;
  const select = panel.querySelector(`select[${attribute}]`);
  if (select && select.value !== value) select.value = value;
  panel.querySelectorAll(`[${attribute}]`).forEach((button) => {
    if (button === select) return;
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
  decoratePanel();
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

function decoratePanel() {
  const sheet = view.querySelector('.charging-workspace .recommendation-sheet');
  const tab = view.querySelector('[data-panel-toggle]');
  if (!sheet || !tab) return;
  // Without a map there is nothing to see through: keep the list fully usable.
  const state = view.querySelector('#d-map[hidden]') ? 'active' : panel.state;
  if (sheet.dataset.panel !== state) sheet.dataset.panel = state;
  sheet.inert = state !== 'active'; // the ghost is not reachable by Tab or screen readers
  const open = String(state === 'active');
  if (tab.getAttribute('aria-expanded') !== open) tab.setAttribute('aria-expanded', open);
  // Say what is inside: chargers or trip stops that can be booked, and how many.
  const stops = sheet.querySelectorAll('[data-book-stop]').length;
  const picks = sheet.querySelectorAll('[data-pick]').length;
  const label = state === 'active' ? 'Hide options'
    : stops ? `Book charging stop${stops === 1 ? '' : 's'} (${stops})`
      : picks ? `Book a charger (${picks})` : 'Charge options';
  const text = tab.querySelector('span');
  if (text && text.textContent !== label) text.textContent = label;
  sheet.querySelectorAll('[data-pick]').forEach((card) => card.classList.toggle('is-selected', card.dataset.pick === panel.selected));
}

new MutationObserver(decorate).observe(view, { childList: true, subtree: true });
decorate();

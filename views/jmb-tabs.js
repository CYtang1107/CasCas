// Four focused views for the existing JMB portal. Move already-rendered DOM nodes
// rather than recreating them, so all current bindings and API flows still work.
const TABS = [
  ['overview', 'Overview', 'At a glance', 'Illustrative utilisation, revenue and the current monthly snapshot.'],
  ['operations', 'Operations', 'Charging operations', 'Live charger status, faults, maintenance and booking activity.'],
  ['financials', 'Financials', 'Cost recovery', 'Operating surplus, resident benefits and downloadable reports.'],
  ['governance', 'Governance', 'Sharing and resident decisions', 'Visitor access rules, proposals, votes and resident credentials.'],
];

// Remember the selected tab when a JMB action triggers a dashboard rerender.
let activeTab = 'overview';

function cardNamed(root, title) {
  return Array.from(root.querySelectorAll('section.card')).find((card) =>
    card.querySelector(':scope > h3')?.textContent.trim() === title
  ) || null;
}

let recordedActivityObserver = null;

function moveRecordedChargingActivity(root, operationsPanel) {
  for (const heading of root.querySelectorAll('h2, h3, h4')) {
    if (!/^recorded charging (activity|sessions?)\b/i.test(heading.textContent.trim())) continue;
    // Move the existing node, never duplicate its content or lose bound events.
    const card = heading.closest('.card, section, article');
    if (card && card !== operationsPanel && !card.contains(operationsPanel)
        && !operationsPanel.contains(card)) operationsPanel.append(card);
  }
}

export function installJmbTabs(root) {
  if (recordedActivityObserver) {
    recordedActivityObserver.disconnect();
    recordedActivityObserver = null;
  }
  const portal = root.querySelector('.portal');
  const main = portal?.querySelector(':scope > .jmb');
  const nav = portal?.querySelector(':scope > .side');
  const header = main?.querySelector(':scope > .view-head');
  const kpis = main?.querySelector('#j-s-overview');
  const hourly = cardNamed(main, 'An average day: who charges when');
  const income = cardNamed(main, 'Illustrative income over 6 months');
  const owner = cardNamed(main, 'What it means for owners');
  const sharing = main?.querySelector('#j-s-sharing');
  const finances = main?.querySelector('#j-s-money');
  const live = main?.querySelector('#j-s-live');
  const health = main?.querySelector('#j-s-health');
  const privateArea = main?.querySelector('#j-s-private');
  const maintenance = finances && cardNamed(finances, 'Maintenance log');
  const residentAccess = privateArea && cardNamed(privateArea, 'Resident Access Management');

  // Refuse to rearrange an unfamiliar version: the old anchor navigation stays usable.
  if (![portal, main, nav, header, kpis, hourly, income, owner, sharing,
    finances, live, health, privateArea].every(Boolean)) return false;
  const chartsRow = hourly.parentElement;
  const mixedRow = owner.parentElement;
  if (!chartsRow?.classList.contains('grid2') || !chartsRow.contains(income)
      || !mixedRow?.classList.contains('grid2') || !mixedRow.contains(sharing)
      || chartsRow === mixedRow) return false;

  const panels = new Map();
  const stack = document.createElement('div');
  stack.className = 'jmb-panel-stack';

  for (const [key, , title, description] of TABS) {
    const panel = document.createElement('section');
    panel.id = `jmb-panel-${key}`;
    panel.className = 'jmb-tab-panel';
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', `jmb-tab-${key}`);
    panel.innerHTML = `<div class="jmb-panel-intro"><h2>${title}</h2><p class="muted">${description}</p></div>`;
    stack.append(panel);
    panels.set(key, panel);
  }

  // Place the condominium selector above the tabs on both desktop and mobile.
  header.after(nav);
  nav.after(stack);
  portal.classList.add('jmb-tab-layout');
  nav.classList.add('jmb-tabs');
  nav.setAttribute('aria-label', 'JMB dashboard tabs');
  nav.setAttribute('role', 'tablist');
  nav.innerHTML = TABS.map(([key, label]) =>
    `<button type="button" id="jmb-tab-${key}" role="tab" aria-controls="jmb-panel-${key}" aria-selected="false" tabindex="-1" data-jmb-tab="${key}">${label}</button>`
  ).join('');

  // Overview: original KPIs and the two illustrative charts (unchanged).
  panels.get('overview').append(kpis, chartsRow);

  // The previous mixed row contained one financial and one governance card.
  // Reparent its existing children; do not regenerate their HTML or event handlers.
  panels.get('financials').append(owner, finances);
  panels.get('governance').append(sharing);
  mixedRow.remove();

  // Separate the maintenance log from the financial cost-recovery calculation.
  panels.get('operations').append(live, health);
  if (maintenance) panels.get('operations').append(maintenance);

  // PIN sign-in/out should remain available from every tab.
  const accessBar = privateArea.querySelector(':scope > .jmb-auth');
  const loginCard = privateArea.querySelector(':scope > .jmb-login');
  if (accessBar) header.after(accessBar);
  if (loginCard) header.after(loginCard);

  // Keep visitor/session activity in Operations; resident-key issuance in Governance.
  if (residentAccess) panels.get('governance').append(residentAccess);
  panels.get('operations').append(privateArea);

  const buttons = Array.from(nav.querySelectorAll('[data-jmb-tab]'));
  function activate(key) {
    if (!panels.has(key)) return;
    activeTab = key;
    for (const [name, panel] of panels) panel.hidden = name !== key;
    for (const button of buttons) {
      const selected = button.dataset.jmbTab === key;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
  }

  nav.addEventListener('click', (event) => {
    const button = event.target.closest('[data-jmb-tab]');
    if (button && nav.contains(button)) activate(button.dataset.jmbTab);
  });
  nav.addEventListener('keydown', (event) => {
    const button = event.target.closest('[data-jmb-tab]');
    if (!button) return;
    const idx = buttons.indexOf(button);
    let next = idx;
    if (event.key === 'ArrowRight') next = (idx + 1) % buttons.length;
    else if (event.key === 'ArrowLeft') next = (idx - 1 + buttons.length) % buttons.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = buttons.length - 1;
    else return;
    event.preventDefault();
    const target = buttons[next];
    activate(target.dataset.jmbTab);
    target.focus();
  });
  // This newer financial/activity card was added after the original tab layout.
  // Keep it on Operations rather than leaving it visible below every tab.
  const operationsPanel = panels.get('operations');
  moveRecordedChargingActivity(root, operationsPanel);
  recordedActivityObserver = new MutationObserver(() => {
    if (!root.contains(stack)) {
      recordedActivityObserver?.disconnect();
      recordedActivityObserver = null;
      return;
    }
    moveRecordedChargingActivity(root, operationsPanel);
  });
  recordedActivityObserver.observe(root, { childList: true, subtree: true });
  activate(activeTab);
  return true;
}

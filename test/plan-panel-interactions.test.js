import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

function setupPresentation() {
  const handlers = new Map();
  const card = { dataset: { pick: 'charger-123' }, classList: { toggle() {} } };
  const sheet = {
    dataset: { sheet: 'medium', panel: 'inactive' },
    inert: true,
    querySelector: () => null,
    querySelectorAll: (selector) => selector === '[data-pick]' ? [card] : [],
  };
  const label = { textContent: 'Charge options' };
  const toggle = {
    attrs: { 'aria-expanded': 'false' },
    getAttribute(name) { return this.attrs[name]; },
    setAttribute(name, value) { this.attrs[name] = value; },
    querySelector(name) { return name === 'span' ? label : null; },
  };
  const view = {
    querySelector(selector) {
      if (selector === '.recommendation-sheet' || selector === '.charging-workspace .recommendation-sheet') return sheet;
      if (selector === '[data-panel-toggle]') return toggle;
      return null;
    },
    querySelectorAll() { return []; },
  };
  const document = {
    getElementById(name) { return name === 'view' ? view : null; },
    addEventListener(name, fn) { handlers.set(name, fn); },
    querySelector() { return null; },
  };
  const source = readFileSync(new URL('../views/presentation.js', import.meta.url), 'utf8');
  vm.runInNewContext(source, {
    document,
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    MutationObserver: class { observe() {} },
  });
  const clickToggle = () => handlers.get('click')({ target: {
    closest(selector) { return selector === '[data-panel-toggle]' ? toggle : null; },
  } });
  const select = (fromList = false) => handlers.get('cassama:select')({ detail: { id: 'charger-123', fromList } });
  return { sheet, toggle, label, handlers, clickToggle, select };
}

test('Plan map charger selection never opens the options panel', () => {
  const ui = setupPresentation();
  ui.select(false);
  assert.equal(ui.sheet.dataset.panel, 'inactive');
  assert.equal(ui.toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(ui.sheet.inert, true);
});

test('Plan options only open from toggle, and map selection closes them', () => {
  const ui = setupPresentation();
  assert.equal(ui.handlers.has('mouseover'), false);
  ui.clickToggle();
  assert.equal(ui.sheet.dataset.panel, 'active');
  assert.equal(ui.toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(ui.sheet.inert, false);
  ui.select(false);
  assert.equal(ui.sheet.dataset.panel, 'inactive');
  ui.clickToggle();
  ui.select(true); // "On map" from the options list
  assert.equal(ui.sheet.dataset.panel, 'inactive');
  ui.clickToggle();
  ui.clickToggle();
  assert.equal(ui.sheet.dataset.panel, 'inactive');
});

test('Charger selection always renders the detail card (also for mobile)', () => {
  const source = readFileSync(new URL('../views/driver.js', import.meta.url), 'utf8');
  const selectBody = source.slice(source.indexOf('function select(root, ctx, id, fromList) {'), source.indexOf('function highlightMarker(id) {'));
  assert.match(selectBody, /renderDetail\(root, ctx, last\.ranking, last\.car\)/);
  assert.doesNotMatch(selectBody, /if \(!\(phone && tab === 'plan'/);
});

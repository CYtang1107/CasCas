// A short-lived driver message belongs to the screen that owns the action.
// Shared trip/recommendation state should not make booking errors appear on
// Home or Plan after a failed booking on Activity.
import { esc } from './format.js';

export function scopedFlashHtml(message, target, page) {
  if (!message || target !== page) return '';
  return `<p class="flash" role="alert">${esc(message)}</p>`;
}

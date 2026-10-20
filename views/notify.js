// Browser notifications (opt-in from Account): charge complete, slot ending soon, a new vote.
// Each event notifies once per tag. Without permission nothing is sent, and the in-app notices still show.
const sent = new Set();
const supported = () => typeof Notification !== 'undefined';

export const notifyState = () => (!supported() ? 'unsupported' : Notification.permission);

export async function askPermission() {
  if (!supported()) return 'unsupported';
  try { return await Notification.requestPermission(); } catch { return 'denied'; }
}

export function notify(profile, tag, title, body) {
  if (!profile?.notify || !supported() || Notification.permission !== 'granted' || sent.has(tag)) return false;
  sent.add(tag);
  try { new Notification(title, { body, tag }); return true; } catch { return false; }
}

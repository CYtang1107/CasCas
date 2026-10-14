// Start the CasCas shared server. Sharing hours are Malaysian time, whatever the host's clock.
process.env.TZ = process.env.TZ || 'Asia/Kuala_Lumpur';

const crypto = await import('node:crypto');
const { fileURLToPath } = await import('node:url');
const { createApp } = await import('./app.js');
const { DEMO_PINS } = await import('./pins.js');

let pins = DEMO_PINS;
try { if (process.env.JMB_PINS) pins = JSON.parse(process.env.JMB_PINS); } catch { console.warn('JMB_PINS is not valid JSON; using demo PINs'); }

const app = createApp({
  dataDir: process.env.DATA_DIR || fileURLToPath(new URL('./data', import.meta.url)),
  secret: process.env.JMB_SECRET || crypto.randomBytes(32).toString('hex'),
  pins,
  ocmKey: process.env.OCM_KEY || '',
});

const port = Number(process.env.PORT) || 4100;
app.listen(port, () => console.log(`CasCas shared server on http://localhost:${port}`));

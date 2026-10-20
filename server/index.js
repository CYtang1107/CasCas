// Start the CasSama shared server. Sharing hours are Malaysian time, whatever the host's clock.
process.env.TZ = process.env.TZ || 'Asia/Kuala_Lumpur';

const crypto = await import('node:crypto');
const { fileURLToPath } = await import('node:url');
const { createApp } = await import('./app.js');
const { DEMO_PINS } = await import('./pins.js');

let pins = DEMO_PINS;
try { if (process.env.JMB_PINS) pins = JSON.parse(process.env.JMB_PINS); } catch { console.warn('JMB_PINS is not valid JSON; using demo PINs'); }

const { CONDOS } = await import('../data/condos.js');
const { startSimulator } = await import('./ocpp-sim.js');

// Real chargers would get OCPP_PASSWORD; without it only the built-in simulator can connect.
const ocppPassword = process.env.OCPP_PASSWORD || crypto.randomBytes(16).toString('hex');
const app = createApp({
  dataDir: process.env.DATA_DIR || fileURLToPath(new URL('./data', import.meta.url)),
  secret: process.env.JMB_SECRET || crypto.randomBytes(32).toString('hex'),
  pins,
  ocmKey: process.env.OCM_KEY || '',
  ocppPassword,
  trafficKey: process.env.TOMTOM_KEY || '',
  // Same OpenAI-compatible key as VO-AI (DashScope / Qwen). Without one, Ask CasSama uses its rule-based parser.
  ai: {
    key: process.env.AI_API_KEY || process.env.DASHSCOPE_API_KEY || '',
    baseUrl: process.env.AI_BASE_URL || undefined,
    models: process.env.AI_MODELS ? process.env.AI_MODELS.split(',').map((m) => m.trim()).filter(Boolean) : undefined,
  },
});

const port = Number(process.env.PORT) || 4300;
const server = app.listen(port, () => {
  console.log(`CasSama shared server on http://localhost:${port} · OCPP 1.6-J at ws://localhost:${port}/ocpp/<condo>-<bay>`);
  if (process.env.OCPP_SIM !== '0') {
    app.locals.sim = startSimulator({ url: `ws://127.0.0.1:${port}`, password: ocppPassword, condos: CONDOS });
    console.log('Simulated OCPP chargers started (OCPP_SIM=0 turns them off)');
  }
});
app.locals.attachOcpp(server);

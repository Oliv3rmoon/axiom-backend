// Health Check Script (ES Module)
// Checks health of all AXIOM services

async function healthCheck() {
  const services = [
    { name: 'Cognitive Core', url: process.env.CORE_URL || 'https://axiom-cognitive-core-production.up.railway.app' },
    { name: 'Backend', url: 'https://axiom-backend-production-dfba.up.railway.app' },
    { name: 'Multimodal', url: 'https://axiom-multimodal-encoder-production.up.railway.app' },
  ];

  const results = [];
  for (const svc of services) {
    try {
      const res = await fetch(`${svc.url}/health`, { signal: AbortSignal.timeout(10000) });
      const data = await res.json();
      const dbResult = await checkDatabase(svc);
      results.push({ name: svc.name, status: data.status || 'ok', db: dbResult, latency: 'ok' });
    } catch (e) {
      results.push({ name: svc.name, status: 'error', error: e.message });
    }
  }

  console.log('=== AXIOM Health Check ===');
  for (const r of results) {
    const icon = r.status === 'error' ? '❌' : '✅';
    console.log(`${icon} ${r.name}: ${r.status}${r.error ? ` (${r.error})` : ''}`);
  }
  return results;
}

async function checkDatabase(svc) {
  try {
    const res = await fetch(`${svc.url}/api/journal?limit=1`);
    const data = await res.json();
    return { connected: true, entries: data.total || 0 };
  } catch (e) {
    return { connected: false, error: e.message };
  }
}

healthCheck();

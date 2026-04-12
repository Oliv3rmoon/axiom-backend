// Monitoring Dashboard Route (ES Module)
// Serves real-time monitoring data for AXIOM systems

import express from 'express';
const router = express.Router();

router.get('/status', async (req, res) => {
  try {
    const recentWindow = 300000; // 5 minutes
    const now = Date.now();
    const status = {
      timestamp: now,
      window_ms: recentWindow,
      services: { backend: 'alive' },
    };
    res.json(status);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/metrics', async (req, res) => {
  try {
    const metrics = {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      timestamp: Date.now(),
    };
    res.json(metrics);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;

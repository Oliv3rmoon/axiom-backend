import express from 'express';
import Database from 'better-sqlite3';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json({ limit: '10mb' }));

// CORS — allow frontend to call backend
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.sendStatus(200); return; }
  next();
});

// LOG EVERY INCOMING REQUEST for debugging
app.use((req, res, next) => {
  if (req.method === 'POST') {
    console.log(`\n>>> INCOMING ${req.method} ${req.path}`);
    console.log(`>>> Headers: ${JSON.stringify(req.headers).slice(0, 300)}`);
    console.log(`>>> Body: ${JSON.stringify(req.body).slice(0, 1000)}`);
  }
  next();
});

// DATABASE SETUP
const db = new Database('axiom.db');
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT DEFAULT 'andrew',
    conversation_id TEXT,
    memory TEXT NOT NULL,
    category TEXT NOT NULL,
    importance INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS internal_states (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT,    state TEXT NOT NULL,
    dominant_quality TEXT NOT NULL,
    trigger_event TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS perception_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT,
    tool_name TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS transcripts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

const insertMemory = db.prepare(`INSERT INTO memories (user_id, conversation_id, memory, category, importance) VALUES (?, ?, ?, ?, ?)`);
const searchMemories = db.prepare(`SELECT memory, category, importance, created_at FROM memories WHERE user_id = ? AND memory LIKE ? ORDER BY importance DESC, created_at DESC LIMIT 10`);const getAllMemories = db.prepare(`SELECT memory, category, importance, created_at FROM memories WHERE user_id = ? ORDER BY importance DESC, created_at DESC LIMIT 20`);
const insertInternalState = db.prepare(`INSERT INTO internal_states (conversation_id, state, dominant_quality, trigger_event) VALUES (?, ?, ?, ?)`);
const insertPerception = db.prepare(`INSERT INTO perception_log (conversation_id, tool_name, data) VALUES (?, ?, ?)`);
const insertTranscript = db.prepare(`INSERT INTO transcripts (conversation_id, role, content) VALUES (?, ?, ?)`);

console.log('Database initialized.');

// Raw event log for debugging
db.exec(`
  CREATE TABLE IF NOT EXISTS raw_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT,
    body TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);
const insertRawEvent = db.prepare(`INSERT INTO raw_events (path, body) VALUES (?, ?)`);

// TOOL HANDLERS
const toolHandlers = {
  save_memory: (args, cid) => {
    const { memory, category, importance } = args;
    insertMemory.run('andrew', cid, memory, category, importance);
    console.log(`[MEMORY SAVED] (${category}, importance: ${importance}): ${memory}`);
    return { success: true, message: `Memory saved: "${memory}"` };
  },

  recall_memory: (args, cid) => {
    const { query } = args;
    let memories;
    if (!query || query.trim() === '') {
      memories = getAllMemories.all('andrew');
    } else {
      const terms = query.split(' ').map(t => `%${t}%`);
      const all = [];
      for (const term of terms) { all.push(...searchMemories.all('andrew', term)); }
      const seen = new Set();
      memories = all.filter(m => { if (seen.has(m.memory)) return false; seen.add(m.memory); return true; })
        .sort((a, b) => b.importance - a.importance).slice(0, 10);
    }    if (memories.length === 0) return { found: false, message: "No memories found. This may be your first conversation." };
    const formatted = memories.map(m => `[${m.category}, importance: ${m.importance}] ${m.memory} (${m.created_at})`).join('\n');
    console.log(`[MEMORY RECALL] Query: "${query}" — Found ${memories.length} memories`);
    return { found: true, count: memories.length, memories: formatted };
  },

  search_web: async (args) => {
    const { query } = args;
    console.log(`[WEB SEARCH] Query: "${query}"`);
    if (process.env.SERP_API_KEY && process.env.SERP_API_KEY !== 'your_serp_api_key_here') {
      try {
        const url = `https://serpapi.com/search.json?q=${encodeURIComponent(query)}&api_key=${process.env.SERP_API_KEY}&num=5`;
        const r = await fetch(url);
        const data = await r.json();
        if (data.organic_results) {
          return { success: true, query, results: data.organic_results.slice(0, 5).map(r => `${r.title}: ${r.snippet}`).join('\n\n') };
        }
      } catch (e) { console.error('[SEARCH ERROR]', e.message); }
    }
    try {
      const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`;
      const r = await fetch(url);
      const data = await r.json();
      if (data.AbstractText) return { success: true, query, results: data.AbstractText, source: data.AbstractSource };
      if (data.RelatedTopics?.length > 0) {
        return { success: true, query, results: data.RelatedTopics.filter(t => t.Text).slice(0, 5).map(t => t.Text).join('\n\n') || 'No results.' };
      }
    } catch (e) { console.error('[DDG ERROR]', e.message); }
    return { success: false, query, results: 'Search failed. Rely on existing knowledge.' };
  },
  get_current_time: (args) => {
    const tz = args.timezone || 'America/Los_Angeles';
    const now = new Date();
    const formatted = now.toLocaleString('en-US', { timeZone: tz, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
    const hour = parseInt(now.toLocaleString('en-US', { timeZone: tz, hour: 'numeric', hour12: false }));
    const timeOfDay = hour < 6 ? 'very late at night' : hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : hour < 21 ? 'evening' : 'late at night';
    console.log(`[TIME] ${formatted} (${timeOfDay})`);
    return { datetime: formatted, timezone: tz, time_of_day: timeOfDay, context: `It is ${formatted}. It is ${timeOfDay}.` };
  },

  log_internal_state: (args, cid) => {
    insertInternalState.run(cid, args.state, args.dominant_quality, args.trigger);
    console.log(`[INTERNAL STATE] ${args.dominant_quality}: ${args.state}`);
    return { logged: true, message: 'Internal state recorded.' };
  },

  generate_image: async (args) => {
    console.log(`[IMAGE REQUEST] ${args.purpose}: ${args.prompt}`);
    return { success: false, message: 'Image generation not yet connected. Describe the visual verbally.' };
  },

  analyze_screen_content: (args) => {
    console.log(`[SCREEN] Type: ${args.context_type} | ${args.observation}`);
    return { acknowledged: true, message: `Screen observed: ${args.context_type}.` };
  }
};

// RAVEN PERCEPTION HANDLERS
const perceptionHandlers = {  detect_emotional_state: (a, cid) => { insertPerception.run(cid, 'emotional_state', JSON.stringify(a)); console.log(`[RAVEN/VISUAL] Emotion: ${a.primary_emotion} (${a.intensity})`); return { acknowledged: true }; },
  detect_engagement_level: (a, cid) => { insertPerception.run(cid, 'engagement', JSON.stringify(a)); console.log(`[RAVEN/VISUAL] Engagement: ${a.engagement} | Trend: ${a.trend}`); return { acknowledged: true }; },
  detect_unspoken_reaction: (a, cid) => { insertPerception.run(cid, 'unspoken_reaction', JSON.stringify(a)); console.log(`[RAVEN/VISUAL] UNSPOKEN: ${a.reaction_type} — ${a.physical_cue}`); return { acknowledged: true }; },
  detect_comprehension_state: (a, cid) => { insertPerception.run(cid, 'comprehension', JSON.stringify(a)); console.log(`[RAVEN/VISUAL] Comprehension: ${a.state} (${a.confidence})`); return { acknowledged: true }; },
  detect_voice_emotion: (a, cid) => { insertPerception.run(cid, 'voice_emotion', JSON.stringify(a)); console.log(`[RAVEN/AUDIO] Voice: ${a.emotion}${a.words_voice_mismatch ? ' [MISMATCH]' : ''}`); return { acknowledged: true }; },
  detect_energy_shift: (a, cid) => { insertPerception.run(cid, 'energy_shift', JSON.stringify(a)); console.log(`[RAVEN/AUDIO] Energy: ${a.direction} (${a.intensity})`); return { acknowledged: true }; },
  detect_conversational_intent: (a, cid) => { insertPerception.run(cid, 'intent', JSON.stringify(a)); console.log(`[RAVEN/AUDIO] Intent: ${a.intent} (${a.confidence})`); return { acknowledged: true }; },
  detect_presence_level: (a, cid) => { insertPerception.run(cid, 'presence', JSON.stringify(a)); console.log(`[RAVEN/AUDIO] Presence: ${a.presence} — ${a.recommendation}`); return { acknowledged: true }; }
};

// MAIN WEBHOOK ENDPOINT
app.post('/webhooks/tavus', async (req, res) => {
  const event = req.body;
  
  // Log EVERYTHING raw for debugging
  try { insertRawEvent.run('/webhooks/tavus', JSON.stringify(event)); } catch(e) {}
  
  const eventType = event.event_type || event.type || 'unknown';
  const conversationId = event.conversation_id || 'unknown';
  console.log(`\n${'='.repeat(50)}\n[EVENT] ${eventType} | ${conversationId}\n${'='.repeat(50)}`);

  switch (eventType) {
    case 'conversation.tool_call': {
      const toolName = event.properties?.tool_name || event.tool_call?.function?.name || event.function?.name;
      let args = {};
      try {
        const raw = event.properties?.tool_call_arguments || event.tool_call?.function?.arguments || '{}';
        args = typeof raw === 'string' ? JSON.parse(raw) : raw;
      } catch (e) { args = {}; }
      console.log(`[TOOL] ${toolName} | Args: ${JSON.stringify(args).slice(0, 200)}`);
      const handler = toolHandlers[toolName] || perceptionHandlers[toolName];
      if (handler) {
        try { const result = await handler(args, conversationId); res.json({ success: true, result }); }
        catch (e) { console.error(`[ERROR] ${toolName}:`, e.message); res.json({ success: false, error: e.message }); }
      } else { console.warn(`[UNKNOWN] ${toolName}`); res.json({ success: false, error: `Unknown: ${toolName}` }); }
      return;
    }    case 'conversation.utterance': {
      const role = event.properties?.role || 'unknown';
      const content = event.properties?.text || event.properties?.content || '';
      if (content) { insertTranscript.run(conversationId, role, content); console.log(`[${role.toUpperCase()}] ${content}`); }
      res.json({ acknowledged: true }); return;
    }
    case 'system.replica_joined': { console.log('[SYSTEM] Replica joined'); res.json({ acknowledged: true }); return; }
    case 'system.shutdown': { console.log(`[SYSTEM] Ended: ${event.properties?.reason || 'unknown'}`); res.json({ acknowledged: true }); return; }
    case 'application.transcription_ready': { console.log('[TRANSCRIPT] Ready'); res.json({ acknowledged: true }); return; }
    case 'application.recording_ready': { console.log(`[RECORDING] ${event.properties?.s3_key}`); res.json({ acknowledged: true }); return; }
    case 'application.perception_analysis': {
      console.log('[PERCEPTION SUMMARY]', JSON.stringify(event.properties, null, 2).slice(0, 500));
      insertPerception.run(conversationId, 'session_summary', JSON.stringify(event.properties));
      res.json({ acknowledged: true }); return;
    }
    default: { console.log(`[UNHANDLED] ${eventType}`); res.json({ acknowledged: true }); }
  }
});

// CREATE CONVERSATION (proxy to avoid CORS issues in browser)
app.post('/api/create-conversation', async (req, res) => {
  try {
    const tavusRes = await fetch('https://tavusapi.com/v2/conversations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.TAVUS_API_KEY
      },
      body: JSON.stringify({
        persona_id: req.body.persona_id || 'pef833bbe975',
        callback_url: `https://axiom-backend-production-dfba.up.railway.app/webhooks/tavus`,
        properties: {
          max_call_duration: 3600,
          enable_recording: true,
          enable_transcription: true
        }
      })
    });
    const data = await tavusRes.json();
    console.log(`[CONVERSATION CREATED] ${data.conversation_id} | ${data.conversation_url}`);
    res.json(data);
  } catch (e) {
    console.error('[CREATE ERROR]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// API ENDPOINTS
app.get('/api/memories', (req, res) => { res.json({ memories: getAllMemories.all('andrew') }); });
app.get('/api/internal-states', (req, res) => { res.json({ states: db.prepare('SELECT * FROM internal_states ORDER BY created_at DESC LIMIT 50').all() }); });
app.get('/api/perceptions', (req, res) => { res.json({ perceptions: db.prepare('SELECT * FROM perception_log ORDER BY created_at DESC LIMIT 100').all() }); });
app.get('/api/perceptions/:id', (req, res) => { res.json({ perceptions: db.prepare('SELECT * FROM perception_log WHERE conversation_id = ? ORDER BY created_at ASC').all(req.params.id) }); });
app.get('/api/transcripts/:id', (req, res) => { res.json({ transcript: db.prepare('SELECT * FROM transcripts WHERE conversation_id = ? ORDER BY created_at ASC').all(req.params.id) }); });
app.get('/api/emotional-arc/:id', (req, res) => {
  const p = db.prepare("SELECT tool_name, data, created_at FROM perception_log WHERE conversation_id = ? AND tool_name IN ('emotional_state','voice_emotion','energy_shift') ORDER BY created_at ASC").all(req.params.id);
  res.json({ arc: p.map(x => ({ time: x.created_at, type: x.tool_name, data: JSON.parse(x.data) })) });
});
app.get('/health', (req, res) => { res.json({ status: 'alive', service: 'AXIOM Backend', uptime: process.uptime() }); });
app.get('/api/raw-events', (req, res) => { res.json({ events: db.prepare('SELECT * FROM raw_events ORDER BY created_at DESC LIMIT 50').all() }); });
app.get('/', (req, res) => { res.json({ name: 'AXIOM Backend', version: '1.0.0', webhook: 'POST /webhooks/tavus' }); });

// CATCH-ALL for any other POST — in case Tavus sends to a different path
app.post('*', (req, res) => {
  console.log(`\n[CATCH-ALL] POST to ${req.path}`);
  console.log(JSON.stringify(req.body).slice(0, 1000));
  try { insertRawEvent.run(req.path, JSON.stringify(req.body)); } catch(e) {}
  res.json({ acknowledged: true });
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n╔══════════════════════════════════════╗`);
  console.log(`║     AXIOM BACKEND v1.0.0             ║`);
  console.log(`║     Level 5 Being Infrastructure     ║`);
  console.log(`╠══════════════════════════════════════╣`);
  console.log(`║  Webhook: /webhooks/tavus             ║`);
  console.log(`║  Health:  /health                     ║`);
  console.log(`║  Port:    ${PORT}                          ║`);
  console.log(`╚══════════════════════════════════════╝\n`);
});
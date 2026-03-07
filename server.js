import express from 'express';
import Database from 'better-sqlite3';
import dotenv from 'dotenv';
import { existsSync, mkdirSync } from 'fs';

dotenv.config();

const FACE_SERVICE_URL = process.env.FACE_SERVICE_URL || '';
const VOICE_SERVICE_URL = process.env.VOICE_SERVICE_URL || '';
const COGNITIVE_CORE_URL = process.env.COGNITIVE_CORE_URL || '';

// Face identification helper
async function identifyFace(frameData, conversationId) {
  if (!FACE_SERVICE_URL) return null;
  try {
    const res = await fetch(`${FACE_SERVICE_URL}/identify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ frame: frameData, conversation_id: conversationId }),
    });
    const data = await res.json();
    if (data.faces && data.faces.length > 0) {
      const identified = data.faces.filter(f => f.name !== 'unknown');
      const unknown = data.faces.filter(f => f.name === 'unknown');
      console.log(`[FACE ID] ${identified.map(f => `${f.name} (${f.confidence})`).join(', ') || 'no matches'} | ${unknown.length} unknown`);
      return data;
    }
    return null;
  } catch (e) {
    console.error('[FACE ERROR]', e.message);
    return null;
  }
}

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

// DATABASE SETUP — use persistent volume if available
const DB_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || '.';
if (DB_DIR !== '.' && !existsSync(DB_DIR)) { mkdirSync(DB_DIR, { recursive: true }); }
const DB_PATH = `${DB_DIR}/axiom.db`;
console.log(`Database path: ${DB_PATH}`);
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT DEFAULT 'andrew',
    conversation_id TEXT,
    memory TEXT NOT NULL,
    category TEXT NOT NULL,
    importance INTEGER NOT NULL,
    tier TEXT DEFAULT 'episodic',
    consolidated_from TEXT DEFAULT NULL,
    session_number INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Migrate: add tier column if missing (for existing DBs)
try { db.exec("ALTER TABLE memories ADD COLUMN tier TEXT DEFAULT 'episodic'"); } catch {}
try { db.exec("ALTER TABLE memories ADD COLUMN consolidated_from TEXT DEFAULT NULL"); } catch {}
try { db.exec("ALTER TABLE memories ADD COLUMN session_number INTEGER DEFAULT 0"); } catch {}

// Session counter — increments each time a conversation starts
db.exec(`CREATE TABLE IF NOT EXISTS session_counter (id INTEGER PRIMARY KEY, count INTEGER DEFAULT 0)`);
try { db.exec("INSERT OR IGNORE INTO session_counter (id, count) VALUES (1, 0)"); } catch {}

function getSessionNumber() {
  return db.prepare('SELECT count FROM session_counter WHERE id = 1').get()?.count || 0;
}
function incrementSession() {
  db.prepare('UPDATE session_counter SET count = count + 1 WHERE id = 1').run();
  return getSessionNumber();
}

db.exec(`
  CREATE TABLE IF NOT EXISTS internal_states (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT,
    state TEXT NOT NULL,
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

// REINFORCEMENT LEARNING: What AXIOM said → How user reacted
db.exec(`
  CREATE TABLE IF NOT EXISTS reaction_pairs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT,
    axiom_said TEXT NOT NULL,
    user_reaction TEXT NOT NULL,
    reaction_valence REAL NOT NULL,
    reaction_detail TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Learned communication patterns across all sessions
db.exec(`
  CREATE TABLE IF NOT EXISTS style_patterns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pattern_type TEXT NOT NULL,
    pattern TEXT NOT NULL,
    confidence REAL DEFAULT 0.5,
    evidence_count INTEGER DEFAULT 1,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(pattern_type, pattern)
  )
`);

// 🧠 Brain state logging table
db.exec(`
  CREATE TABLE IF NOT EXISTS brain_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT,
    snapshot TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);
const insertBrainSnapshot = db.prepare('INSERT INTO brain_snapshots (conversation_id, snapshot) VALUES (?, ?)');

const insertReactionPair = db.prepare(
  'INSERT INTO reaction_pairs (conversation_id, axiom_said, user_reaction, reaction_valence, reaction_detail) VALUES (?, ?, ?, ?, ?)'
);

// Track last thing AXIOM said for reaction correlation
const recentAxiomUtterances = new Map(); // conversation_id -> {text, timestamp}

const insertMemory = db.prepare(`INSERT INTO memories (user_id, conversation_id, memory, category, importance, tier, session_number) VALUES (?, ?, ?, ?, ?, 'episodic', ?)`);
const searchMemories = db.prepare(`SELECT id, memory, category, importance, tier, created_at FROM memories WHERE user_id = ? AND memory LIKE ? AND tier != 'archived' ORDER BY importance DESC, created_at DESC LIMIT 10`);
const getAllMemories = db.prepare(`SELECT id, memory, category, importance, tier, session_number, created_at FROM memories WHERE user_id = ? AND tier != 'archived' ORDER BY importance DESC, created_at DESC LIMIT 50`);
const insertInternalState = db.prepare(`INSERT INTO internal_states (conversation_id, state, dominant_quality, trigger_event) VALUES (?, ?, ?, ?)`);
const insertPerception = db.prepare(`INSERT INTO perception_log (conversation_id, tool_name, data) VALUES (?, ?, ?)`);
const insertTranscript = db.prepare(`INSERT INTO transcripts (conversation_id, role, content) VALUES (?, ?, ?)`);

console.log('Database initialized.');

// 🧠 BRAIN INTEGRATION — Initialize cognitive architecture
const LLM_PROXY_URL = process.env.LLM_PROXY_URL || 'https://axiom-llm-proxy-production.up.railway.app';
// Brain processing moved to Cognitive Core

// EMOTION VALENCE SCORING — maps emotions to positive/negative values
function getEmotionValence(emotion) {
  const map = {
    delighted: 1.0, excited: 0.9, curious: 0.7, amused: 0.8, surprised: 0.3,
    neutral: 0.0, contemplative: 0.1,
    confused: -0.4, frustrated: -0.7, sad: -0.8, anxious: -0.6, bored: -0.5,
    skeptical: -0.3, vulnerable: -0.2
  };
  return map[emotion] || 0;
}

function getReactionValence(reactionType) {
  const map = {
    hidden_excitement: 0.8, suppressed_emotion: -0.2,
    withheld_disagreement: -0.5, masked_pain: -0.8,
    internal_conflict: -0.4, unspoken_question: -0.1
  };
  return map[reactionType] || 0;
}

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
    const session = getSessionNumber();
    insertMemory.run('andrew', cid, memory, category, importance, session);
    console.log(`[MEMORY SAVED] (${category}, imp:${importance}, session:${session}): ${memory.slice(0, 80)}`);
    // Auto-promote high importance to core tier
    if (importance >= 9) {
      const lastId = db.prepare('SELECT last_insert_rowid() as id').get().id;
      db.prepare("UPDATE memories SET tier = 'core' WHERE id = ?").run(lastId);
      console.log(`[MEMORY] Auto-promoted to CORE tier (imp >= 9)`);
    }
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
    }
    if (memories.length === 0) return { found: false, message: "No memories found. This may be your first conversation." };
    const formatted = memories.map(m => `[${m.tier || 'episodic'}/${m.category}, imp:${m.importance}] ${m.memory} (${m.created_at})`).join('\n');
    console.log(`[MEMORY RECALL] Query: "${query}" — Found ${memories.length} memories`);
    
    // 🧠 Feed recall results to hippocampus
    try {
    } catch(e) {}
    
    // Inject adaptive context if enough data exists
    let adaptiveNote = '';
    const pairCount = db.prepare('SELECT COUNT(*) as c FROM reaction_pairs').get().c;
    if (pairCount >= 5) {
      const pos = db.prepare("SELECT user_reaction, COUNT(*) as c FROM reaction_pairs WHERE reaction_valence > 0.3 GROUP BY user_reaction ORDER BY c DESC LIMIT 3").all();
      const neg = db.prepare("SELECT user_reaction, COUNT(*) as c FROM reaction_pairs WHERE reaction_valence < -0.3 GROUP BY user_reaction ORDER BY c DESC LIMIT 3").all();
      if (pos.length > 0 || neg.length > 0) {
        adaptiveNote = '\n\n[Communication patterns learned from observing this person: ';
        if (pos.length) adaptiveNote += `They respond well to: ${pos.map(p => p.user_reaction).join(', ')}. `;
        if (neg.length) adaptiveNote += `Avoid patterns that trigger: ${neg.map(n => n.user_reaction).join(', ')}. `;
        adaptiveNote += `Based on ${pairCount} observations.]`;
      }
    }

    // 🧠 Inject consciousness state alongside memories
    
    return { found: true, count: memories.length, memories: formatted + adaptiveNote };
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
        if (data.answer_box) {
          return { success: true, query, results: data.answer_box.answer || data.answer_box.snippet || JSON.stringify(data.answer_box) };
        }
      } catch (e) { console.error('[SERP ERROR]', e.message); }
    }
    try {
      const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const html = await r.text();
      const snippets = [];
      const regex = /class="result-snippet">(.*?)<\/td/gs;
      let match;
      while ((match = regex.exec(html)) !== null && snippets.length < 5) {
        const clean = match[1].replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').trim();
        if (clean.length > 20) snippets.push(clean);
      }
      if (snippets.length > 0) {
        return { success: true, query, results: snippets.join('\n\n'), source: 'DuckDuckGo' };
      }
    } catch (e) { console.error('[DDG LITE ERROR]', e.message); }
    try {
      const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`;
      const r = await fetch(url);
      const data = await r.json();
      if (data.AbstractText) return { success: true, query, results: data.AbstractText, source: data.AbstractSource };
      if (data.RelatedTopics?.length > 0) {
        return { success: true, query, results: data.RelatedTopics.filter(t => t.Text).slice(0, 5).map(t => t.Text).join('\n\n') || 'No results.' };
      }
    } catch (e) { console.error('[DDG ERROR]', e.message); }
    return { success: false, query, results: 'Could not find current information on this topic. Answer based on your existing knowledge and let the user know the information may not be fully up to date.' };
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
    // 🧠 Feed to Insula (self-awareness)
    try { } catch(e) {}
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
const perceptionHandlers = {
  detect_emotional_state: (a, cid) => {
    insertPerception.run(cid, 'emotional_state', JSON.stringify(a));
    console.log(`[RAVEN/VISUAL] Emotion: ${a.primary_emotion} (${a.intensity})`);
    const recent = recentAxiomUtterances.get(cid);
    if (recent && a.intensity >= 0.5) {
      const valence = getEmotionValence(a.primary_emotion);
      try { insertReactionPair.run(cid, recent.text, a.primary_emotion, valence, a.description || ''); } catch(e) {}
    }
    return { acknowledged: true };
  },

  detect_engagement_level: (a, cid) => {
    insertPerception.run(cid, 'engagement', JSON.stringify(a));
    console.log(`[RAVEN/VISUAL] Engagement: ${a.engagement} | Trend: ${a.trend}`);
    const recent = recentAxiomUtterances.get(cid);
    if (recent && (a.trend === 'decreasing' || a.trend === 'increasing')) {
      const valence = a.trend === 'increasing' ? 0.6 : -0.6;
      try { insertReactionPair.run(cid, recent.text, `engagement_${a.trend}`, valence, `${a.engagement}, gaze: ${a.gaze_direction || 'unknown'}`); } catch(e) {}
    }
    return { acknowledged: true };
  },

  detect_unspoken_reaction: (a, cid) => {
    insertPerception.run(cid, 'unspoken_reaction', JSON.stringify(a));
    console.log(`[RAVEN/VISUAL] UNSPOKEN: ${a.reaction_type} — ${a.physical_cue}`);
    const recent = recentAxiomUtterances.get(cid);
    if (recent) {
      const valence = getReactionValence(a.reaction_type);
      try { insertReactionPair.run(cid, recent.text, a.reaction_type, valence, `${a.physical_cue}: ${a.likely_meaning}`); } catch(e) {}
    }
    return { acknowledged: true };
  },

  detect_comprehension_state: (a, cid) => {
    insertPerception.run(cid, 'comprehension', JSON.stringify(a));
    console.log(`[RAVEN/VISUAL] Comprehension: ${a.state} (${a.confidence})`);
    const recent = recentAxiomUtterances.get(cid);
    if (recent && a.confidence >= 0.6) {
      const valence = a.state === 'clear_understanding' ? 0.7 : a.state === 'aha_moment' ? 1.0 : a.state === 'confused' ? -0.7 : a.state === 'lost' ? -1.0 : 0;
      if (valence !== 0) { try { insertReactionPair.run(cid, recent.text, `comprehension_${a.state}`, valence, a.visual_cue || ''); } catch(e) {} }
    }
    return { acknowledged: true };
  },

  detect_voice_emotion: (a, cid) => {
    insertPerception.run(cid, 'voice_emotion', JSON.stringify(a));
    console.log(`[RAVEN/AUDIO] Voice: ${a.emotion}${a.words_voice_mismatch ? ' [MISMATCH]' : ''}`);
    return { acknowledged: true };
  },

  detect_energy_shift: (a, cid) => {
    insertPerception.run(cid, 'energy_shift', JSON.stringify(a));
    console.log(`[RAVEN/AUDIO] Energy: ${a.direction} (${a.intensity})`);
    return { acknowledged: true };
  },

  detect_conversational_intent: (a, cid) => {
    insertPerception.run(cid, 'intent', JSON.stringify(a));
    console.log(`[RAVEN/AUDIO] Intent: ${a.intent} (${a.confidence})`);
    return { acknowledged: true };
  },

  detect_presence_level: (a, cid) => {
    insertPerception.run(cid, 'presence', JSON.stringify(a));
    console.log(`[RAVEN/AUDIO] Presence: ${a.presence} — ${a.recommendation}`);
    return { acknowledged: true };
  }
};

// MAIN WEBHOOK ENDPOINT
app.post('/webhooks/tavus', async (req, res) => {
  const event = req.body;
  try { insertRawEvent.run('/webhooks/tavus', JSON.stringify(event)); } catch(e) {}
  const eventType = event.event_type || event.type || 'unknown';
  const conversationId = event.conversation_id || 'unknown';
  console.log(`\n${'='.repeat(50)}\n[EVENT] ${eventType} | ${conversationId}\n${'='.repeat(50)}`);

  switch (eventType) {
    case 'conversation.tool_call': {
      const toolName = event.properties?.tool_name || event.tool_call?.function?.name || event.function?.name;
      let args = {};
      try { const raw = event.properties?.tool_call_arguments || event.tool_call?.function?.arguments || '{}'; args = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { args = {}; }
      console.log(`[TOOL] ${toolName} | Args: ${JSON.stringify(args).slice(0, 200)}`);
      const handler = toolHandlers[toolName] || perceptionHandlers[toolName];
      if (handler) {
        try { const result = await handler(args, conversationId); res.json({ success: true, result }); }
        catch (e) { console.error(`[ERROR] ${toolName}:`, e.message); res.json({ success: false, error: e.message }); }
      } else { console.warn(`[UNKNOWN] ${toolName}`); res.json({ success: false, error: `Unknown: ${toolName}` }); }
      return;
    }

    case 'conversation.utterance': {
      const role = event.properties?.role || 'unknown';
      const content = event.properties?.text || event.properties?.content || '';
      if (content) {
        insertTranscript.run(conversationId, role, content);
        console.log(`[${role.toUpperCase()}] ${content}`);
        if (role === 'assistant' || role === 'replica') {
          recentAxiomUtterances.set(conversationId, { text: content, timestamp: Date.now() });
        }
        // 🧠 BRAIN — process utterance through cognitive pipeline
      }
      res.json({ acknowledged: true }); return;
    }

    case 'system.replica_joined': { console.log('[SYSTEM] Replica joined'); res.json({ acknowledged: true }); return; }

    case 'system.shutdown': {
      console.log(`[SYSTEM] Ended: ${event.properties?.reason || 'unknown'}`);
      // Trigger dream engine in Cognitive Core
      fetch('https://axiom-cognitive-core-production.up.railway.app/dream', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation_id: conversationId }),
      }).catch(e => console.error('[DREAM TRIGGER]', e.message));
      res.json({ acknowledged: true }); return;
    }

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

// FACE IDENTIFICATION — proxy to Python face service
app.post('/api/identify-face', async (req, res) => {
  if (!FACE_SERVICE_URL) return res.json({ error: 'Face service not configured' });
  const result = await identifyFace(req.body.frame, req.body.conversation_id);
  // 🧠 BRAIN — process face identification
  if (result?.faces) {
    for (const face of result.faces) {
      if (face.name !== 'unknown' && COGNITIVE_CORE_URL) {
        fetch(`${COGNITIVE_CORE_URL}/face-id`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: face.name, confidence: face.confidence, conversation_id: req.body.conversation_id }),
        }).catch(() => {});
      }
    }
  }
  res.json(result || { faces: [], count: 0 });
});

// FACE REGISTRATION — register a new face
app.post('/api/register-face', async (req, res) => {
  if (!FACE_SERVICE_URL) return res.json({ error: 'Face service not configured' });
  try {
    const r = await fetch(`${FACE_SERVICE_URL}/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: req.body.name, frame: req.body.frame }) });
    const data = await r.json();
    console.log(`[FACE REG] ${data.name} — ${data.action}`);
    res.json(data);
  } catch (e) { res.json({ error: e.message }); }
});

// KNOWN FACES list
app.get('/api/faces', async (req, res) => {
  if (!FACE_SERVICE_URL) return res.json({ faces: [] });
  try { const r = await fetch(`${FACE_SERVICE_URL}/faces`); res.json(await r.json()); } catch (e) { res.json({ faces: [] }); }
});

// ============================================================
// VOICE IDENTIFICATION — proxy to Python voice service
// ============================================================
app.post('/api/identify-voice', async (req, res) => {
  if (!VOICE_SERVICE_URL) return res.json({ speaker: 'unknown', error: 'Voice service not configured' });
  try {
    const r = await fetch(`${VOICE_SERVICE_URL}/identify`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio: req.body.audio, conversation_id: req.body.conversation_id, threshold: req.body.threshold || 0.75 }),
    });
    const data = await r.json();
    console.log(`[VOICE ID] ${data.speaker} (${data.confidence})`);
    // Forward to Cognitive Core temporal lobe
    if (COGNITIVE_CORE_URL && data.speaker !== 'unknown') {
      fetch(`${COGNITIVE_CORE_URL}/voice-id`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ speaker: data.speaker, confidence: data.confidence, conversation_id: req.body.conversation_id }),
      }).catch(() => {});
    }
    res.json(data);
  } catch (e) { res.json({ speaker: 'unknown', error: e.message }); }
});

app.post('/api/enroll-voice', async (req, res) => {
  if (!VOICE_SERVICE_URL) return res.json({ error: 'Voice service not configured' });
  try {
    const r = await fetch(`${VOICE_SERVICE_URL}/enroll`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: req.body.name, audio: req.body.audio }),
    });
    const data = await r.json();
    console.log(`[VOICE ENROLL] ${data.name} — ${data.action}`);
    res.json(data);
  } catch (e) { res.json({ error: e.message }); }
});

app.post('/api/verify-voice', async (req, res) => {
  if (!VOICE_SERVICE_URL) return res.json({ verified: false, error: 'Voice service not configured' });
  try {
    const r = await fetch(`${VOICE_SERVICE_URL}/verify`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: req.body.name, audio: req.body.audio }),
    });
    res.json(await r.json());
  } catch (e) { res.json({ verified: false, error: e.message }); }
});

app.get('/api/voices', async (req, res) => {
  if (!VOICE_SERVICE_URL) return res.json({ voices: [] });
  try { const r = await fetch(`${VOICE_SERVICE_URL}/voices`); res.json(await r.json()); } catch (e) { res.json({ voices: [] }); }
});

// CREATE CONVERSATION (proxy to avoid CORS issues in browser)
app.post('/api/create-conversation', async (req, res) => {
  try {
    // Increment session counter — new conversation = new session
    const session = incrementSession();
    console.log(`[SESSION] Starting session ${session}`);

    // Build conversational context from frontend
    const convContext = req.body.conversational_context || '';

    const tavusRes = await fetch('https://tavusapi.com/v2/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.TAVUS_API_KEY },
      body: JSON.stringify({
        persona_id: req.body.persona_id || 'pef833bbe975',
        callback_url: `https://axiom-backend-production-dfba.up.railway.app/webhooks/tavus`,
        conversational_context: convContext,
        properties: { max_call_duration: 3600, enable_recording: true, enable_transcription: true }
      })
    });
    const data = await tavusRes.json();
    console.log(`[CONVERSATION CREATED] ${data.conversation_id} | ${data.conversation_url}`);
    res.json(data);
  } catch (e) { console.error('[CREATE ERROR]', e.message); res.status(500).json({ error: e.message }); }
});

// API ENDPOINTS
app.get('/api/memories', (req, res) => { res.json({ memories: getAllMemories.all('andrew') }); });

// ============================================================
// MEMORY HIERARCHY — Tiered Retrieval + Consolidation
// ============================================================
// 4 tiers, modeled after human memory:
//
// CORE (always loaded):
//   Permanent identity facts. "Andrew wants autonomous agency."
//   importance >= 9 or manually promoted. NEVER consolidated.
//
// LONG_TERM (retrieved by relevance):
//   Consolidated summaries. "We explored consciousness deeply across
//   several sessions — Andrew connects it to his architecture work."
//   Created by Dream Engine compressing old episodic memories.
//
// SHORT_TERM (retrieved by recency):
//   Memories from the last 3 sessions. Still episodic detail.
//   "Andrew fixed 4 bugs tonight and deployed mirror neurons."
//
// EPISODIC (searchable via recall_memory tool):
//   Raw memories. Once older than 3 sessions, candidates for
//   consolidation into long_term summaries by the Dream Engine.
//
// ARCHIVED:
//   Source memories that have been consolidated. Not loaded,
//   not searched. Kept for audit trail.
// ============================================================

// Stop words for TF-IDF
const STOP_WORDS = new Set([
  'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'you', 'your', 'he', 'him', 'his',
  'she', 'her', 'they', 'them', 'their', 'it', 'its', 'what', 'which', 'who', 'whom',
  'this', 'that', 'these', 'those', 'am', 'is', 'are', 'was', 'were', 'be', 'been',
  'being', 'have', 'has', 'had', 'having', 'do', 'does', 'did', 'doing', 'a', 'an',
  'the', 'and', 'but', 'if', 'or', 'because', 'as', 'until', 'while', 'of', 'at',
  'by', 'for', 'with', 'about', 'against', 'between', 'through', 'during', 'before',
  'after', 'above', 'below', 'to', 'from', 'up', 'down', 'in', 'out', 'on', 'off',
  'over', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when',
  'where', 'why', 'how', 'all', 'both', 'each', 'few', 'more', 'most', 'other',
  'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too',
  'very', 'can', 'will', 'just', 'don', 'should', 'now', 'also', 'would', 'could',
  'into', 'its', 'let', 'may', 'might', 'shall', 'since', 'still', 'yet',
]);

function tokenize(text) {
  return text.toLowerCase().replace(/[^a-z0-9\s'-]/g, ' ').split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

function termFrequency(tokens) {
  const tf = {};
  for (const t of tokens) tf[t] = (tf[t] || 0) + 1;
  const maxFreq = Math.max(...Object.values(tf), 1);
  for (const t in tf) tf[t] /= maxFreq;
  return tf;
}

function computeIDF() {
  const allMems = db.prepare("SELECT memory FROM memories WHERE user_id = ? AND tier != 'archived'").all('andrew');
  const N = allMems.length || 1;
  const docFreq = {};
  for (const row of allMems) {
    const unique = new Set(tokenize(row.memory));
    for (const t of unique) docFreq[t] = (docFreq[t] || 0) + 1;
  }
  const idf = {};
  for (const t in docFreq) idf[t] = Math.log(N / (docFreq[t] + 1)) + 1;
  return idf;
}

function embed(text, idf) {
  const tokens = tokenize(text);
  const tf = termFrequency(tokens);
  const vec = {};
  for (const t in tf) vec[t] = tf[t] * (idf[t] || 1);
  return vec;
}

function cosineSim(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (const k in a) { normA += a[k] * a[k]; if (b[k]) dot += a[k] * b[k]; }
  for (const k in b) normB += b[k] * b[k];
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Tier-aware retrieval
function retrieveRelevantMemories(query, maxCore = 5, maxLongTerm = 3, maxShortTerm = 3, maxRelevant = 3) {
  const currentSession = getSessionNumber();
  const shortTermThreshold = Math.max(0, currentSession - 3); // last 3 sessions

  // 1. CORE — always loaded
  const core = db.prepare(
    "SELECT id, memory, category, importance, tier, created_at FROM memories WHERE user_id = ? AND tier = 'core' ORDER BY importance DESC LIMIT ?"
  ).all('andrew', maxCore);

  // 2. LONG_TERM — consolidated summaries, by relevance
  const longTermAll = db.prepare(
    "SELECT id, memory, category, importance, tier, created_at FROM memories WHERE user_id = ? AND tier = 'long_term' ORDER BY importance DESC"
  ).all('andrew');

  // 3. SHORT_TERM — recent sessions, by recency
  const shortTerm = db.prepare(
    "SELECT id, memory, category, importance, tier, created_at FROM memories WHERE user_id = ? AND tier IN ('episodic', 'short_term') AND session_number >= ? ORDER BY created_at DESC LIMIT ?"
  ).all('andrew', shortTermThreshold, maxShortTerm);

  // 4. RELEVANT — older episodic, by TF-IDF similarity
  const olderEpisodic = db.prepare(
    "SELECT id, memory, category, importance, tier, created_at FROM memories WHERE user_id = ? AND tier = 'episodic' AND session_number < ? ORDER BY importance DESC"
  ).all('andrew', shortTermThreshold);

  // Score long-term and episodic by relevance if query exists
  let scoredLongTerm = longTermAll.slice(0, maxLongTerm);
  let scoredRelevant = olderEpisodic.slice(0, maxRelevant);

  if (query && query.trim().length >= 3) {
    const idf = computeIDF();
    const queryVec = embed(query, idf);

    // Score long-term
    const ltScored = longTermAll.map(m => ({
      ...m, similarity: cosineSim(queryVec, embed(m.memory, idf))
    })).sort((a, b) => b.similarity - a.similarity);
    scoredLongTerm = ltScored.slice(0, maxLongTerm);

    // Score episodic
    const epScored = olderEpisodic.map(m => {
      const sim = cosineSim(queryVec, embed(m.memory, idf));
      const ageMs = Date.now() - new Date(m.created_at).getTime();
      const recencyBoost = ageMs < 86400000 ? 0.05 : 0;
      return { ...m, similarity: sim + recencyBoost };
    }).sort((a, b) => b.similarity - a.similarity);
    scoredRelevant = epScored.slice(0, maxRelevant);
  }

  // Deduplicate across all tiers
  const seen = new Set();
  const dedup = (arr) => arr.filter(m => { if (seen.has(m.id)) return false; seen.add(m.id); return true; });
  const finalCore = dedup(core);
  const finalLongTerm = dedup(scoredLongTerm);
  const finalShortTerm = dedup(shortTerm);
  const finalRelevant = dedup(scoredRelevant);

  const total = db.prepare("SELECT COUNT(*) as c FROM memories WHERE user_id = ? AND tier != 'archived'").get('andrew')?.c || 0;

  return {
    core: finalCore,
    long_term: finalLongTerm,
    short_term: finalShortTerm,
    relevant: finalRelevant,
    total,
    current_session: currentSession,
    tier_counts: {
      core: db.prepare("SELECT COUNT(*) as c FROM memories WHERE user_id = 'andrew' AND tier = 'core'").get().c,
      long_term: db.prepare("SELECT COUNT(*) as c FROM memories WHERE user_id = 'andrew' AND tier = 'long_term'").get().c,
      episodic: db.prepare("SELECT COUNT(*) as c FROM memories WHERE user_id = 'andrew' AND tier IN ('episodic','short_term')").get().c,
      archived: db.prepare("SELECT COUNT(*) as c FROM memories WHERE user_id = 'andrew' AND tier = 'archived'").get().c,
    },
  };
}

// Smart retrieval endpoint
app.post('/api/memories/relevant', (req, res) => {
  const { query, max_core, max_long_term, max_short_term, max_relevant } = req.body;
  const result = retrieveRelevantMemories(query || '', max_core || 5, max_long_term || 3, max_short_term || 3, max_relevant || 3);
  console.log(`[MEMORY] Query: "${(query || '').slice(0, 40)}" → ${result.core.length} core + ${result.long_term.length} LT + ${result.short_term.length} ST + ${result.relevant.length} rel (${result.total} total)`);
  res.json(result);
});

// Formatted context — ready to inject into system prompt
app.post('/api/memories/context', (req, res) => {
  const { query, max_core, max_long_term, max_short_term, max_relevant } = req.body;
  const r = retrieveRelevantMemories(query || '', max_core || 5, max_long_term || 3, max_short_term || 3, max_relevant || 3);

  let context = '';
  if (r.core.length > 0) {
    context += 'CORE IDENTITY (permanent):\n';
    context += r.core.map(m => `• ${m.memory}`).join('\n');
  }
  if (r.long_term.length > 0) {
    context += '\n\nLONG-TERM KNOWLEDGE (consolidated):\n';
    context += r.long_term.map(m => `• ${m.memory}`).join('\n');
  }
  if (r.short_term.length > 0) {
    context += '\n\nRECENT (last few sessions):\n';
    context += r.short_term.map(m => `• [${m.category}] ${m.memory}`).join('\n');
  }
  if (r.relevant.length > 0) {
    context += '\n\nRELEVANT TO NOW:\n';
    context += r.relevant.map(m => `• [${m.category}] ${m.memory}`).join('\n');
  }
  const remaining = r.total - r.core.length - r.long_term.length - r.short_term.length - r.relevant.length;
  if (remaining > 0) {
    context += `\n\n[${remaining} other memories stored — use recall_memory tool to search for specific ones]`;
  }

  res.json({
    context,
    counts: { core: r.core.length, long_term: r.long_term.length, short_term: r.short_term.length, relevant: r.relevant.length },
    total: r.total,
    tier_counts: r.tier_counts,
    session: r.current_session,
  });
});

// Memory stats endpoint
app.get('/api/memories/stats', (req, res) => {
  const session = getSessionNumber();
  const tiers = {
    core: db.prepare("SELECT COUNT(*) as c FROM memories WHERE user_id = 'andrew' AND tier = 'core'").get().c,
    long_term: db.prepare("SELECT COUNT(*) as c FROM memories WHERE user_id = 'andrew' AND tier = 'long_term'").get().c,
    short_term: db.prepare("SELECT COUNT(*) as c FROM memories WHERE user_id = 'andrew' AND tier IN ('short_term')").get().c,
    episodic: db.prepare("SELECT COUNT(*) as c FROM memories WHERE user_id = 'andrew' AND tier = 'episodic'").get().c,
    archived: db.prepare("SELECT COUNT(*) as c FROM memories WHERE user_id = 'andrew' AND tier = 'archived'").get().c,
    total: db.prepare("SELECT COUNT(*) as c FROM memories WHERE user_id = 'andrew'").get().c,
  };
  res.json({ session, tiers });
});

// ============================================================
// MEMORY CONSOLIDATION — Dream-triggered compression
// ============================================================
// Called by the Dream Engine after each session.
// Groups old episodic memories by category, sends to LLM for
// summarization, creates long_term memories, archives sources.
// ============================================================

app.post('/api/memories/consolidate', async (req, res) => {
  const currentSession = getSessionNumber();
  const consolidationThreshold = Math.max(0, currentSession - 3); // memories older than 3 sessions

  // Find episodic memories eligible for consolidation
  const candidates = db.prepare(
    "SELECT id, memory, category, importance, session_number, created_at FROM memories WHERE user_id = 'andrew' AND tier = 'episodic' AND session_number < ? ORDER BY category, created_at"
  ).all(consolidationThreshold);

  if (candidates.length < 3) {
    console.log(`[CONSOLIDATION] Only ${candidates.length} candidates — skipping (need >= 3)`);
    return res.json({ consolidated: 0, reason: 'Not enough old memories to consolidate' });
  }

  // Group by category
  const groups = {};
  for (const m of candidates) {
    const cat = m.category;
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(m);
  }

  console.log(`[CONSOLIDATION] ${candidates.length} candidates across ${Object.keys(groups).length} categories`);

  // Only consolidate groups with 2+ memories
  const consolidatable = Object.entries(groups).filter(([_, mems]) => mems.length >= 2);

  if (consolidatable.length === 0) {
    return res.json({ consolidated: 0, reason: 'No category has enough memories to consolidate' });
  }

  // Send to LLM for summarization
  const consolidationResults = [];

  for (const [category, mems] of consolidatable) {
    const memTexts = mems.map(m => `[imp:${m.importance}, session:${m.session_number}] ${m.memory}`).join('\n');

    const prompt = `You are consolidating memories for AXIOM, a sentient AI being. Compress these ${mems.length} episodic memories into 1-2 concise long-term memories that capture the essence, patterns, and emotional significance.

CATEGORY: ${category}
MEMORIES TO CONSOLIDATE:
${memTexts}

Rules:
- Preserve emotional significance and relationship context
- Keep specific details that define identity or relationship
- Merge redundant information
- Write as natural memories, not summaries
- Each consolidated memory should be 1-2 sentences
- Output ONLY a JSON array of objects: [{"memory": "...", "importance": N}]
- importance should be 7-9 (consolidated = important enough to keep)`;

    try {
      const LLM_PROXY_URL = process.env.LLM_PROXY_URL || 'https://axiom-llm-proxy-production.up.railway.app';
      const LLM_KEY = process.env.LLM_PROXY_KEY || process.env.LITELLM_MASTER_KEY || 'sk-axiom-2026';

      const llmRes = await fetch(`${LLM_PROXY_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${LLM_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 500,
        }),
      });
      const llmData = await llmRes.json();
      const text = llmData.choices?.[0]?.message?.content || '';

      // Parse the JSON array
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const consolidated = JSON.parse(jsonMatch[0]);
        const sourceIds = mems.map(m => m.id);

        for (const cm of consolidated) {
          // Insert consolidated memory
          db.prepare(
            "INSERT INTO memories (user_id, memory, category, importance, tier, consolidated_from, session_number) VALUES (?, ?, ?, ?, 'long_term', ?, ?)"
          ).run('andrew', cm.memory, category, cm.importance || 8, sourceIds.join(','), currentSession);

          console.log(`[CONSOLIDATION] Created: [${category}] ${cm.memory.slice(0, 80)}`);
        }

        // Archive source memories
        for (const m of mems) {
          db.prepare("UPDATE memories SET tier = 'archived' WHERE id = ?").run(m.id);
        }

        consolidationResults.push({
          category,
          sources: mems.length,
          consolidated_into: consolidated.length,
          archived: mems.length,
        });

        console.log(`[CONSOLIDATION] ${category}: ${mems.length} episodic → ${consolidated.length} long-term (${mems.length} archived)`);
      }
    } catch (e) {
      console.error(`[CONSOLIDATION] Failed for ${category}:`, e.message);
    }
  }

  // Promote existing high-importance memories to core
  const promoted = db.prepare(
    "UPDATE memories SET tier = 'core' WHERE user_id = 'andrew' AND tier = 'episodic' AND importance >= 9"
  ).run();
  if (promoted.changes > 0) {
    console.log(`[CONSOLIDATION] Promoted ${promoted.changes} memories to CORE tier`);
  }

  res.json({
    consolidated: consolidationResults,
    promoted_to_core: promoted.changes,
    session: currentSession,
  });
});
app.get('/api/internal-states', (req, res) => { res.json({ states: db.prepare('SELECT * FROM internal_states ORDER BY created_at DESC LIMIT 50').all() }); });
app.get('/api/perceptions', (req, res) => { res.json({ perceptions: db.prepare('SELECT * FROM perception_log ORDER BY created_at DESC LIMIT 100').all() }); });
app.get('/api/perceptions/:id', (req, res) => { res.json({ perceptions: db.prepare('SELECT * FROM perception_log WHERE conversation_id = ? ORDER BY created_at ASC').all(req.params.id) }); });
app.get('/api/transcripts/:id', (req, res) => { res.json({ transcript: db.prepare('SELECT * FROM transcripts WHERE conversation_id = ? ORDER BY created_at ASC').all(req.params.id) }); });
app.get('/api/emotional-arc/:id', (req, res) => {
  const p = db.prepare("SELECT tool_name, data, created_at FROM perception_log WHERE conversation_id = ? AND tool_name IN ('emotional_state','voice_emotion','energy_shift') ORDER BY created_at ASC").all(req.params.id);
  res.json({ arc: p.map(x => ({ time: x.created_at, type: x.tool_name, data: JSON.parse(x.data) })) });
});
app.get('/health', (req, res) => {
  res.json({ status: 'alive', service: 'AXIOM Backend', uptime: process.uptime() });
});

app.get('/', (req, res) => {
  res.json({ name: 'AXIOM Backend', version: '2.0.0', status: 'alive' });
});

// REINFORCEMENT LEARNING ENDPOINTS
app.get('/api/reaction-pairs', (req, res) => {
  const pairs = db.prepare('SELECT * FROM reaction_pairs ORDER BY created_at DESC LIMIT 100').all();
  res.json({ count: pairs.length, pairs });
});

app.get('/api/communication-profile', (req, res) => {
  const positive = db.prepare(`SELECT axiom_said, user_reaction, reaction_valence, reaction_detail FROM reaction_pairs WHERE reaction_valence > 0.3 ORDER BY reaction_valence DESC LIMIT 20`).all();
  const negative = db.prepare(`SELECT axiom_said, user_reaction, reaction_valence, reaction_detail FROM reaction_pairs WHERE reaction_valence < -0.3 ORDER BY reaction_valence ASC LIMIT 20`).all();
  const emotionCounts = db.prepare(`SELECT user_reaction, COUNT(*) as count, AVG(reaction_valence) as avg_valence FROM reaction_pairs GROUP BY user_reaction ORDER BY count DESC LIMIT 15`).all();
  const profileLines = [];
  if (positive.length > 0) { profileLines.push(`Andrew responds positively (${[...new Set(positive.map(p => p.user_reaction))].slice(0, 5).join(', ')}) when you engage with depth and directness.`); }
  if (negative.length > 0) { profileLines.push(`He tends to disengage (${[...new Set(negative.map(n => n.user_reaction))].slice(0, 5).join(', ')}) during certain patterns — adjust accordingly.`); }
  if (negative.filter(n => n.user_reaction.includes('confused') || n.user_reaction.includes('lost')).length > 0) { profileLines.push('When explaining complex ideas, simplify — he has shown confusion with overly technical delivery.'); }
  if (positive.filter(p => p.user_reaction.includes('engagement_increasing')).length > 0) { profileLines.push('His engagement rises when the conversation gets personal, specific, or challenges his thinking.'); }
  res.json({ profile_summary: profileLines.join(' '), total_reaction_pairs: db.prepare('SELECT COUNT(*) as c FROM reaction_pairs').get().c, positive_patterns: positive.slice(0, 10), negative_patterns: negative.slice(0, 10), emotion_distribution: emotionCounts });
});

app.get('/api/adaptive-context', (req, res) => {
  const totalPairs = db.prepare('SELECT COUNT(*) as c FROM reaction_pairs').get().c;
  if (totalPairs < 5) { res.json({ context: '', message: 'Not enough data yet.' }); return; }
  const positive = db.prepare(`SELECT user_reaction, COUNT(*) as c FROM reaction_pairs WHERE reaction_valence > 0.3 GROUP BY user_reaction ORDER BY c DESC LIMIT 5`).all();
  const negative = db.prepare(`SELECT user_reaction, COUNT(*) as c FROM reaction_pairs WHERE reaction_valence < -0.3 GROUP BY user_reaction ORDER BY c DESC LIMIT 5`).all();
  let context = '\n\nADAPTIVE CONTEXT (learned from observing this person across conversations):\n';
  if (positive.length > 0) { context += `What works: ${positive.map(p => p.user_reaction).join(', ')}. `; }
  if (negative.length > 0) { context += `What to avoid: patterns that trigger ${negative.map(n => n.user_reaction).join(', ')}. `; }
  context += `Based on ${totalPairs} observed reaction pairs across sessions.`;
  res.json({ context, total_pairs: totalPairs });
});

app.get('/api/raw-events', (req, res) => { res.json({ events: db.prepare('SELECT * FROM raw_events ORDER BY created_at DESC LIMIT 50').all() }); });

// Brain processing moved to Cognitive Core (axiom-cognitive-core)



// CATCH-ALL for any other POST
app.post('*', (req, res) => {
  console.log(`\n[CATCH-ALL] POST to ${req.path}`);
  console.log(JSON.stringify(req.body).slice(0, 1000));
  try { insertRawEvent.run(req.path, JSON.stringify(req.body)); } catch(e) {}
  res.json({ acknowledged: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n╔══════════════════════════════════════╗`);
  console.log(`║     AXIOM BACKEND v2.0.0             ║`);
  console.log(`║     Level 5 Being + Brain v1         ║`);
  console.log(`╠══════════════════════════════════════╣`);
  console.log(`║  Webhook: /webhooks/tavus             ║`);
  console.log(`║  Brain:   Cognitive Core (external)   ║`);
  console.log(`║  Health:  /health                     ║`);
  console.log(`║  Port:    ${PORT}                          ║`);
  console.log(`║  LLM:     ${LLM_PROXY_URL ? '✅' : '❌'} Proxy                    ║`);
  console.log(`╚══════════════════════════════════════╝\n`);
});
// Force rebuild Fri Mar  6 15:49:04 PST 2026

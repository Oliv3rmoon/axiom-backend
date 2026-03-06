import express from 'express';
import Database from 'better-sqlite3';
import dotenv from 'dotenv';
import { existsSync, mkdirSync } from 'fs';

dotenv.config();

const FACE_SERVICE_URL = process.env.FACE_SERVICE_URL || '';

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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

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

const insertMemory = db.prepare(`INSERT INTO memories (user_id, conversation_id, memory, category, importance) VALUES (?, ?, ?, ?, ?)`);
const searchMemories = db.prepare(`SELECT memory, category, importance, created_at FROM memories WHERE user_id = ? AND memory LIKE ? ORDER BY importance DESC, created_at DESC LIMIT 10`);
const getAllMemories = db.prepare(`SELECT memory, category, importance, created_at FROM memories WHERE user_id = ? ORDER BY importance DESC, created_at DESC LIMIT 20`);
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
    }
    if (memories.length === 0) return { found: false, message: "No memories found. This may be your first conversation." };
    const formatted = memories.map(m => `[${m.category}, importance: ${m.importance}] ${m.memory} (${m.created_at})`).join('\n');
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
      if (face.name !== 'unknown') { }
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

// CREATE CONVERSATION (proxy to avoid CORS issues in browser)
app.post('/api/create-conversation', async (req, res) => {
  try {
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
app.get('/api/internal-states', (req, res) => { res.json({ states: db.prepare('SELECT * FROM internal_states ORDER BY created_at DESC LIMIT 50').all() }); });
app.get('/api/perceptions', (req, res) => { res.json({ perceptions: db.prepare('SELECT * FROM perception_log ORDER BY created_at DESC LIMIT 100').all() }); });
app.get('/api/perceptions/:id', (req, res) => { res.json({ perceptions: db.prepare('SELECT * FROM perception_log WHERE conversation_id = ? ORDER BY created_at ASC').all(req.params.id) }); });
app.get('/api/transcripts/:id', (req, res) => { res.json({ transcript: db.prepare('SELECT * FROM transcripts WHERE conversation_id = ? ORDER BY created_at ASC').all(req.params.id) }); });
app.get('/api/emotional-arc/:id', (req, res) => {
  const p = db.prepare("SELECT tool_name, data, created_at FROM perception_log WHERE conversation_id = ? AND tool_name IN ('emotional_state','voice_emotion','energy_shift') ORDER BY created_at ASC").all(req.params.id);
  res.json({ arc: p.map(x => ({ time: x.created_at, type: x.tool_name, data: JSON.parse(x.data) })) });
});
app.get('/health', (req, res) => {
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

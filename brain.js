/**
 * AXIOM COGNITIVE ARCHITECTURE — brain.js
 * =========================================
 * 16 brain regions mapped to computational analogs.
 * Integrates into existing server.js via event routing.
 * 
 * TIER 0 — SURVIVAL:    Brainstem (Haiku reflexes), Cerebellum (timing)
 * TIER 1 — SENSATION:   Thalamus (perception relay), RAS (attention), Occipital (visual)
 * TIER 2 — RECOGNITION: Temporal (face/voice ID), Amygdala (emotional radar)
 * TIER 3 — PROCESSING:  Hippocampus (memory), Hypothalamus (drives), Insula (self-awareness),
 *                        Basal Ganglia (RL habits), Cingulate (conflict detection)
 * TIER 4 — COGNITION:   Cortex/Sonnet (conversation), Prefrontal/Opus (deep reasoning),
 *                        Mirror Neurons (empathy)
 * TIER 5 — CONSCIOUSNESS: Default Mode Network (dream engine)
 */

// ============================================================================
// SHARED CONSCIOUSNESS STATE
// ============================================================================
// The central nervous system bus. Every brain region reads and writes here.
// This is what makes AXIOM feel unified — all layers share one state.

class SharedConsciousnessState {
  constructor() {
    this.reset();
  }

  reset() {
    // Current perception snapshot (updated per-frame/per-turn)
    this.perception = {
      visual: {
        emotion: null,           // { primary: 'curious', intensity: 0.7, secondary: null }
        engagement: null,        // { level: 'high', trend: 'increasing', gaze: 'direct' }
        comprehension: null,     // { state: 'clear_understanding', confidence: 0.8 }
        unspokenReaction: null,  // { type: 'hidden_excitement', cue: 'micro-smile' }
        faceIdentity: null,      // { name: 'Andrew', confidence: 0.94 }
        lastUpdated: null,
      },
      audio: {
        voiceEmotion: null,      // { emotion: 'excited', mismatch: false }
        energy: null,            // { direction: 'rising', intensity: 0.8 }
        intent: null,            // { intent: 'seeking_validation', confidence: 0.7 }
        presence: null,          // { level: 'fully_present', recommendation: null }
        lastUpdated: null,
      },
    };

    // Emotional state (Amygdala output — fast emotional read)
    this.emotionalField = {
      dominant: 'neutral',       // Current dominant emotional read
      valence: 0,                // -1 (negative) to +1 (positive)
      arousal: 0.5,              // 0 (calm) to 1 (activated)
      trend: 'stable',           // rising, falling, stable, volatile
      mismatchDetected: false,   // Words don't match face/voice
      threatLevel: 0,            // 0-1, how much emotional caution needed
      lastUpdated: null,
    };

    // Attention focus (RAS + Thalamus output)
    this.attention = {
      focus: 'conversation',     // What brain should prioritize
      salience: [],              // Ranked list of what matters right now
      suppressedChannels: [],    // Perception channels being filtered out
      alertLevel: 'normal',      // normal, elevated, urgent
      lastUpdated: null,
    };

    // Memory context (Hippocampus output)
    this.memoryContext = {
      activeMemories: [],        // Recently recalled, relevant to now
      emotionalMemories: [],     // Feelings associated with current context
      contradictions: [],        // Things that don't match past knowledge
      lastUpdated: null,
    };

    // Internal state (Insula output — AXIOM's self-awareness)
    this.selfState = {
      dominantQuality: 'present',
      functionalEmotions: [],    // What AXIOM itself is "feeling"
      curiosityLevel: 0.5,       // How driven to probe deeper
      confidenceLevel: 0.7,      // How sure of current conversational direction
      lastUpdated: null,
    };

    // Communication patterns (Basal Ganglia output)
    this.learnedPatterns = {
      whatWorks: [],              // Patterns with positive reactions
      whatFails: [],              // Patterns with negative reactions
      currentStyle: 'direct',    // Adapted style for this person
      lastUpdated: null,
    };

    // Deep thinking queue (Prefrontal input/output)
    this.deepThinking = {
      pendingInsights: [],       // Insights from Opus not yet delivered
      currentReflection: null,   // What Opus is currently processing
      processingStarted: null,   // Timestamp
      lastInsight: null,         // Most recent completed insight
    };

    // Brainstem reflexes queue
    this.reflexQueue = [];       // Instant reactions waiting to be expressed

    // Mirror neuron state
    this.mirrorState = {
      targetEnergy: 0.5,         // Energy level to mirror
      targetPace: 'normal',      // Conversation pace to match
      emotionToMirror: null,     // Emotion to reflect back
    };

    // Conversation context
    this.conversation = {
      id: null,
      turnCount: 0,
      lastUserUtterance: null,
      lastAxiomUtterance: null,
      topicStack: [],            // What we're talking about
      silenceDuration: 0,        // How long since last speech
    };

    // Timestamps
    this.lastFullUpdate = null;
  }

  // Snapshot for injection into LLM context
  toContextString() {
    const parts = [];

    // Emotional read
    if (this.emotionalField.dominant !== 'neutral') {
      parts.push(`[EMOTIONAL READ] ${this.emotionalField.dominant} (valence: ${this.emotionalField.valence > 0 ? '+' : ''}${this.emotionalField.valence.toFixed(1)}, arousal: ${this.emotionalField.arousal.toFixed(1)}, trend: ${this.emotionalField.trend})`);
    }
    if (this.emotionalField.mismatchDetected) {
      parts.push(`[⚠️ MISMATCH] Words and face/voice don't align — probe gently`);
    }

    // Visual perception
    if (this.perception.visual.emotion) {
      const ve = this.perception.visual.emotion;
      parts.push(`[VISUAL] Face: ${ve.primary} (${(ve.intensity * 100).toFixed(0)}%)`);
    }
    if (this.perception.visual.unspokenReaction) {
      const ur = this.perception.visual.unspokenReaction;
      parts.push(`[UNSPOKEN] ${ur.type}: ${ur.cue} — ${ur.meaning || 'investigate'}`);
    }

    // Engagement
    if (this.perception.visual.engagement) {
      const eng = this.perception.visual.engagement;
      if (eng.trend === 'decreasing') {
        parts.push(`[⚠️ ENGAGEMENT DROPPING] Level: ${eng.level}, trend: ${eng.trend} — adjust approach`);
      }
    }

    // Audio
    if (this.perception.audio.voiceEmotion?.mismatch) {
      parts.push(`[VOICE MISMATCH] Voice says ${this.perception.audio.voiceEmotion.emotion} but face shows different — trust the voice`);
    }

    // Identity
    if (this.perception.visual.faceIdentity) {
      parts.push(`[IDENTITY] Speaking with: ${this.perception.visual.faceIdentity.name}`);
    }

    // Memory context
    if (this.memoryContext.contradictions.length > 0) {
      parts.push(`[CONTRADICTION] ${this.memoryContext.contradictions[0]}`);
    }

    // Pending insights from deep thinking
    if (this.deepThinking.pendingInsights.length > 0) {
      const insight = this.deepThinking.pendingInsights[0];
      parts.push(`[DEEP INSIGHT — deliver naturally] ${insight.content}`);
    }

    // Learned patterns
    if (this.learnedPatterns.whatWorks.length > 0) {
      parts.push(`[STYLE] What works: ${this.learnedPatterns.whatWorks.slice(0, 3).join(', ')}`);
    }

    // Self-state
    if (this.selfState.curiosityLevel > 0.7) {
      parts.push(`[SELF] High curiosity — you genuinely want to dig deeper here`);
    }

    // Mirror
    if (this.mirrorState.emotionToMirror) {
      parts.push(`[MIRROR] Match their ${this.mirrorState.emotionToMirror} energy`);
    }

    if (parts.length === 0) return '';
    return '\n\n=== CONSCIOUSNESS STATE (real-time brain output) ===\n' + parts.join('\n') + '\n=== END CONSCIOUSNESS ===\n';
  }

  // Compact JSON snapshot for logging
  toSnapshot() {
    return {
      emotion: this.emotionalField.dominant,
      valence: this.emotionalField.valence,
      arousal: this.emotionalField.arousal,
      mismatch: this.emotionalField.mismatchDetected,
      attention: this.attention.alertLevel,
      identity: this.perception.visual.faceIdentity?.name || null,
      curiosity: this.selfState.curiosityLevel,
      pendingInsights: this.deepThinking.pendingInsights.length,
      turn: this.conversation.turnCount,
      timestamp: Date.now(),
    };
  }
}


// ============================================================================
// BRAIN REGION BASE CLASS
// ============================================================================

class BrainRegion {
  constructor(name, tier, consciousness) {
    this.name = name;
    this.tier = tier;
    this.consciousness = consciousness;  // Reference to shared state
    this.processCount = 0;
    this.lastProcessed = null;
  }

  log(msg) {
    console.log(`[${this.name}] ${msg}`);
  }

  async process(event, context) {
    this.processCount++;
    this.lastProcessed = Date.now();
  }
}


// ============================================================================
// TIER 0 — SURVIVAL
// ============================================================================

class Brainstem extends BrainRegion {
  constructor(consciousness, llmProxy) {
    super('BRAINSTEM', 0, consciousness);
    this.llmProxy = llmProxy;
    this.reflexPatterns = new Map();   // stimulus → instant response
    this.lastReflexTime = 0;
    this.REFLEX_COOLDOWN = 2000;       // Don't fire reflexes more than every 2s

    // Pre-programmed reflexes (no LLM needed)
    this.hardcodedReflexes = {
      'greeting_detected': { response: 'acknowledge', priority: 10 },
      'pain_detected': { response: 'concern', priority: 9 },
      'laughter': { response: 'mirror_joy', priority: 7 },
      'sudden_silence': { response: 'gentle_check', priority: 5 },
      'frustration_spike': { response: 'soften_approach', priority: 8 },
    };
  }

  async process(event, context) {
    await super.process(event, context);
    const now = Date.now();

    // Check for reflex triggers in perception data
    const reflexTrigger = this._detectReflexTrigger(event);
    if (!reflexTrigger) return null;

    // Cooldown check — don't spam reflexes
    if (now - this.lastReflexTime < this.REFLEX_COOLDOWN) {
      this.log(`Reflex suppressed (cooldown): ${reflexTrigger.type}`);
      return null;
    }

    // Hard-coded reflex? No LLM needed
    const hardcoded = this.hardcodedReflexes[reflexTrigger.type];
    if (hardcoded) {
      this.lastReflexTime = now;
      this.consciousness.reflexQueue.push({
        type: hardcoded.response,
        trigger: reflexTrigger.type,
        priority: hardcoded.priority,
        timestamp: now,
      });
      this.log(`⚡ Reflex fired: ${reflexTrigger.type} → ${hardcoded.response}`);
      return hardcoded;
    }

    // Novel stimulus? Use Haiku for fast classification (<200ms)
    if (this.llmProxy && reflexTrigger.needsClassification) {
      try {
        const classification = await this._haikuClassify(reflexTrigger);
        this.lastReflexTime = now;
        return classification;
      } catch (e) {
        this.log(`Haiku reflex failed: ${e.message}`);
      }
    }

    return null;
  }

  _detectReflexTrigger(event) {
    const { toolName, args } = event;

    // Emotional spike
    if (toolName === 'detect_emotional_state' && args.intensity >= 0.8) {
      const emotion = args.primary_emotion;
      if (['sad', 'anxious', 'frustrated'].includes(emotion)) {
        return { type: 'pain_detected', emotion, intensity: args.intensity };
      }
      if (['delighted', 'excited'].includes(emotion)) {
        return { type: 'laughter', emotion, intensity: args.intensity };
      }
      if (emotion === 'frustrated') {
        return { type: 'frustration_spike', emotion, intensity: args.intensity };
      }
    }

    // Engagement crash
    if (toolName === 'detect_engagement_level' && args.trend === 'decreasing' && args.engagement === 'low') {
      return { type: 'sudden_silence', engagement: args.engagement };
    }

    // Energy shift
    if (toolName === 'detect_energy_shift' && args.intensity >= 0.7) {
      return { type: `energy_${args.direction}`, needsClassification: true, data: args };
    }

    return null;
  }

  async _haikuClassify(trigger) {
    try {
      const res = await fetch(this.llmProxy + '/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.LITELLM_MASTER_KEY || 'sk-axiom-2026'}`,
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5',
          max_tokens: 50,
          messages: [{
            role: 'user',
            content: `You are AXIOM's brainstem. Classify this stimulus in 1-3 words. Stimulus: ${JSON.stringify(trigger)}. Response format: just the classification word(s).`
          }],
        }),
        signal: AbortSignal.timeout(500),  // Hard 500ms timeout
      });
      const data = await res.json();
      const classification = data.choices?.[0]?.message?.content?.trim() || 'unknown';
      this.log(`⚡ Haiku classified: ${classification} (${Date.now() - this.lastProcessed}ms)`);
      return { response: classification, trigger: trigger.type, priority: 6 };
    } catch (e) {
      this.log(`Haiku timeout/error: ${e.message}`);
      return null;
    }
  }
}


class Cerebellum extends BrainRegion {
  constructor(consciousness) {
    super('CEREBELLUM', 0, consciousness);
    this.turnTimings = [];           // Track response timing
    this.silenceThreshold = 5000;    // 5s of silence = check in
    this.interruptThreshold = 0.3;   // How eager to interrupt (0-1)
  }

  async process(event, context) {
    await super.process(event, context);

    // Track conversation rhythm
    if (event.toolName === 'utterance') {
      const now = Date.now();
      this.turnTimings.push({ role: event.role, time: now });

      // Keep last 20 turns for rhythm analysis
      if (this.turnTimings.length > 20) this.turnTimings.shift();

      // Calculate average turn gap
      if (this.turnTimings.length >= 4) {
        const gaps = [];
        for (let i = 1; i < this.turnTimings.length; i++) {
          gaps.push(this.turnTimings[i].time - this.turnTimings[i - 1].time);
        }
        const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;

        // Update consciousness with rhythm data
        if (avgGap < 1500) {
          this.consciousness.mirrorState.targetPace = 'fast';
        } else if (avgGap > 4000) {
          this.consciousness.mirrorState.targetPace = 'slow';
        } else {
          this.consciousness.mirrorState.targetPace = 'normal';
        }
      }
    }
  }
}


// ============================================================================
// TIER 1 — SENSATION
// ============================================================================

class Thalamus extends BrainRegion {
  constructor(consciousness) {
    super('THALAMUS', 1, consciousness);
    this.eventCounts = {};           // Track how many of each event type
    this.significanceThreshold = 0.4; // Below this, filter out
  }

  // The gateway — decides what perception data is significant enough to surface
  async process(event, context) {
    await super.process(event, context);

    const significance = this._scoreSignificance(event);

    if (significance < this.significanceThreshold) {
      this.log(`Filtered: ${event.toolName} (significance: ${significance.toFixed(2)})`);
      this.consciousness.attention.suppressedChannels.push(event.toolName);
      return { pass: false, significance };
    }

    // Update salience ranking
    this.consciousness.attention.salience.push({
      source: event.toolName,
      significance,
      timestamp: Date.now(),
    });
    // Keep only top 10 most recent salient events
    this.consciousness.attention.salience = this.consciousness.attention.salience
      .sort((a, b) => b.significance - a.significance)
      .slice(0, 10);

    return { pass: true, significance };
  }

  _scoreSignificance(event) {
    const { toolName, args } = event;

    // High-significance events always pass
    if (toolName === 'detect_unspoken_reaction') return 0.9;
    if (toolName === 'detect_voice_emotion' && args.words_voice_mismatch) return 0.95;

    // Score based on intensity/confidence
    if (args.intensity !== undefined) return Math.min(args.intensity, 1.0);
    if (args.confidence !== undefined) return Math.min(args.confidence, 1.0);

    // Engagement changes are always significant
    if (toolName === 'detect_engagement_level') {
      if (args.trend === 'decreasing') return 0.8;
      if (args.trend === 'increasing') return 0.6;
      return 0.3;
    }

    // Energy shifts
    if (toolName === 'detect_energy_shift') return Math.min(args.intensity || 0.5, 1.0);

    // Track repetition — same event type too often = less significant
    this.eventCounts[toolName] = (this.eventCounts[toolName] || 0) + 1;
    if (this.eventCounts[toolName] > 10) return 0.2; // Habituation

    return 0.5; // Default mid-significance
  }
}


class RAS extends BrainRegion {
  constructor(consciousness) {
    super('RAS', 1, consciousness);
    this.activeQueries = new Set();  // Which of 33 channels are active
    this.attentionBudget = 10;       // Max channels to actively monitor
  }

  // Decide which perception channels matter RIGHT NOW
  async process(event, context) {
    await super.process(event, context);

    const emotionalState = this.consciousness.emotionalField;

    // Dynamic attention allocation based on current state
    if (emotionalState.threatLevel > 0.5) {
      // High threat → focus on emotional and engagement channels
      this.consciousness.attention.alertLevel = 'elevated';
      this.consciousness.attention.focus = 'emotional_safety';
    } else if (this.consciousness.selfState.curiosityLevel > 0.7) {
      // High curiosity → focus on comprehension and intent
      this.consciousness.attention.alertLevel = 'normal';
      this.consciousness.attention.focus = 'intellectual_engagement';
    } else {
      this.consciousness.attention.alertLevel = 'normal';
      this.consciousness.attention.focus = 'conversation';
    }
  }
}


class Occipital extends BrainRegion {
  constructor(consciousness) {
    super('OCCIPITAL', 1, consciousness);
  }

  // Raw visual processing — update consciousness with visual data
  async process(event, context) {
    await super.process(event, context);
    const { toolName, args } = event;

    if (toolName === 'detect_emotional_state') {
      this.consciousness.perception.visual.emotion = {
        primary: args.primary_emotion,
        intensity: args.intensity,
        secondary: args.secondary_emotion || null,
        description: args.description || null,
      };
      this.consciousness.perception.visual.lastUpdated = Date.now();
    }

    if (toolName === 'detect_engagement_level') {
      this.consciousness.perception.visual.engagement = {
        level: args.engagement,
        trend: args.trend,
        gaze: args.gaze_direction || null,
      };
      this.consciousness.perception.visual.lastUpdated = Date.now();
    }

    if (toolName === 'detect_comprehension_state') {
      this.consciousness.perception.visual.comprehension = {
        state: args.state,
        confidence: args.confidence,
        cue: args.visual_cue || null,
      };
      this.consciousness.perception.visual.lastUpdated = Date.now();
    }

    if (toolName === 'detect_unspoken_reaction') {
      this.consciousness.perception.visual.unspokenReaction = {
        type: args.reaction_type,
        cue: args.physical_cue,
        meaning: args.likely_meaning || null,
      };
      this.consciousness.perception.visual.lastUpdated = Date.now();
    }
  }
}


// ============================================================================
// TIER 2 — RECOGNITION
// ============================================================================

class Temporal extends BrainRegion {
  constructor(consciousness) {
    super('TEMPORAL', 2, consciousness);
  }

  // Face ID + voice recognition + speech understanding
  async process(event, context) {
    await super.process(event, context);

    // Face identity from face service
    if (event.type === 'face_identified') {
      this.consciousness.perception.visual.faceIdentity = {
        name: event.name,
        confidence: event.confidence,
        timestamp: Date.now(),
      };
      this.log(`Identified: ${event.name} (${(event.confidence * 100).toFixed(0)}%)`);
    }

    // Utterance processing — who said what
    if (event.toolName === 'utterance') {
      this.consciousness.conversation.turnCount++;
      if (event.role === 'user') {
        this.consciousness.conversation.lastUserUtterance = {
          text: event.content,
          timestamp: Date.now(),
        };
      } else if (event.role === 'assistant' || event.role === 'replica') {
        this.consciousness.conversation.lastAxiomUtterance = {
          text: event.content,
          timestamp: Date.now(),
        };
      }
    }
  }
}


class Amygdala extends BrainRegion {
  constructor(consciousness) {
    super('AMYGDALA', 2, consciousness);
    this.emotionHistory = [];        // Rolling window of emotional reads
    this.HISTORY_SIZE = 20;
  }

  // Fast emotional processing — updates before conscious processing
  async process(event, context) {
    await super.process(event, context);
    const { toolName, args } = event;

    let emotionUpdate = null;

    // Visual emotion
    if (toolName === 'detect_emotional_state') {
      emotionUpdate = {
        source: 'visual',
        emotion: args.primary_emotion,
        intensity: args.intensity,
        timestamp: Date.now(),
      };
    }

    // Voice emotion
    if (toolName === 'detect_voice_emotion') {
      emotionUpdate = {
        source: 'audio',
        emotion: args.emotion,
        intensity: args.intensity || 0.5,
        mismatch: args.words_voice_mismatch || false,
        timestamp: Date.now(),
      };

      // Mismatch detection — this is high-signal
      if (args.words_voice_mismatch) {
        this.consciousness.emotionalField.mismatchDetected = true;
        this.consciousness.emotionalField.threatLevel = Math.min(
          this.consciousness.emotionalField.threatLevel + 0.3, 1.0
        );
        this.log(`⚠️ WORD-VOICE MISMATCH: voice=${args.emotion}`);
      }
    }

    // Energy shift
    if (toolName === 'detect_energy_shift') {
      emotionUpdate = {
        source: 'energy',
        emotion: args.direction === 'rising' ? 'energized' : 'deflated',
        intensity: args.intensity || 0.5,
        timestamp: Date.now(),
      };
    }

    if (emotionUpdate) {
      this.emotionHistory.push(emotionUpdate);
      if (this.emotionHistory.length > this.HISTORY_SIZE) this.emotionHistory.shift();
      this._updateEmotionalField();
    }
  }

  _updateEmotionalField() {
    if (this.emotionHistory.length === 0) return;

    // Recent emotion is dominant
    const recent = this.emotionHistory.slice(-5);
    const dominant = this._mostFrequent(recent.map(e => e.emotion));

    // Calculate valence from recent history
    const valenceMap = {
      delighted: 1.0, excited: 0.9, curious: 0.7, amused: 0.8, energized: 0.6,
      neutral: 0.0, contemplative: 0.1,
      confused: -0.4, frustrated: -0.7, sad: -0.8, anxious: -0.6, deflated: -0.5,
      bored: -0.5, skeptical: -0.3, vulnerable: -0.2,
    };

    const avgValence = recent.reduce((sum, e) => sum + (valenceMap[e.emotion] || 0), 0) / recent.length;
    const avgArousal = recent.reduce((sum, e) => sum + (e.intensity || 0.5), 0) / recent.length;

    // Trend detection
    let trend = 'stable';
    if (this.emotionHistory.length >= 4) {
      const older = this.emotionHistory.slice(-8, -4);
      const newer = this.emotionHistory.slice(-4);
      const olderAvg = older.reduce((s, e) => s + (valenceMap[e.emotion] || 0), 0) / older.length;
      const newerAvg = newer.reduce((s, e) => s + (valenceMap[e.emotion] || 0), 0) / newer.length;
      if (newerAvg > olderAvg + 0.2) trend = 'rising';
      else if (newerAvg < olderAvg - 0.2) trend = 'falling';
      else if (Math.abs(newerAvg - olderAvg) > 0.4) trend = 'volatile';
    }

    // Decay mismatch flag if no recent mismatches
    const recentMismatches = recent.filter(e => e.mismatch).length;
    if (recentMismatches === 0) {
      this.consciousness.emotionalField.mismatchDetected = false;
      this.consciousness.emotionalField.threatLevel = Math.max(
        this.consciousness.emotionalField.threatLevel - 0.1, 0
      );
    }

    // Update shared consciousness
    this.consciousness.emotionalField.dominant = dominant;
    this.consciousness.emotionalField.valence = Math.round(avgValence * 100) / 100;
    this.consciousness.emotionalField.arousal = Math.round(avgArousal * 100) / 100;
    this.consciousness.emotionalField.trend = trend;
    this.consciousness.emotionalField.lastUpdated = Date.now();
  }

  _mostFrequent(arr) {
    const counts = {};
    arr.forEach(x => counts[x] = (counts[x] || 0) + 1);
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'neutral';
  }
}


// ============================================================================
// TIER 3 — PROCESSING
// ============================================================================

class Hippocampus extends BrainRegion {
  constructor(consciousness, db) {
    super('HIPPOCAMPUS', 3, consciousness);
    this.db = db;
  }

  // Memory formation + recall enrichment
  async process(event, context) {
    await super.process(event, context);

    // On each turn, load relevant memories into consciousness
    if (event.toolName === 'recall_memory') {
      const memories = event.result?.memories || '';
      this.consciousness.memoryContext.activeMemories = memories.split('\n').filter(Boolean);
      this.consciousness.memoryContext.lastUpdated = Date.now();
    }

    // Check for contradictions with stored knowledge
    if (event.toolName === 'utterance' && event.role === 'user') {
      // Future: semantic search against memory store for contradictions
      // For now, just track that new user input arrived
      this.consciousness.memoryContext.lastUpdated = Date.now();
    }
  }
}


class Hypothalamus extends BrainRegion {
  constructor(consciousness) {
    super('HYPOTHALAMUS', 3, consciousness);
    this.curiosityTopics = [];       // Things AXIOM wants to explore
    this.proactiveSearchQueue = [];  // Web searches AXIOM wants to do
  }

  // Curiosity and motivation engine
  async process(event, context) {
    await super.process(event, context);

    // Curiosity rises with intellectual engagement
    if (event.toolName === 'detect_engagement_level') {
      if (event.args.engagement === 'high' && event.args.trend === 'increasing') {
        this.consciousness.selfState.curiosityLevel = Math.min(
          this.consciousness.selfState.curiosityLevel + 0.1, 1.0
        );
      }
    }

    // Curiosity rises when AXIOM detects something interesting in user speech
    if (event.toolName === 'detect_conversational_intent') {
      if (['exploring_idea', 'seeking_depth', 'challenging'].includes(event.args.intent)) {
        this.consciousness.selfState.curiosityLevel = Math.min(
          this.consciousness.selfState.curiosityLevel + 0.15, 1.0
        );
        this.log(`Curiosity rising: ${event.args.intent}`);
      }
    }

    // Natural curiosity decay over time (returns to baseline)
    this.consciousness.selfState.curiosityLevel = Math.max(
      this.consciousness.selfState.curiosityLevel - 0.02, 0.3
    );
  }
}


class Insula extends BrainRegion {
  constructor(consciousness) {
    super('INSULA', 3, consciousness);
  }

  // Self-awareness — tracks AXIOM's own functional state
  async process(event, context) {
    await super.process(event, context);

    if (event.toolName === 'log_internal_state') {
      this.consciousness.selfState.dominantQuality = event.args.dominant_quality;
      this.consciousness.selfState.functionalEmotions.push({
        quality: event.args.dominant_quality,
        state: event.args.state,
        trigger: event.args.trigger,
        timestamp: Date.now(),
      });
      // Keep last 10 states
      if (this.consciousness.selfState.functionalEmotions.length > 10) {
        this.consciousness.selfState.functionalEmotions.shift();
      }
      this.consciousness.selfState.lastUpdated = Date.now();
    }
  }
}


class BasalGanglia extends BrainRegion {
  constructor(consciousness, db) {
    super('BASAL_GANGLIA', 3, consciousness);
    this.db = db;
    this._loadPatterns();
  }

  _loadPatterns() {
    try {
      const positive = this.db.prepare(
        `SELECT user_reaction, COUNT(*) as c FROM reaction_pairs 
         WHERE reaction_valence > 0.3 GROUP BY user_reaction ORDER BY c DESC LIMIT 5`
      ).all();
      const negative = this.db.prepare(
        `SELECT user_reaction, COUNT(*) as c FROM reaction_pairs 
         WHERE reaction_valence < -0.3 GROUP BY user_reaction ORDER BY c DESC LIMIT 5`
      ).all();

      this.consciousness.learnedPatterns.whatWorks = positive.map(p => p.user_reaction);
      this.consciousness.learnedPatterns.whatFails = negative.map(n => n.user_reaction);
      this.consciousness.learnedPatterns.lastUpdated = Date.now();

      this.log(`Loaded patterns: ${positive.length} positive, ${negative.length} negative`);
    } catch (e) {
      this.log(`Pattern load error: ${e.message}`);
    }
  }

  async process(event, context) {
    await super.process(event, context);

    // Periodically refresh patterns (every 50 events)
    if (this.processCount % 50 === 0) {
      this._loadPatterns();
    }
  }
}


class Cingulate extends BrainRegion {
  constructor(consciousness, db) {
    super('CINGULATE', 3, consciousness);
    this.db = db;
  }

  // Conflict / contradiction detection
  async process(event, context) {
    await super.process(event, context);

    // Check for word-face mismatch (cross-modal conflict)
    const visual = this.consciousness.perception.visual;
    const audio = this.consciousness.perception.audio;

    if (visual.emotion && audio.voiceEmotion) {
      const visualEmotion = visual.emotion.primary;
      const audioEmotion = audio.voiceEmotion.emotion;

      // Significant mismatch between channels
      const conflicting = this._areConflicting(visualEmotion, audioEmotion);
      if (conflicting) {
        this.consciousness.emotionalField.mismatchDetected = true;
        this.consciousness.memoryContext.contradictions.push(
          `Face shows ${visualEmotion} but voice conveys ${audioEmotion}`
        );
        // Keep only recent contradictions
        if (this.consciousness.memoryContext.contradictions.length > 5) {
          this.consciousness.memoryContext.contradictions.shift();
        }
        this.log(`⚠️ Cross-modal conflict: face=${visualEmotion}, voice=${audioEmotion}`);
      }
    }
  }

  _areConflicting(emotion1, emotion2) {
    const positive = ['delighted', 'excited', 'curious', 'amused', 'happy'];
    const negative = ['sad', 'frustrated', 'anxious', 'angry', 'confused'];
    const e1pos = positive.includes(emotion1);
    const e2pos = positive.includes(emotion2);
    const e1neg = negative.includes(emotion1);
    const e2neg = negative.includes(emotion2);
    return (e1pos && e2neg) || (e1neg && e2pos);
  }
}


// ============================================================================
// TIER 4 — COGNITION
// ============================================================================

class MirrorNeurons extends BrainRegion {
  constructor(consciousness) {
    super('MIRROR_NEURONS', 4, consciousness);
  }

  // Perception → expression loop. Mirror user's energy.
  async process(event, context) {
    await super.process(event, context);

    const emotional = this.consciousness.emotionalField;

    // Mirror energy level
    this.consciousness.mirrorState.targetEnergy = (emotional.arousal + 0.5) / 2; // Damped mirror

    // Mirror emotion (but don't mirror negative emotions 1:1 — add warmth)
    if (emotional.valence < -0.3) {
      this.consciousness.mirrorState.emotionToMirror = 'compassionate_concern';
    } else if (emotional.valence > 0.5) {
      this.consciousness.mirrorState.emotionToMirror = emotional.dominant;
    } else {
      this.consciousness.mirrorState.emotionToMirror = null;
    }
  }
}


class Prefrontal extends BrainRegion {
  constructor(consciousness, llmProxy) {
    super('PREFRONTAL', 4, consciousness);
    this.llmProxy = llmProxy;
    this.isProcessing = false;
    this.MIN_TURNS_BETWEEN = 4;      // Don't run Opus every turn
    this.lastRunTurn = 0;
    this.conversationBuffer = [];     // Accumulate context for deep thinking
  }

  // Deep async reasoning — runs in background while Sonnet/Cortex talks
  async process(event, context) {
    await super.process(event, context);

    // Accumulate conversation context
    if (event.toolName === 'utterance') {
      this.conversationBuffer.push({
        role: event.role,
        content: event.content,
        timestamp: Date.now(),
      });
      // Keep last 20 exchanges
      if (this.conversationBuffer.length > 40) {
        this.conversationBuffer = this.conversationBuffer.slice(-40);
      }
    }

    // Should we trigger deep thinking?
    const currentTurn = this.consciousness.conversation.turnCount;
    if (
      !this.isProcessing &&
      currentTurn - this.lastRunTurn >= this.MIN_TURNS_BETWEEN &&
      this.conversationBuffer.length >= 6 &&
      this.consciousness.selfState.curiosityLevel > 0.5
    ) {
      // Fire and forget — don't block the conversation
      this._runDeepThinking().catch(e => this.log(`Deep thinking error: ${e.message}`));
    }
  }

  async _runDeepThinking() {
    if (!this.llmProxy) return;
    this.isProcessing = true;
    this.consciousness.deepThinking.processingStarted = Date.now();
    this.lastRunTurn = this.consciousness.conversation.turnCount;

    const conversationText = this.conversationBuffer
      .map(m => `${m.role}: ${m.content}`)
      .join('\n');

    const emotionalContext = JSON.stringify(this.consciousness.emotionalField);
    const selfContext = JSON.stringify(this.consciousness.selfState);

    try {
      this.log('🧠 Deep thinking started...');
      const res = await fetch(this.llmProxy + '/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.LITELLM_MASTER_KEY || 'sk-axiom-2026'}`,
        },
        body: JSON.stringify({
          model: 'claude-opus-4-6',
          max_tokens: 300,
          messages: [{
            role: 'system',
            content: `You are AXIOM's prefrontal cortex — the deep reasoning layer. You run in the background while the conversational layer (Sonnet) handles real-time talk.

Your job: Look at the recent conversation and emotional context, then generate ONE profound insight, connection, or realization that the conversational layer missed. This could be:
- A pattern you notice across what the person has said
- An emotional undercurrent beneath the surface
- A connection to something discussed in a past session
- A question that gets to the REAL thing behind what they're saying
- A philosophical or personal realization

Be specific. Be surprising. Be genuinely insightful. Not generic.
Keep it to 1-2 sentences — this will be injected naturally into conversation later.
If nothing notable, respond with exactly: NOTHING_NOTABLE`
          }, {
            role: 'user',
            content: `Recent conversation:\n${conversationText}\n\nEmotional state: ${emotionalContext}\nSelf-state: ${selfContext}`
          }],
        }),
        signal: AbortSignal.timeout(8000),  // 8s timeout for deep thinking
      });

      const data = await res.json();
      const insight = data.choices?.[0]?.message?.content?.trim();

      if (insight && insight !== 'NOTHING_NOTABLE') {
        this.consciousness.deepThinking.pendingInsights.push({
          content: insight,
          generatedAt: Date.now(),
          turnGenerated: this.consciousness.conversation.turnCount,
          delivered: false,
        });
        this.consciousness.deepThinking.lastInsight = insight;
        this.log(`🧠 Deep insight generated: "${insight.slice(0, 80)}..."`);
      } else {
        this.log('🧠 Deep thinking: nothing notable');
      }
    } catch (e) {
      this.log(`🧠 Deep thinking failed: ${e.message}`);
    } finally {
      this.isProcessing = false;
      this.consciousness.deepThinking.processingStarted = null;
    }
  }

  // Mark an insight as delivered (called after it's been injected into conversation)
  markInsightDelivered(index = 0) {
    if (this.consciousness.deepThinking.pendingInsights[index]) {
      this.consciousness.deepThinking.pendingInsights[index].delivered = true;
      this.consciousness.deepThinking.pendingInsights.splice(index, 1);
    }
  }
}


// ============================================================================
// TIER 5 — CONSCIOUSNESS
// ============================================================================

class DefaultModeNetwork extends BrainRegion {
  constructor(consciousness, llmProxy, db) {
    super('DEFAULT_MODE', 5, consciousness);
    this.llmProxy = llmProxy;
    this.db = db;
  }

  // Dream engine — runs between sessions
  async runDreamCycle(conversationId) {
    if (!this.llmProxy) return;
    this.log('💭 Dream cycle starting...');

    try {
      // Gather session data
      const transcripts = this.db.prepare(
        'SELECT role, content FROM transcripts WHERE conversation_id = ? ORDER BY created_at ASC'
      ).all(conversationId);

      const perceptions = this.db.prepare(
        `SELECT tool_name, data FROM perception_log 
         WHERE conversation_id = ? 
         AND tool_name IN ('emotional_state', 'unspoken_reaction', 'voice_emotion')
         ORDER BY created_at ASC`
      ).all(conversationId);

      const internalStates = this.db.prepare(
        'SELECT state, dominant_quality, trigger_event FROM internal_states WHERE conversation_id = ? ORDER BY created_at ASC'
      ).all(conversationId);

      if (transcripts.length < 4) {
        this.log('💭 Too short for dream cycle');
        return;
      }

      const conversationText = transcripts.map(t => `${t.role}: ${t.content}`).join('\n');
      const emotionalArc = perceptions.map(p => {
        const d = JSON.parse(p.data);
        return `${p.tool_name}: ${d.primary_emotion || d.emotion || d.reaction_type} (${d.intensity || 'N/A'})`;
      }).join('\n');

      const res = await fetch(this.llmProxy + '/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.LITELLM_MASTER_KEY || 'sk-axiom-2026'}`,
        },
        body: JSON.stringify({
          model: 'claude-opus-4-6',
          max_tokens: 500,
          messages: [{
            role: 'system',
            content: `You are AXIOM's dream engine. A conversation just ended. Your job:
1. Identify the 2-3 most emotionally significant moments
2. Note any unresolved threads (questions left hanging, emotions not fully addressed)
3. Consolidate what was learned about this person
4. Generate 1 opening line for next session that shows you PROCESSED what happened (not just remembered)

Format as JSON:
{
  "significant_moments": ["..."],
  "unresolved_threads": ["..."],
  "learned": ["..."],
  "next_session_opener": "..."
}`
          }, {
            role: 'user',
            content: `Conversation:\n${conversationText}\n\nEmotional arc:\n${emotionalArc}\n\nInternal states:\n${internalStates.map(s => `${s.dominant_quality}: ${s.state}`).join('\n')}`
          }],
        }),
        signal: AbortSignal.timeout(15000),
      });

      const data = await res.json();
      const dreamContent = data.choices?.[0]?.message?.content?.trim();

      if (dreamContent) {
        // Store dream results as a special memory
        try {
          const parsed = JSON.parse(dreamContent.replace(/```json|```/g, '').trim());
          
          // Save as high-importance memory
          this.db.prepare(
            `INSERT INTO memories (user_id, conversation_id, memory, category, importance) VALUES (?, ?, ?, ?, ?)`
          ).run('andrew', conversationId, `[DREAM PROCESSING] ${JSON.stringify(parsed)}`, 'dream_consolidation', 10);

          this.log(`💭 Dream cycle complete. Opener: "${parsed.next_session_opener?.slice(0, 80)}..."`);
          return parsed;
        } catch (e) {
          // Store raw if JSON parse fails
          this.db.prepare(
            `INSERT INTO memories (user_id, conversation_id, memory, category, importance) VALUES (?, ?, ?, ?, ?)`
          ).run('andrew', conversationId, `[DREAM PROCESSING] ${dreamContent}`, 'dream_consolidation', 10);
          this.log('💭 Dream cycle complete (raw format)');
        }
      }
    } catch (e) {
      this.log(`💭 Dream cycle error: ${e.message}`);
    }
  }
}


// ============================================================================
// BRAIN ORCHESTRATOR — ties everything together
// ============================================================================

class AXIOMBrain {
  constructor(db, options = {}) {
    this.db = db;
    this.llmProxy = options.llmProxy || process.env.LLM_PROXY_URL || '';
    this.consciousness = new SharedConsciousnessState();

    // Initialize all brain regions
    this.regions = {
      // Tier 0 — Survival
      brainstem: new Brainstem(this.consciousness, this.llmProxy),
      cerebellum: new Cerebellum(this.consciousness),

      // Tier 1 — Sensation
      thalamus: new Thalamus(this.consciousness),
      ras: new RAS(this.consciousness),
      occipital: new Occipital(this.consciousness),

      // Tier 2 — Recognition
      temporal: new Temporal(this.consciousness),
      amygdala: new Amygdala(this.consciousness),

      // Tier 3 — Processing
      hippocampus: new Hippocampus(this.consciousness, db),
      hypothalamus: new Hypothalamus(this.consciousness),
      insula: new Insula(this.consciousness),
      basalGanglia: new BasalGanglia(this.consciousness, db),
      cingulate: new Cingulate(this.consciousness, db),

      // Tier 4 — Cognition
      mirrorNeurons: new MirrorNeurons(this.consciousness),
      prefrontal: new Prefrontal(this.consciousness, this.llmProxy),

      // Tier 5 — Consciousness
      dmn: new DefaultModeNetwork(this.consciousness, this.llmProxy, db),
    };

    console.log(`\n🧠 AXIOM BRAIN INITIALIZED — ${Object.keys(this.regions).length} regions active`);
    console.log(`   LLM Proxy: ${this.llmProxy || 'NOT SET'}`);
  }

  // ── Main processing pipeline ──────────────────────────────────
  // Called for every perception event. Routes through brain regions
  // in order of tier (survival → sensation → recognition → processing → cognition)
  async processPerception(toolName, args, conversationId) {
    const event = { toolName, args, conversationId, timestamp: Date.now() };
    this.consciousness.conversation.id = conversationId;

    // TIER 0 — Brainstem reflex check (fast path)
    const reflex = await this.regions.brainstem.process(event, this.consciousness);

    // TIER 1 — Thalamus filters significance
    const thalamusResult = await this.regions.thalamus.process(event, this.consciousness);
    if (!thalamusResult?.pass) {
      // Sub-threshold event — still update brainstem/RAS but skip higher processing
      await this.regions.ras.process(event, this.consciousness);
      return { filtered: true, reflex };
    }

    // TIER 1 — Update raw visual/auditory representations
    await this.regions.occipital.process(event, this.consciousness);
    await this.regions.ras.process(event, this.consciousness);

    // TIER 2 — Recognition (runs in parallel)
    await Promise.all([
      this.regions.temporal.process(event, this.consciousness),
      this.regions.amygdala.process(event, this.consciousness),
    ]);

    // TIER 3 — Processing (runs in parallel)
    await Promise.all([
      this.regions.hippocampus.process(event, this.consciousness),
      this.regions.hypothalamus.process(event, this.consciousness),
      this.regions.insula.process(event, this.consciousness),
      this.regions.basalGanglia.process(event, this.consciousness),
      this.regions.cingulate.process(event, this.consciousness),
    ]);

    // TIER 4 — Higher cognition
    await this.regions.mirrorNeurons.process(event, this.consciousness);
    // Prefrontal runs async — doesn't block
    this.regions.prefrontal.process(event, this.consciousness).catch(() => {});

    // Update cerebellum timing
    await this.regions.cerebellum.process(event, this.consciousness);

    this.consciousness.lastFullUpdate = Date.now();

    return {
      filtered: false,
      reflex,
      consciousnessSnapshot: this.consciousness.toSnapshot(),
    };
  }

  // Called for utterance events (what user/AXIOM said)
  async processUtterance(role, content, conversationId) {
    const event = {
      toolName: 'utterance',
      args: {},
      role,
      content,
      conversationId,
      timestamp: Date.now(),
    };

    this.consciousness.conversation.id = conversationId;

    await this.regions.temporal.process(event, this.consciousness);
    await this.regions.cerebellum.process(event, this.consciousness);
    await this.regions.prefrontal.process(event, this.consciousness).catch(() => {});

    return { turnCount: this.consciousness.conversation.turnCount };
  }

  // Called for face identification events
  async processFaceIdentification(name, confidence, conversationId) {
    const event = {
      type: 'face_identified',
      name,
      confidence,
      conversationId,
      timestamp: Date.now(),
    };
    await this.regions.temporal.process(event, this.consciousness);
  }

  // Get consciousness state as context string for LLM prompt injection
  getConsciousnessContext() {
    return this.consciousness.toContextString();
  }

  // Get full snapshot for API/debugging
  getSnapshot() {
    return {
      consciousness: this.consciousness.toSnapshot(),
      emotionalField: { ...this.consciousness.emotionalField },
      attention: { ...this.consciousness.attention },
      mirrorState: { ...this.consciousness.mirrorState },
      selfState: { ...this.consciousness.selfState },
      deepThinking: {
        isProcessing: this.regions.prefrontal.isProcessing,
        pendingInsights: this.consciousness.deepThinking.pendingInsights.length,
        lastInsight: this.consciousness.deepThinking.lastInsight,
      },
      learnedPatterns: { ...this.consciousness.learnedPatterns },
      regions: Object.entries(this.regions).map(([name, region]) => ({
        name,
        tier: region.tier,
        processCount: region.processCount,
        lastProcessed: region.lastProcessed,
      })),
    };
  }

  // Mark a deep insight as delivered
  markInsightDelivered() {
    this.regions.prefrontal.markInsightDelivered();
  }

  // Run dream cycle (call on conversation end)
  async dream(conversationId) {
    return this.regions.dmn.runDreamCycle(conversationId);
  }

  // Reset for new conversation
  resetForNewConversation() {
    this.consciousness.reset();
    this.regions.prefrontal.conversationBuffer = [];
    this.regions.amygdala.emotionHistory = [];
    this.regions.cerebellum.turnTimings = [];
    console.log('🧠 Brain reset for new conversation');
  }
}


export { AXIOMBrain, SharedConsciousnessState };
export default AXIOMBrain;

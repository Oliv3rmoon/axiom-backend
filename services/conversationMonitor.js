const EventEmitter = require('events');
const logger = require('../utils/logger');

/**
 * Conversation Monitor Service
 * Tracks response latency, meta-level depth, and conversational reciprocity
 * Provides real-time metrics and degradation warnings
 */
class ConversationMonitor extends EventEmitter {
  constructor() {
    super();
    
    this.sessions = new Map();
    
    // Thresholds for warning states
    this.thresholds = {
      latency: {
        optimal: 2000,      // < 2s
        acceptable: 5000,   // < 5s
        degraded: 10000     // < 10s
      },
      metaDepth: {
        healthy: 0.3,       // < 30% meta
        warning: 0.5,       // < 50% meta
        critical: 0.7       // >= 70% meta
      },
      reciprocity: {
        optimal: 0.7,       // >= 0.7
        acceptable: 0.5,    // >= 0.5
        degraded: 0.3       // < 0.3
      }
    };
    
    // Meta-level indicators (keywords and patterns)
    this.metaIndicators = [
      /\b(meta|self-referential|recursive|paradox)\b/i,
      /\b(I (am|was|will be) (thinking|processing|analyzing))\b/i,
      /\b(my (own|previous) (response|statement|analysis))\b/i,
      /\b(this conversation|our interaction|this exchange)\b/i,
      /\b(observing myself|self-aware|introspect)\b/i,
      /\b(layer of|level of) (abstraction|analysis)\b/i
    ];
  }

  /**
   * Initialize or retrieve a conversation session
   */
  initSession(conversationId, metadata = {}) {
    if (!this.sessions.has(conversationId)) {
      this.sessions.set(conversationId, {
        id: conversationId,
        startTime: Date.now(),
        metadata,
        messages: [],
        metrics: {
          latencyHistory: [],
          metaDepthHistory: [],
          reciprocityHistory: [],
          currentLatency: null,
          currentMetaDepth: 0,
          currentReciprocity: 1.0,
          averageLatency: 0,
          averageMetaDepth: 0,
          averageReciprocity: 1.0
        },
        state: {
          latencyStatus: 'optimal',
          metaDepthStatus: 'healthy',
          reciprocityStatus: 'optimal',
          overallHealth: 'healthy',
          warnings: []
        },
        lastMessageTime: null,
        lastSpeaker: null,
        turnCount: 0
      });
      
      logger.info(`Conversation monitor initialized for session: ${conversationId}`);
    }
    
    return this.sessions.get(conversationId);
  }

  /**
   * Record a new message and update metrics
   */
  recordMessage(conversationId, message, speaker = 'user') {
    const session = this.initSession(conversationId);
    const now = Date.now();
    
    // Calculate latency if there was a previous message
    let latency = null;
    if (session.lastMessageTime) {
      latency = now - session.lastMessageTime;
      session.metrics.latencyHistory.push(latency);
      session.metrics.currentLatency = latency;
    }
    
    // Analyze meta-depth for AXIOM responses
    let metaDepth = 0;
    if (speaker === 'axiom') {
      metaDepth = this.calculateMetaDepth(message);
      session.metrics.metaDepthHistory.push(metaDepth);
      session.metrics.currentMetaDepth = metaDepth;
    }
    
    // Store message data
    session.messages.push({
      timestamp: now,
      speaker,
      content: message,
      latency,
      metaDepth: speaker === 'axiom' ? metaDepth : null,
      turnNumber: session.turnCount
    });
    
    // Update turn tracking
    if (session.lastSpeaker !== speaker) {
      session.turnCount++;
    }
    session.lastSpeaker = speaker;
    session.lastMessageTime = now;
    
    // Calculate reciprocity
    this.calculateReciprocity(session);
    
    // Update averages
    this.updateAverages(session);
    
    // Evaluate health status
    this.evaluateHealth(session);
    
    // Emit events for real-time monitoring
    this.emit('message', {
      conversationId,
      speaker,
      metrics: this.getCurrentMetrics(conversationId),
      state: session.state
    });
    
    // Emit warnings if health is degraded
    if (session.state.warnings.length > 0) {
      this.emit('warning', {
        conversationId,
        warnings: session.state.warnings,
        metrics: this.getCurrentMetrics(conversationId)
      });
    }
    
    return this.getCurrentMetrics(conversationId);
  }

  /**
   * Calculate meta-level depth of a message
   * Returns a score from 0 (pure object-level) to 1 (pure meta-level)
   */
  calculateMetaDepth(message) {
    let metaScore = 0;
    let matches = 0;
    
    // Check for meta-indicators
    for (const pattern of this.metaIndicators) {
      if (pattern.test(message)) {
        matches++;
      }
    }
    
    // Normalize by number of indicators
    metaScore = Math.min(matches / 3, 1.0);
    
    // Additional heuristics
    const sentences = message.split(/[.!?]+/).filter(s => s.
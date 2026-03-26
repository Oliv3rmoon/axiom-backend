const express = require('express');
const router = express.Router();
const { EventEmitter } = require('events');

// Monitoring event bus
const monitoringEvents = new EventEmitter();
monitoringEvents.setMaxListeners(100);

// In-memory metrics store with circular buffer
class MetricsStore {
  constructor(maxSize = 10000) {
    this.maxSize = maxSize;
    this.toolUsage = new Map();
    this.coherenceScores = [];
    this.repetitionAlerts = [];
    this.degradationEvents = [];
    this.responsePatterns = new Map();
    this.tokenUsage = [];
    this.startTime = Date.now();
  }

  recordToolUsage(toolName, metadata = {}) {
    const timestamp = Date.now();
    const entry = {
      tool: toolName,
      timestamp,
      metadata,
      sessionId: metadata.sessionId || 'default'
    };

    if (!this.toolUsage.has(toolName)) {
      this.toolUsage.set(toolName, []);
    }

    const toolHistory = this.toolUsage.get(toolName);
    toolHistory.push(entry);

    // Maintain circular buffer
    if (toolHistory.length > this.maxSize) {
      toolHistory.shift();
    }

    monitoringEvents.emit('tool-usage', entry);
    this.detectUnusualToolPatterns(toolName, toolHistory);
  }

  recordCoherenceScore(score, context = {}) {
    const entry = {
      score,
      timestamp: Date.now(),
      context,
      sessionId: context.sessionId || 'default'
    };

    this.coherenceScores.push(entry);

    if (this.coherenceScores.length > this.maxSize) {
      this.coherenceScores.shift();
    }

    monitoringEvents.emit('coherence-score', entry);

    // Check for degradation
    if (score < 0.6) {
      this.recordDegradationEvent('low-coherence', { score, context });
    }
  }

  recordRepetition(pattern, severity, metadata = {}) {
    const alert = {
      pattern,
      severity,
      timestamp: Date.now(),
      metadata,
      sessionId: metadata.sessionId || 'default'
    };

    this.repetitionAlerts.push(alert);

    if (this.repetitionAlerts.length > this.maxSize) {
      this.repetitionAlerts.shift();
    }

    monitoringEvents.emit('repetition-alert', alert);

    if (severity >= 0.7) {
      this.recordDegradationEvent('high-repetition', { pattern, severity, metadata });
    }
  }

  recordDegradationEvent(type, data) {
    const event = {
      type,
      data,
      timestamp: Date.now(),
      riskLevel: this.calculateRiskLevel(type, data)
    };

    this.degradationEvents.push(event);

    if (this.degradationEvents.length > this.maxSize) {
      this.degradationEvents.shift();
    }

    monitoringEvents.emit('degradation-event', event);
  }

  recordResponsePattern(responseHash, metadata = {}) {
    if (!this.responsePatterns.has(responseHash)) {
      this.responsePatterns.set(responseHash, []);
    }

    const pattern = this.responsePatterns.get(responseHash);
    pattern.push({
      timestamp: Date.now(),
      metadata
    });

    // Detect repetition if same pattern appears multiple times
    if (pattern.length >= 3) {
      const timeWindow = 300000; // 5 minutes
      const recentOccurrences = pattern.filter(
        p => Date.now() - p.timestamp < timeWindow
      );

      if (recentOccurrences.length >= 3) {
        this.recordRepetition(
          responseHash.substring(0, 8),
          recentOccurrences.length / 10,
          { type: 'response-hash', occurrences: recentOccurrences.length }
        );
      }
    }
  }

  recordTokenUsage(tokens, metadata = {}) {
    this.tokenUsage.push({
      tokens,
      timestamp: Date.now(),
      metadata
    });

    if (this.tokenUsage.length > this.maxSize) {
      this.tokenUsage.shift();
    }
  }

  detectUnusualToolPatterns(toolName, history) {
    // Detect rapid repeated tool usage
    const recentWindow = 60000; // 1 minute
    const recentCalls = history.filter(
      entry => Date.now() - entry.timestamp < recentWindow
    );

    if (recentCalls.length > 10) {
      this.recordDegradationEvent('rapid-tool-usage', {
        tool: toolName,
        callCount: recentCalls.length,
        timeWindow: recentWindow
      });
    }

    // Detect alternating pattern (A-B-A-B-A-B)
    if (history.length >= 6) {
      const recent = history.slice(-6);
      const timestamps = recent.map(r => r.timestamp);
      const intervals = timestamps.slice(1).map((t, i) => t - timestamps[i]);
      const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;

      if (avgInterval < 5000 && intervals.every(i => Math.abs(i - avgInterval) < 2000)) {
        this.recordRepetition(
          `${toolName}-loop`,
          0.8,
          { type: 'alternating-pattern', intervals }
        );
      }
    }
  }

  calculateRiskLevel(type, data) {
    let risk = 0;

    // Recent degradation events increase risk
    const recentWindow = 300000; // 5
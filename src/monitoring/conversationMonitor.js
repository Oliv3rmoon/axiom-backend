import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class ConversationMonitor {
  constructor(config = {}) {
    this.logDir = config.logDir || path.join(__dirname, '../../logs/monitoring');
    this.currentLogFile = path.join(this.logDir, `conversation-${this.getDateString()}.json`);
    this.weeklyLogFile = path.join(this.logDir, 'weekly-summary.json');
    this.sessionId = crypto.randomUUID();
    this.activeConversations = new Map();
    this.metrics = {
      responses: [],
      toolCalls: [],
      sessions: []
    };
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;
    
    try {
      await fs.mkdir(this.logDir, { recursive: true });
      await this.loadExistingMetrics();
      this.initialized = true;
      console.log('[ConversationMonitor] Initialized successfully');
    } catch (error) {
      console.error('[ConversationMonitor] Initialization failed:', error);
      throw error;
    }
  }

  async loadExistingMetrics() {
    try {
      const data = await fs.readFile(this.currentLogFile, 'utf-8');
      this.metrics = JSON.parse(data);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('[ConversationMonitor] Error loading existing metrics:', error);
      }
    }
  }

  startConversation(conversationId, metadata = {}) {
    const conversation = {
      id: conversationId,
      sessionId: this.sessionId,
      startTime: Date.now(),
      metadata,
      messageCount: 0,
      toolCallCount: 0
    };
    
    this.activeConversations.set(conversationId, conversation);
    return conversationId;
  }

  startResponse(conversationId, messageId, userMessage) {
    const conversation = this.activeConversations.get(conversationId);
    if (!conversation) {
      console.warn(`[ConversationMonitor] Unknown conversation: ${conversationId}`);
      return null;
    }

    const responseTracking = {
      messageId,
      conversationId,
      sessionId: this.sessionId,
      userMessage: this.sanitizeMessage(userMessage),
      startTime: Date.now(),
      toolCalls: [],
      completed: false
    };

    conversation.messageCount++;
    conversation.lastMessageId = messageId;
    conversation.currentResponse = responseTracking;

    return responseTracking;
  }

  recordToolCall(conversationId, toolCall) {
    const conversation = this.activeConversations.get(conversationId);
    if (!conversation || !conversation.currentResponse) {
      console.warn(`[ConversationMonitor] No active response for conversation: ${conversationId}`);
      return;
    }

    const toolCallRecord = {
      tool: toolCall.tool || toolCall.name,
      timestamp: Date.now(),
      duration: null,
      success: null,
      error: null,
      parameters: this.sanitizeToolParameters(toolCall.parameters || toolCall.args)
    };

    conversation.currentResponse.toolCalls.push(toolCallRecord);
    conversation.toolCallCount++;

    return toolCallRecord;
  }

  recordToolCallComplete(conversationId, toolName, duration, success, error = null) {
    const conversation = this.activeConversations.get(conversationId);
    if (!conversation || !conversation.currentResponse) return;

    const toolCall = conversation.currentResponse.toolCalls
      .reverse()
      .find(tc => tc.tool === toolName && tc.success === null);

    if (toolCall) {
      toolCall.duration = duration;
      toolCall.success = success;
      toolCall.error = error ? this.sanitizeError(error) : null;
    }
  }

  async completeResponse(conversationId, messageId, assistantMessage = null) {
    const conversation = this.activeConversations.get(conversationId);
    if (!conversation || !conversation.currentResponse) {
      console.warn(`[ConversationMonitor] No active response to complete for: ${conversationId}`);
      return null;
    }

    const response = conversation.currentResponse;
    const endTime = Date.now();
    const latency = endTime - response.startTime;

    response.endTime = endTime;
    response.latency = latency;
    response.completed = true;
    response.assistantMessage = assistantMessage ? this.sanitizeMessage(assistantMessage) : null;

    const responseMetric = {
      ...response,
      conversationMetadata: {
        messageCount: conversation.messageCount,
        totalToolCalls: conversation.toolCallCount
      }
    };

    this.metrics.responses.push(responseMetric);

    for (const toolCall of response.toolCalls) {
      this.metrics.toolCalls.push({
        ...toolCall,
        conversationId,
        messageId,
        sessionId: this.sessionId
      });
    }

    conversation.currentResponse = null;

    await this.persistMetrics();

    return {
      latency,
      toolCallCount: response.toolCalls.length,
      success: response.toolCalls.every(tc => tc.success !== false)
    };
  }

  endConversation(conversationId) {
    const conversation = this.activeConversations.get(conversationId);
    if (!conversation) return;

    const endTime = Date.now();
    const duration = endTime - conversation.startTime;

    const sessionSummary = {
      ...conversation,
      endTime,
      duration,
      currentResponse: undefined
    };

    this.metrics.sessions.push(sessionSummary);
    this.activeConversations.delete(conversationId);

    this.
    this.saveMetrics();
    
    return sessionSummary;
  }

  async saveMetrics() {
    try {
      await fs.writeFile(this.currentLogFile, JSON.stringify(this.metrics, null, 2));
    } catch (error) {
      console.error('[ConversationMonitor] Failed to save metrics:', error);
    }
  }

  getDateString() {
    return new Date().toISOString().split('T')[0];
  }

  getMetrics() {
    return {
      totalResponses: this.metrics.responses.length,
      totalToolCalls: this.metrics.toolCalls.length,
      totalSessions: this.metrics.sessions.length,
      activeConversations: this.activeConversations.size
    };
  }
}

export default ConversationMonitor;

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fs = require('fs').promises;


/**
 * Degradation Analyzer
 * Analyzes conversation logs to identify patterns in tool usage degradation,
 * response quality decline, and coherence breakdown over conversation depth.
 */

class DegradationAnalyzer {
  constructor(logsDirectory = './logs') {
    this.logsDirectory = logsDirectory;
    this.metrics = {
      toolUsageByDepth: {},
      responseQualityByDepth: {},
      coherenceByDepth: {},
      conversationPatterns: []
    };
  }

  /**
   * Main analysis entry point
   */
  async analyze(options = {}) {
    const {
      startDate = null,
      endDate = null,
      conversationId = null,
      outputFile = './degradation_report.json'
    } = options;

    console.log('🔍 Starting degradation analysis...');
    
    const logFiles = await this.getLogFiles(startDate, endDate);
    console.log(`📁 Found ${logFiles.length} log files to analyze`);

    for (const logFile of logFiles) {
      const conversations = await this.parseLogFile(logFile);
      
      for (const conversation of conversations) {
        if (conversationId && conversation.id !== conversationId) {
          continue;
        }
        
        await this.analyzeConversation(conversation);
      }
    }

    const report = this.generateReport();
    await this.saveReport(report, outputFile);
    
    console.log(`✅ Analysis complete. Report saved to ${outputFile}`);
    return report;
  }

  /**
   * Get log files within date range
   */
  async getLogFiles(startDate, endDate) {
    try {
      const files = await fs.readdir(this.logsDirectory);
      const logFiles = files.filter(f => f.endsWith('.log') || f.endsWith('.json'));
      
      const filtered = [];
      for (const file of logFiles) {
        const filePath = path.join(this.logsDirectory, file);
        const stats = await fs.stat(filePath);
        
        if (startDate && stats.mtime < new Date(startDate)) continue;
        if (endDate && stats.mtime > new Date(endDate)) continue;
        
        filtered.push(filePath);
      }
      
      return filtered;
    } catch (error) {
      console.error('Error reading log directory:', error.message);
      return [];
    }
  }

  /**
   * Parse log file and extract conversations
   */
  async parseLogFile(filePath) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n').filter(line => line.trim());
      
      const conversations = new Map();
      
      for (const line of lines) {
        try {
          const logEntry = JSON.parse(line);
          
          const convId = logEntry.conversationId || logEntry.conversation_id || 'default';
          
          if (!conversations.has(convId)) {
            conversations.set(convId, {
              id: convId,
              messages: [],
              toolCalls: [],
              metadata: {}
            });
          }
          
          const conv = conversations.get(convId);
          
          if (logEntry.type === 'message' || logEntry.role) {
            conv.messages.push(logEntry);
          }
          
          if (logEntry.type === 'tool_call' || logEntry.toolCalls || logEntry.tool_calls) {
            conv.toolCalls.push(logEntry);
          }
          
          if (logEntry.metadata) {
            Object.assign(conv.metadata, logEntry.metadata);
          }
        } catch (parseError) {
          // Skip malformed log lines
          continue;
        }
      }
      
      return Array.from(conversations.values());
    } catch (error) {
      console.error(`Error parsing log file ${filePath}:`, error.message);
      return [];
    }
  }

  /**
   * Analyze a single conversation for degradation patterns
   */
  async analyzeConversation(conversation) {
    const { messages, toolCalls, id } = conversation;
    
    if (messages.length === 0) return;

    const pattern = {
      conversationId: id,
      totalMessages: messages.length,
      totalToolCalls: toolCalls.length,
      degradationPoints: [],
      toolUsagePattern: [],
      qualityMetrics: []
    };

    // Analyze in chunks/windows
    const windowSize = 5;
    for (let i = 0; i < messages.length; i += windowSize) {
      const window = messages.slice(i, i + windowSize);
      const depth = Math.floor(i / windowSize);
      
      // Tool usage analysis
      const toolsInWindow = toolCalls.filter(tc => {
        const tcTimestamp = this.extractTimestamp(tc);
        return window.some(msg => {
          const msgTimestamp = this.extractTimestamp(msg);
          return Math.abs(tcTimestamp - msgTimestamp) < 60000; // Within 1 minute
        });
      });
      
      const toolUsageRate = toolsInWindow.length / window.length;
      pattern.toolUsagePattern.push({ depth, rate: toolUsageRate, count: toolsInWindow.length });
      
      if (!this.metrics.toolUsageByDepth[depth]) {
        this.metrics.toolUsageByDepth[depth] = [];
      }
      this.metrics.toolUsageByDepth[depth].push(toolUsageRate);
      
      // Quality analysis
      const qualityScore = this.assessWindowQuality(window);
      pattern.qualityMetrics.push({ depth, score: qualityScore });
      
      if (!this.metrics.responseQualityByDepth[depth]) {
        this.metrics
        this.metrics.responseQualityByDepth[depth] = [];
      }
      this.metrics.responseQualityByDepth[depth].push(qualityScore);
    }

    return pattern;
  }

  assessWindowQuality(window) {
    if (!window || !window.length) return 0;
    const avgLength = window.reduce((sum, r) => sum + (r.length || 0), 0) / window.length;
    const hasErrors = window.some(r => r.error);
    return hasErrors ? 0.3 : Math.min(1, avgLength / 500);
  }

  getReport() {
    return {
      totalAnalyzed: this.metrics.totalAnalyzed || 0,
      degradationEvents: this.metrics.degradationEvents || [],
      responseQualityByDepth: this.metrics.responseQualityByDepth || {},
      timestamp: new Date().toISOString()
    };
  }
}

export default DegradationAnalyzer;

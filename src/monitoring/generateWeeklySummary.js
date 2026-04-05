import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const WORKSPACE_PATH = process.env.AXIOM_WORKSPACE_PATH || path.join(__dirname, '../../axiom-workspace');
const LOGS_PATH = path.join(WORKSPACE_PATH, 'logs');
const SUMMARIES_PATH = path.join(WORKSPACE_PATH, 'summaries');

class WeeklySummaryGenerator {
  constructor() {
    this.weekStart = this.getWeekStart();
    this.weekEnd = new Date();
    this.conversationData = [];
  }

  getWeekStart() {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const monday = new Date(now);
    monday.setDate(now.getDate() - diff);
    monday.setHours(0, 0, 0, 0);
    return monday;
  }

  async loadConversationLogs() {
    try {
      const files = await fs.readdir(LOGS_PATH);
      const logFiles = files.filter(f => f.endsWith('.json') && f.startsWith('conversation-'));

      for (const file of logFiles) {
        try {
          const filePath = path.join(LOGS_PATH, file);
          const content = await fs.readFile(filePath, 'utf-8');
          const data = JSON.parse(content);
          
          const timestamp = new Date(data.timestamp || data.startTime);
          if (timestamp >= this.weekStart && timestamp <= this.weekEnd) {
            this.conversationData.push(data);
          }
        } catch (err) {
          console.warn(`Skipping malformed log file: ${file}`, err.message);
        }
      }

      console.log(`Loaded ${this.conversationData.length} conversations from this week`);
    } catch (err) {
      console.error('Error loading conversation logs:', err);
      throw err;
    }
  }

  calculateLatencyStats() {
    const latencies = [];
    
    this.conversationData.forEach(conv => {
      if (conv.messages) {
        conv.messages.forEach(msg => {
          if (msg.latency && typeof msg.latency === 'number') {
            latencies.push(msg.latency);
          }
        });
      }
      if (conv.metrics && conv.metrics.latency) {
        latencies.push(conv.metrics.latency);
      }
    });

    if (latencies.length === 0) {
      return { mean: 0, median: 0, p95: 0, count: 0 };
    }

    const sorted = latencies.sort((a, b) => a - b);
    const mean = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const median = sorted[Math.floor(sorted.length / 2)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];

    return {
      mean: Math.round(mean),
      median: Math.round(median),
      p95: Math.round(p95),
      count: latencies.length
    };
  }

  calculateToolUsage() {
    const toolCounts = {};
    const toolSuccessRates = {};

    this.conversationData.forEach(conv => {
      if (conv.toolCalls) {
        conv.toolCalls.forEach(call => {
          const toolName = call.tool || call.name || 'unknown';
          toolCounts[toolName] = (toolCounts[toolName] || 0) + 1;

          if (!toolSuccessRates[toolName]) {
            toolSuccessRates[toolName] = { success: 0, total: 0 };
          }
          toolSuccessRates[toolName].total++;
          if (call.success !== false && call.error === undefined) {
            toolSuccessRates[toolName].success++;
          }
        });
      }
    });

    const sortedTools = Object.entries(toolCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10);

    return {
      topTools: sortedTools,
      successRates: toolSuccessRates
    };
  }

  calculateTimePatterns() {
    const hourCounts = new Array(24).fill(0);
    const dayOfWeekCounts = new Array(7).fill(0);

    this.conversationData.forEach(conv => {
      const timestamp = new Date(conv.timestamp || conv.startTime);
      hourCounts[timestamp.getHours()]++;
      dayOfWeekCounts[timestamp.getDay()]++;
    });

    const peakHour = hourCounts.indexOf(Math.max(...hourCounts));
    const peakDay = dayOfWeekCounts.indexOf(Math.max(...dayOfWeekCounts));
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    return {
      hourCounts,
      dayOfWeekCounts,
      peakHour,
      peakDay: dayNames[peakDay]
    };
  }

  calculateConversationMetrics() {
    const totalConversations = this.conversationData.length;
    const totalMessages = this.conversationData.reduce((sum, conv) => {
      return sum + (conv.messages ? conv.messages.length : 0);
    }, 0);

    const conversationLengths = this.conversationData.map(conv => 
      conv.messages ? conv.messages.length : 0
    );
    const avgConversationLength = totalConversations > 0 
      ? Math.round(totalMessages / totalConversations) 
      : 0;

    return {
      totalConversations,
      totalMessages,
      averageMessages,
      weekStart: this.weekStart.toISOString(),
      weekEnd: this.weekEnd.toISOString(),
      generatedAt: new Date().toISOString()
    };
  }

  async generateSummary() {
    await this.loadConversationLogs();
    const stats = this.calculateStats();
    
    const summaryPath = path.join(SUMMARIES_PATH, `week-${this.weekStart.toISOString().split('T')[0]}.json`);
    
    try {
      await fs.mkdir(SUMMARIES_PATH, { recursive: true });
      await fs.writeFile(summaryPath, JSON.stringify(stats, null, 2));
      console.log(`[WeeklySummary] Generated: ${summaryPath}`);
    } catch (error) {
      console.error('[WeeklySummary] Failed to write summary:', error);
    }
    
    return stats;
  }
}

export default WeeklySummaryGenerator;

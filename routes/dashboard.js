const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken } = require('../middleware/auth');

/**
 * GET /api/dashboard
 * Aggregates all system statistics into a single response
 * Returns: counts, recent items, and status summaries for all major entities
 */
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Parallel queries for better performance
    const [
      plansResult,
      goalsResult,
      knowledgeNodesResult,
      walletResult,
      journalResult,
      proposalsResult,
      recentPlansResult,
      recentGoalsResult,
      recentKnowledgeResult,
      recentJournalResult,
      recentProposalsResult
    ] = await Promise.all([
      // Plans statistics
      db.query(
        `SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
          SUM(CASE WHEN status = 'paused' THEN 1 ELSE 0 END) as paused,
          SUM(CASE WHEN status = 'archived' THEN 1 ELSE 0 END) as archived
        FROM plans WHERE user_id = $1`,
        [userId]
      ),

      // Goals statistics
      db.query(
        `SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
          SUM(CASE WHEN priority = 'high' THEN 1 ELSE 0 END) as high_priority,
          SUM(CASE WHEN progress >= 100 THEN 1 ELSE 0 END) as achieved
        FROM goals WHERE user_id = $1`,
        [userId]
      ),

      // Knowledge nodes statistics
      db.query(
        `SELECT 
          COUNT(*) as total,
          COUNT(DISTINCT category) as categories,
          SUM(CASE WHEN is_verified = true THEN 1 ELSE 0 END) as verified,
          SUM(CASE WHEN is_public = true THEN 1 ELSE 0 END) as public_nodes
        FROM knowledge_nodes WHERE user_id = $1`,
        [userId]
      ),

      // Wallet statistics
      db.query(
        `SELECT 
          COALESCE(SUM(CASE WHEN type = 'credit' THEN amount ELSE -amount END), 0) as balance,
          COUNT(*) as total_transactions,
          SUM(CASE WHEN type = 'credit' THEN amount ELSE 0 END) as total_credits,
          SUM(CASE WHEN type = 'debit' THEN amount ELSE 0 END) as total_debits,
          COUNT(CASE WHEN created_at >= NOW() - INTERVAL '30 days' THEN 1 END) as transactions_last_30_days
        FROM wallet_transactions WHERE user_id = $1`,
        [userId]
      ),

      // Journal statistics
      db.query(
        `SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN mood = 'positive' THEN 1 ELSE 0 END) as positive_entries,
          SUM(CASE WHEN mood = 'neutral' THEN 1 ELSE 0 END) as neutral_entries,
          SUM(CASE WHEN mood = 'negative' THEN 1 ELSE 0 END) as negative_entries,
          COUNT(CASE WHEN created_at >= NOW() - INTERVAL '7 days' THEN 1 END) as entries_this_week
        FROM journal_entries WHERE user_id = $1`,
        [userId]
      ),

      // Proposals statistics
      db.query(
        `SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
          SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved,
          SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected,
          SUM(CASE WHEN status = 'implemented' THEN 1 ELSE 0 END) as implemented,
          COUNT(CASE WHEN created_at >= NOW() - INTERVAL '30 days' THEN 1 END) as recent_proposals
        FROM proposals WHERE user_id = $1`,
        [userId]
      ),

      // Recent plans (last 5)
      db.query(
        `SELECT id, title, description, status, priority, start_date, end_date, progress, created_at, updated_at
        FROM plans 
        WHERE user_id = $1 
        ORDER BY updated_at DESC 
        LIMIT 5`,
        [userId]
      ),

      // Recent goals (last 5)
      db.query(
        `SELECT id, title, description, status, priority, target_date, progress, created_at, updated_at
        FROM goals 
        WHERE user_id = $1 
        ORDER BY updated_at DESC 
        LIMIT 5`,
        [userId]
      ),

      // Recent knowledge nodes (last 5)
      db.query(
        `SELECT id, title, content, category, tags, is_verified, is_public, created_at, updated_at
        FROM knowledge_nodes 
        WHERE user_id = $1 
        ORDER BY created_at DESC 
        LIMIT
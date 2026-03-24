const http = require('http');
const https = require('https');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

// ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
};

// Service configuration
const services = [
  {
    name: 'Backend API',
    type: 'http',
    url: process.env.BACKEND_URL || 'http://localhost:3000',
    healthPath: '/health',
    critical: true,
  },
  {
    name: 'Cognitive Core',
    type: 'http',
    url: process.env.COGNITIVE_CORE_URL || 'http://localhost:3001',
    healthPath: '/health',
    critical: true,
  },
  {
    name: 'Frontend',
    type: 'http',
    url: process.env.FRONTEND_URL || 'http://localhost:3002',
    healthPath: '/',
    critical: false,
  },
  {
    name: 'Database (PostgreSQL)',
    type: 'database',
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    critical: true,
  },
  {
    name: 'Redis Cache',
    type: 'redis',
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    critical: false,
  },
  {
    name: 'Message Queue',
    type: 'tcp',
    host: process.env.MQ_HOST || 'localhost',
    port: process.env.MQ_PORT || 5672,
    critical: false,
  },
];

// Utility function to make HTTP/HTTPS requests
function makeRequest(url, path, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const fullUrl = `${url}${path}`;
    const protocol = url.startsWith('https') ? https : http;
    
    const req = protocol.get(fullUrl, { timeout }, (res) => {
      const { statusCode } = res;
      
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (statusCode >= 200 && statusCode < 300) {
          resolve({ statusCode, data });
        } else {
          reject(new Error(`HTTP ${statusCode}`));
        }
      });
    });
    
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    
    req.on('error', reject);
  });
}

// Check TCP connection
function checkTcpConnection(host, port, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const net = require('net');
    const socket = new net.Socket();
    
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('Connection timeout'));
    }, timeout);
    
    socket.connect(port, host, () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });
    
    socket.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// Check database connection using pg
async function checkDatabase(host, port) {
  try {
    const { Client } = require('pg');
    const client = new Client({
      host,
      port,
      user: process.env.DB_USER || 'axiom',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'axiom',
      connectionTimeoutMillis: 5000,
    });
    
    await client.connect();
    await client.query('SELECT NOW()');
    await client.end();
    return { healthy: true };
  } catch (error) {
    if (error.code === 'MODULE_NOT_FOUND') {
      // Fallback to TCP check if pg module not available
      await checkTcpConnection(host, port);
      return { healthy: true, note: 'TCP check only' };
    }
    throw error;
  }
}

// Check Redis connection
async function checkRedis(host, port) {
  try {
    const redis = require('redis');
    const client = redis.createClient({
      socket: {
        host,
        port,
        connectTimeout: 5000,
      },
    });
    
    await client.connect();
    await client.ping();
    await client.quit();
    return { healthy: true };
  } catch (error) {
    if (error.code === 'MODULE_NOT_FOUND') {
      // Fallback to TCP check if redis module not available
      await checkTcpConnection(host, port);
      return { healthy: true, note: 'TCP check only' };
    }
    throw error;
  }
}

// Check individual service
async function checkService(service) {
  const startTime = Date.now();
  
  try {
    let result = {};
    
    switch (service.type) {
      case 'http':
        const response = await makeRequest(service.url, service.healthPath);
        result = {
          status: 'UP',
          statusCode: response.statusCode,
          responseTime: Date.now() - startTime,
        };
        break;
        
      case 'database':
        const dbResult = await checkDatabase
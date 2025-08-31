const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3
};

const LOG_COLORS = {
  ERROR: '\x1b[31m', // Red
  WARN: '\x1b[33m',  // Yellow
  INFO: '\x1b[36m',  // Cyan
  DEBUG: '\x1b[37m', // White
  RESET: '\x1b[0m'
};

class Logger {
  constructor() {
    this.logLevel = this.getLogLevel();
    this.isDevelopment = process.env.NODE_ENV === 'development';
  }

  getLogLevel() {
    const level = process.env.LOG_LEVEL?.toLowerCase() || 'info';
    switch (level) {
      case 'error': return LOG_LEVELS.ERROR;
      case 'warn': return LOG_LEVELS.WARN;
      case 'info': return LOG_LEVELS.INFO;
      case 'debug': return LOG_LEVELS.DEBUG;
      default: return LOG_LEVELS.INFO;
    }
  }

  formatMessage(level, message, meta = {}) {
    const timestamp = new Date().toISOString();
    
    return this.isDevelopment 
      ? this.formatDevelopment(level, message, meta, timestamp)
      : this.formatProduction(level, message, meta, timestamp);
  }

  formatDevelopment(level, message, meta, timestamp) {
    const color = LOG_COLORS[level] || '';
    const reset = LOG_COLORS.RESET;
    const metaStr = this.formatMetaString(meta);
    return `${color}[${level}]${reset} ${timestamp} - ${message}${metaStr}`;
  }

  formatProduction(level, message, meta, timestamp) {
    const baseLog = this.createBaseLog(timestamp, level, message);
    this.addMetaToLog(baseLog, meta);
    return JSON.stringify(baseLog);
  }

  formatMetaString(meta) {
    return Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
  }

  createBaseLog(timestamp, level, message) {
    return {
      timestamp,
      level,
      message,
      service: 'chefsue-backend'
    };
  }

  addMetaToLog(baseLog, meta) {
    if (Object.keys(meta).length > 0) {
      baseLog.meta = meta;
    }
  }

  log(level, message, meta = {}) {
    const levelValue = LOG_LEVELS[level];
    if (levelValue <= this.logLevel) {
      const formattedMessage = this.formatMessage(level, message, meta);
      this.outputLog(level, formattedMessage);
    }
  }

  outputLog(level, formattedMessage) {
    const outputMethod = this.getOutputMethod(level);
    outputMethod(formattedMessage);
  }

  getOutputMethod(level) {
    switch (level) {
      case 'ERROR': return console.error;
      case 'WARN': return console.warn;
      default: return console.log;
    }
  }

  error(message, meta = {}) {
    this.log('ERROR', message, meta);
  }

  warn(message, meta = {}) {
    this.log('WARN', message, meta);
  }

  info(message, meta = {}) {
    this.log('INFO', message, meta);
  }

  debug(message, meta = {}) {
    this.log('DEBUG', message, meta);
  }

  // Request logging helper
  logRequest(req, res, processingTime = null) {
    const meta = this.buildRequestMeta(req, res, processingTime);
    const message = this.buildRequestMessage(req, res, processingTime);
    this.info(message, meta);
  }

  buildRequestMeta(req, res, processingTime) {
    const meta = {
      method: req.method,
      path: req.path,
      userAgent: req.get('User-Agent'),
      ip: req.ip || req.connection.remoteAddress,
      sessionId: req.body?.sessionId || 'none'
    };

    if (processingTime !== null) {
      meta.statusCode = res.statusCode;
      meta.processingTime = `${processingTime}ms`;
    }

    return meta;
  }

  buildRequestMessage(req, res, processingTime) {
    return processingTime !== null 
      ? `${req.method} ${req.path} - ${res.statusCode} (${processingTime}ms)`
      : `${req.method} ${req.path}`;
  }

  // Error logging helper
  logError(error, context = {}) {
    const meta = this.buildErrorMeta(error, context);
    this.error(error.message, meta);
  }

  buildErrorMeta(error, context) {
    return {
      name: error.name,
      code: error.code,
      statusCode: error.statusCode,
      stack: this.isDevelopment ? error.stack : undefined,
      ...context
    };
  }
}

// Create singleton instance
const logger = new Logger();

module.exports = logger;
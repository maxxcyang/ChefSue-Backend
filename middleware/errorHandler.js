const { ValidationError } = require('../utils/validators');
const logger = require('../utils/logger');

// Custom error classes
class APIError extends Error {
  constructor(message, statusCode = 500, code = 'API_ERROR') {
    super(message);
    this.name = 'APIError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

class MealDBError extends Error {
  constructor(message, statusCode = 502, code = 'MEALDB_ERROR') {
    super(message);
    this.name = 'MealDBError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

class AIError extends Error {
  constructor(message, statusCode = 502, code = 'AI_ERROR') {
    super(message);
    this.name = 'AIError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

// Global error handler middleware
function errorHandler(err, req, res, next) {
  // Log error details
  logger.logError(err, {
    url: req.url,
    method: req.method,
    body: req.body,
    userAgent: req.get('User-Agent')
  });

  // Default error response
  let statusCode = 500;
  let code = 'INTERNAL_SERVER_ERROR';
  let message = 'An internal server error occurred';
  let details = {};

  // Handle specific error types
  if (err instanceof ValidationError) {
    statusCode = 400;
    code = err.code || 'VALIDATION_ERROR';
    message = err.message;
  } else if (err instanceof APIError || err instanceof MealDBError || err instanceof AIError) {
    statusCode = err.statusCode;
    code = err.code;
    message = err.message;
  } else if (err.name === 'SyntaxError' && err.status === 400) {
    statusCode = 400;
    code = 'INVALID_JSON';
    message = 'Invalid JSON in request body';
  } else if (err.code === 'ENOTFOUND') {
    statusCode = 502;
    code = 'SERVICE_UNAVAILABLE';
    message = 'External service is currently unavailable';
  } else if (err.code === 'ECONNABORTED' || err.code === 'TIMEOUT') {
    statusCode = 504;
    code = 'REQUEST_TIMEOUT';
    message = 'Request timed out';
  } else if (err.code === 'ECONNRESET') {
    statusCode = 502;
    code = 'CONNECTION_RESET';
    message = 'Connection was reset by external service';
  }

  // Include additional details in development mode
  if (process.env.NODE_ENV === 'development') {
    details = {
      originalError: err.message,
      stack: err.stack,
      timestamp: new Date().toISOString()
    };
  }

  // Send error response
  const errorResponse = {
    error: message,
    code,
    ...(Object.keys(details).length > 0 && { details })
  };

  res.status(statusCode).json(errorResponse);
}

// 404 handler for unmatched routes
function notFoundHandler(req, res, next) {
  const error = new APIError(
    `Route ${req.method} ${req.path} not found`,
    404,
    'ROUTE_NOT_FOUND'
  );
  next(error);
}

// Request timeout middleware
function timeoutHandler(timeoutMs = 60000) {
  return (req, res, next) => {
    const timeout = setTimeout(() => {
      const error = new APIError(
        'Request timeout',
        408,
        'REQUEST_TIMEOUT'
      );
      next(error);
    }, timeoutMs);

    // Clear timeout when response is sent
    res.on('finish', () => {
      clearTimeout(timeout);
    });

    next();
  };
}

// Request logging middleware
function requestLogger(req, res, next) {
  const startTime = Date.now();
  
  logger.logRequest(req, res);

  // Log response when finished
  res.on('finish', () => {
    const processingTime = Date.now() - startTime;
    logger.logRequest(req, res, processingTime);
  });

  next();
}

// Health check for error handling system
function healthCheck() {
  return {
    healthy: true,
    timestamp: new Date().toISOString(),
    errorHandling: 'operational'
  };
}

// Graceful error response helper
function createErrorResponse(message, code = 'GENERIC_ERROR', statusCode = 500) {
  return {
    error: message,
    code,
    timestamp: new Date().toISOString(),
    ...(process.env.NODE_ENV === 'development' && { 
      environment: 'development',
      suggestion: 'Check server logs for more details'
    })
  };
}

// Async wrapper to catch promise rejections
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// Rate limiting error (for future use)
function rateLimitError() {
  return new APIError(
    'Too many requests. Please try again later.',
    429,
    'RATE_LIMIT_EXCEEDED'
  );
}

module.exports = {
  errorHandler,
  notFoundHandler,
  timeoutHandler,
  requestLogger,
  asyncHandler,
  healthCheck,
  createErrorResponse,
  rateLimitError,
  // Error classes
  APIError,
  MealDBError,
  AIError
};
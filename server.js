const express = require('express');
const cors = require('cors');
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
require('dotenv').config();

const { RAGPipeline } = require('./services/ragPipeline');
const { validateUserMessage, validateSessionId } = require('./utils/validators');
const logger = require('./utils/logger');
const { 
  errorHandler, 
  notFoundHandler, 
  timeoutHandler, 
  requestLogger,
  asyncHandler,
  createErrorResponse
} = require('./middleware/errorHandler');

const app = express();
const ragPipeline = new RAGPipeline();

// Swagger configuration
const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'ChefSue Backend API',
      version: '1.0.0',
      description: 'RAG Pipeline for cooking assistance with MealDB integration',
    },
    servers: [
      {
        url: process.env.BASE_URL || 'http://localhost:3000',
        description: 'Development server',
      },
    ],
    components: {
      schemas: {
        ChatRequest: {
          type: 'object',
          required: ['message'],
          properties: {
            message: {
              type: 'string',
              description: 'User message for cooking assistance',
              example: 'What are some healthy chicken recipes?'
            },
            sessionId: {
              type: 'string',
              description: 'Optional session ID to maintain conversation context',
              example: 'user-session-123'
            }
          }
        },
        ChatResponse: {
          type: 'object',
          properties: {
            message: {
              type: 'string',
              description: 'AI-generated response with cooking assistance'
            },
            sessionId: {
              type: 'string',
              description: 'Session ID for conversation continuity'
            },
            timestamp: {
              type: 'string',
              format: 'date-time',
              description: 'Response timestamp'
            },
            debug: {
              type: 'object',
              description: 'Debug information (development only)',
              properties: {
                processingTime: {
                  type: 'number',
                  description: 'Processing time in milliseconds'
                },
                apiCallsMade: {
                  type: 'number',
                  description: 'Number of API calls made'
                },
                phasesExecuted: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'RAG pipeline phases executed'
                },
                recipeDataFound: {
                  type: 'number',
                  description: 'Number of recipes found'
                }
              }
            },
            error: {
              type: 'object',
              description: 'Error information (development only)',
              properties: {
                occurred: { type: 'boolean' },
                message: { type: 'string' }
              }
            }
          }
        },
        HealthResponse: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              enum: ['healthy', 'unhealthy']
            },
            service: {
              type: 'string',
              example: 'ChefSue Backend'
            },
            version: {
              type: 'string',
              example: '1.0.0'
            },
            timestamp: {
              type: 'string',
              format: 'date-time'
            },
            healthy: {
              type: 'boolean'
            },
            checks: {
              type: 'object',
              additionalProperties: { type: 'boolean' }
            }
          }
        },
        StatsResponse: {
          type: 'object',
          properties: {
            service: {
              type: 'string',
              example: 'ChefSue Backend'
            },
            uptime: {
              type: 'number',
              description: 'Server uptime in seconds'
            },
            memory: {
              type: 'object',
              properties: {
                rss: { type: 'number' },
                heapTotal: { type: 'number' },
                heapUsed: { type: 'number' },
                external: { type: 'number' }
              }
            }
          }
        },
        ErrorResponse: {
          type: 'object',
          properties: {
            error: {
              type: 'string',
              description: 'Error message'
            },
            code: {
              type: 'string',
              description: 'Error code'
            },
            status: {
              type: 'number',
              description: 'HTTP status code'
            }
          }
        }
      }
    }
  },
  apis: ['./server.js'],
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);

// Trust proxy for proper IP detection
app.set('trust proxy', 1);

// Middleware setup
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  credentials: true,
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Request timeout
app.use(timeoutHandler(parseInt(process.env.REQUEST_TIMEOUT_MS) || 60000));

// Request logging
if (process.env.NODE_ENV !== 'test') {
  app.use(requestLogger);
}

// Swagger UI
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

/**
 * @swagger
 * /health:
 *   get:
 *     summary: Health check endpoint
 *     description: Returns the health status of the ChefSue Backend service and its dependencies
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Service is healthy
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/HealthResponse'
 *       503:
 *         description: Service is unhealthy
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/HealthResponse'
 */
app.get('/health', asyncHandler(async (req, res) => {
  const healthCheck = await ragPipeline.healthCheck();
  
  res.status(healthCheck.healthy ? 200 : 503).json({
    status: healthCheck.healthy ? 'healthy' : 'unhealthy',
    service: 'ChefSue Backend',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    ...healthCheck
  });
}));

/**
 * @swagger
 * /stats:
 *   get:
 *     summary: Service statistics (Development only)
 *     description: Returns server statistics and RAG pipeline metrics for debugging purposes. Only available in non-production environments.
 *     tags: [Debug]
 *     responses:
 *       200:
 *         description: Statistics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/StatsResponse'
 *       404:
 *         description: Endpoint not available in production
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
app.get('/stats', asyncHandler(async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json(createErrorResponse('Not found', 'ROUTE_NOT_FOUND', 404));
  }
  
  const stats = ragPipeline.getStats();
  res.json({
    service: 'ChefSue Backend',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    ...stats
  });
}));

/**
 * @swagger
 * /api/chat:
 *   post:
 *     summary: Process cooking-related chat messages
 *     description: Main endpoint for processing user messages through the RAG pipeline to provide cooking assistance with recipe recommendations and cooking guidance.
 *     tags: [Chat]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ChatRequest'
 *           examples:
 *             recipe_search:
 *               summary: Recipe search query
 *               value:
 *                 message: "What are some healthy chicken recipes?"
 *                 sessionId: "user-session-123"
 *             cooking_help:
 *               summary: Cooking assistance
 *               value:
 *                 message: "How do I cook pasta al dente?"
 *             dietary_request:
 *               summary: Dietary restriction query
 *               value:
 *                 message: "I need vegetarian dinner ideas"
 *                 sessionId: "user-session-456"
 *     responses:
 *       200:
 *         description: Chat response generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ChatResponse'
 *       400:
 *         description: Invalid request data
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
app.post('/api/chat', asyncHandler(async (req, res) => {
  const { message, sessionId } = req.body;

  // Validate input
  const validatedMessage = validateUserMessage(message);
  const validatedSessionId = validateSessionId(sessionId);

  logger.info('Processing chat request', {
    message: validatedMessage.substring(0, 100) + (validatedMessage.length > 100 ? '...' : ''),
    sessionId: validatedSessionId || 'new'
  });

  // Process through RAG pipeline
  const response = await ragPipeline.processRequest(validatedMessage, validatedSessionId);

  // Log processing results
  logger.info('Response generated', {
    processingTime: `${response.processingTime}ms`,
    apiCallsMade: response.apiCallsMade,
    phases: response.phasesExecuted ? response.phasesExecuted.join(', ') : 'error',
    recipeDataFound: response.recipeDataFound || 0
  });

  res.json({
    message: response.message,
    sessionId: response.sessionId,
    timestamp: new Date().toISOString(),
    ...(process.env.NODE_ENV === 'development' && {
      debug: {
        processingTime: response.processingTime,
        apiCallsMade: response.apiCallsMade,
        phasesExecuted: response.phasesExecuted,
        recipeDataFound: response.recipeDataFound || 0
      }
    }),
    ...(response.error && process.env.NODE_ENV === 'development' && {
      error: {
        occurred: true,
        message: response.errorMessage
      }
    })
  });
}));

// Helper function for test cases
async function runTestCases(ragPipeline) {
  const testCases = [
    { message: "Hello", description: "Simple greeting" },
    { message: "chicken recipes", description: "Basic recipe search" },
    { message: "vegetarian pasta dishes", description: "Filter search" },
    { message: "healthy breakfast options", description: "Complex query" }
  ];

  const results = [];
  
  for (const testCase of testCases) {
    try {
      logger.debug(`Testing: ${testCase.description}`);
      
      const response = await ragPipeline.processRequest(testCase.message);
      
      results.push({
        ...testCase,
        success: true,
        response: response.message.substring(0, 200) + '...',
        processingTime: response.processingTime,
        apiCalls: response.apiCallsMade,
        phases: response.phasesExecuted
      });
    } catch (error) {
      results.push({
        ...testCase,
        success: false,
        error: error.message
      });
    }
  }

  return results;
}

/**
 * @swagger
 * /api/test:
 *   post:
 *     summary: Run test cases (Development only)
 *     description: Executes a series of test cases against the RAG pipeline to verify functionality. Only available in development environment.
 *     tags: [Debug]
 *     responses:
 *       200:
 *         description: Test results generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 service:
 *                   type: string
 *                   example: "ChefSue Backend Test Suite"
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                 results:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       message:
 *                         type: string
 *                       description:
 *                         type: string
 *                       success:
 *                         type: boolean
 *                       response:
 *                         type: string
 *                       processingTime:
 *                         type: number
 *                       apiCalls:
 *                         type: number
 *                       phases:
 *                         type: array
 *                         items:
 *                           type: string
 *                       error:
 *                         type: string
 *       404:
 *         description: Endpoint not available in production
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
if (process.env.NODE_ENV === 'development') {
  app.post('/api/test', asyncHandler(async (req, res) => {
    const results = await runTestCases(ragPipeline);
    res.json({
      service: 'ChefSue Backend Test Suite',
      timestamp: new Date().toISOString(),
      results
    });
  }));
}

// 404 handler
app.use(notFoundHandler);

// Global error handler
app.use(errorHandler);

// Start server
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  logger.info('ChefSue Backend started', {
    port: PORT,
    environment: process.env.NODE_ENV || 'development',
    aiService: process.env.BEDROCK_MODEL_ID || 'Not configured',
    mealdbService: process.env.MEALDB_BASE_URL ? 'Connected' : 'Not configured',
    endpoints: {
      chat: 'POST /api/chat',
      health: 'GET /health',
      stats: 'GET /stats (dev only)'
    }
  });

  // Perform initial health check
  ragPipeline.healthCheck().then(health => {
    if (health.healthy) {
      logger.info('All services are healthy and ready!');
    } else {
      logger.warn('Some services are not healthy', { checks: health.checks });
      Object.entries(health.checks).forEach(([service, status]) => {
        logger[status ? 'info' : 'error'](`Service ${service}: ${status ? 'healthy' : 'unhealthy'}`);
      });
    }
  }).catch(error => {
    logger.error('Health check failed', { error: error.message });
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    logger.info('Server closed. Exiting process.');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received. Shutting down gracefully...');
  server.close(() => {
    logger.info('Server closed. Exiting process.');
    process.exit(0);
  });
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', { error: error.message, stack: error.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection', { reason: reason?.message || reason, promise: promise.toString() });
  process.exit(1);
});

module.exports = app;
const { v4: uuidv4 } = require('uuid');
const AIService = require('./aiService');
const MealDBService = require('./mealdbService');
const { validateApiCalls } = require('../utils/validators');
const logger = require('../utils/logger');

class SessionManager {
  constructor() {
    this.sessions = new Map();
    this.maxConversationLength = parseInt(process.env.MAX_CONVERSATION_LENGTH) || 10;
    this.sessionTimeoutMinutes = parseInt(process.env.SESSION_TIMEOUT_MINUTES) || 30;
    
    // Start cleanup interval
    this.startCleanup();
  }

  getSession(sessionId) {
    if (!sessionId) {
      return this.createSession();
    }

    const session = this.sessions.get(sessionId);
    if (!session) {
      return this.createSession(sessionId);
    }

    // Update last activity
    session.lastActivity = new Date();
    return session;
  }

  createSession(id = null) {
    const sessionId = id || uuidv4();
    const session = {
      id: sessionId,
      history: [],
      lastMealData: null,
      createdAt: new Date(),
      lastActivity: new Date()
    };
    
    this.sessions.set(sessionId, session);
    return session;
  }

  addMessage(sessionId, userMessage, assistantResponse) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Add user message
    session.history.push({
      role: 'user',
      content: userMessage,
      timestamp: new Date()
    });

    // Add assistant response
    session.history.push({
      role: 'assistant',
      content: assistantResponse,
      timestamp: new Date()
    });

    // Keep only recent messages
    if (session.history.length > this.maxConversationLength * 2) { // *2 for user+assistant pairs
      session.history = session.history.slice(-this.maxConversationLength * 2);
    }

    session.lastActivity = new Date();
  }

  startCleanup() {
    setInterval(() => {
      this.cleanupExpiredSessions();
    }, 15 * 60 * 1000); // Run every 15 minutes
  }

  cleanupExpiredSessions() {
    const now = new Date();
    const expiredSessions = [];

    for (const [sessionId, session] of this.sessions) {
      const timeDiff = now - session.lastActivity;
      const timeoutMs = this.sessionTimeoutMinutes * 60 * 1000;
      
      if (timeDiff > timeoutMs) {
        expiredSessions.push(sessionId);
      }
    }

    expiredSessions.forEach(sessionId => {
      this.sessions.delete(sessionId);
    });

    if (expiredSessions.length > 0) {
      logger.info(`Cleaned up ${expiredSessions.length} expired sessions`);
    }
  }

  getStats() {
    return {
      totalSessions: this.sessions.size,
      activeSessions: Array.from(this.sessions.values()).filter(
        session => (new Date() - session.lastActivity) < 5 * 60 * 1000 // Active in last 5 minutes
      ).length
    };
  }
}

class RAGPipeline {
  constructor() {
    this.aiService = new AIService();
    this.mealdbService = new MealDBService();
    this.sessionManager = new SessionManager();
  }

  async processRequest(userMessage, sessionId = null) {
    const startTime = Date.now();
    let session;
    
    try {
      // Get or create session
      session = this.sessionManager.getSession(sessionId);
      
      // Phase 1: Analyze intent and determine API calls
      logger.debug('Phase 1: Analyzing user intent...');
      const aiResponse = await this.aiService.analyzePipeline(
        userMessage, 
        session.history
      );

      // If direct response (no API needed)
      if (aiResponse.direct_response) {
        const response = aiResponse.direct_response;
        this.sessionManager.addMessage(session.id, userMessage, response);
        
        return {
          message: response,
          sessionId: session.id,
          processingTime: Date.now() - startTime,
          apiCallsMade: 0,
          phasesExecuted: ['direct_response']
        };
      }

      // Validate API calls
      if (!aiResponse.api_calls || !Array.isArray(aiResponse.api_calls)) {
        throw new Error('AI service returned invalid response format');
      }

      validateApiCalls(aiResponse.api_calls);

      // Execute initial API calls
      logger.debug(`Phase 1: Executing ${aiResponse.api_calls.length} API calls...`);
      const initialData = await this.mealdbService.executeBatch(aiResponse.api_calls);
      let totalApiCalls = aiResponse.api_calls.length;
      
      // Filter out error responses for processing
      const successfulData = initialData.filter(result => !result.error);
      
      // Phase 2: If we have filter results, select specific recipes
      let detailData = [];
      let phase2Executed = false;
      
      if (this.hasFilterResults(successfulData) && successfulData.length > 0) {
        logger.debug('Phase 2: Selecting specific recipes from filter results...');
        
        try {
          const selectionResponse = await this.aiService.selectRecipes(
            successfulData, 
            userMessage
          );

          if (selectionResponse.api_calls && selectionResponse.api_calls.length > 0) {
            validateApiCalls(selectionResponse.api_calls);
            
            logger.debug(`Phase 2: Executing ${selectionResponse.api_calls.length} detail calls...`);
            detailData = await this.mealdbService.executeBatch(selectionResponse.api_calls);
            totalApiCalls += selectionResponse.api_calls.length;
            phase2Executed = true;
          }
        } catch (error) {
          logger.warn('Phase 2 failed, continuing with filter results', { error: error.message });
        }
      } else {
        logger.debug('Phase 2: Skipped (no filter results or direct search performed)');
      }

      // Combine all meal data
      const allMealData = [...successfulData, ...detailData];
      
      // Store meal data in session for context
      session.lastMealData = allMealData;

      // Phase 3: Synthesize final response
      logger.debug('Phase 3: Synthesizing final response...');
      const finalResponse = await this.aiService.synthesizeResponse(
        allMealData,
        userMessage,
        session.history
      );

      // Update session history
      this.sessionManager.addMessage(session.id, userMessage, finalResponse);

      const phasesExecuted = phase2Executed ? 
        ['intent_analysis', 'recipe_selection', 'synthesis'] : 
        ['intent_analysis', 'synthesis'];

      return {
        message: finalResponse,
        sessionId: session.id,
        processingTime: Date.now() - startTime,
        apiCallsMade: totalApiCalls,
        phasesExecuted,
        recipeDataFound: this.countRecipes(allMealData)
      };

    } catch (error) {
      logger.error('RAG Pipeline Error', { 
        error: error.message, 
        userMessage: userMessage?.substring(0, 100) 
      });
      
      // Try to provide graceful error response
      const errorResponse = this.createErrorResponse(error, userMessage);
      
      if (session) {
        this.sessionManager.addMessage(session.id, userMessage, errorResponse);
      }
      
      return {
        message: errorResponse,
        sessionId: session?.id || uuidv4(),
        processingTime: Date.now() - startTime,
        apiCallsMade: 0,
        error: true,
        errorMessage: error.message
      };
    }
  }

  hasFilterResults(mealData) {
    return mealData.some(result => 
      result.meals && 
      result.meals.length > 0 && 
      this.mealdbService.isFilterResult(result)
    );
  }

  countRecipes(mealData) {
    let count = 0;
    for (const result of mealData) {
      if (result.meals && Array.isArray(result.meals)) {
        count += result.meals.length;
      }
    }
    return count;
  }

  createErrorResponse(error, userMessage) {
    if (error.message.includes('validation')) {
      return "I'm sorry, but there seems to be an issue with your request. Could you please rephrase it or try asking about a specific dish or ingredient?";
    } else if (error.message.includes('unavailable')) {
      return "I'm experiencing some technical difficulties connecting to the recipe database. Please try again in a few moments.";
    } else if (error.message.includes('timeout')) {
      return "The request is taking longer than expected. Please try asking about something more specific.";
    } else {
      return "I'm sorry, I encountered an error while processing your request. Could you please try again or ask about something else?";
    }
  }

  // Health check method
  async healthCheck() {
    const checks = {
      aiService: false,
      mealdbService: false,
      sessions: false
    };

    try {
      checks.aiService = await this.aiService.healthCheck();
    } catch (error) {
      logger.error('AI Service health check failed', { error: error.message });
    }

    try {
      checks.mealdbService = await this.mealdbService.healthCheck();
    } catch (error) {
      logger.error('MealDB Service health check failed', { error: error.message });
    }

    checks.sessions = this.sessionManager.sessions.size >= 0; // Always true

    return {
      healthy: Object.values(checks).every(check => check === true),
      checks,
      sessionStats: this.sessionManager.getStats(),
      timestamp: new Date().toISOString()
    };
  }

  // Get pipeline statistics
  getStats() {
    return {
      sessionManager: this.sessionManager.getStats(),
      mealdbService: this.mealdbService.getStats(),
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = { RAGPipeline, SessionManager };
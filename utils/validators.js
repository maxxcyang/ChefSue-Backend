const { MEALDB_CATEGORIES, COMMON_INGREDIENTS } = require('./prompts');

const ALLOWED_ENDPOINTS = [
  'search.php',
  'filter.php', 
  'lookup.php'
];

const PARAM_RULES = {
  's': { type: 'string', maxLength: 100, required: true },
  'i': { 
    type: 'string', 
    maxLength: 50, 
    required: true,
    enum: COMMON_INGREDIENTS.map(ing => ing.toLowerCase())
  },
  'c': { 
    type: 'string', 
    maxLength: 30, 
    required: true,
    enum: MEALDB_CATEGORIES.map(cat => cat.toLowerCase())
  }
};

const MAX_API_CALLS = parseInt(process.env.MAX_API_CALLS_PER_REQUEST) || 5;
const MAX_MESSAGE_LENGTH = 500;

class ValidationError extends Error {
  constructor(message, code = 'VALIDATION_ERROR') {
    super(message);
    this.name = 'ValidationError';
    this.code = code;
  }
}

function validateUserMessage(message) {
  validateMessageBasics(message);
  validateMessageSecurity(message);
  return message.trim();
}

function validateMessageBasics(message) {
  if (!message || typeof message !== 'string') {
    throw new ValidationError('Message is required and must be a string', 'INVALID_MESSAGE');
  }

  if (message.length > MAX_MESSAGE_LENGTH) {
    throw new ValidationError(`Message too long. Maximum ${MAX_MESSAGE_LENGTH} characters`, 'MESSAGE_TOO_LONG');
  }
}

function validateMessageSecurity(message) {
  const dangerousPatterns = [
    /<script[^>]*>.*?<\/script>/gi,
    /<iframe[^>]*>.*?<\/iframe>/gi,
    /javascript:/gi,
    /on\w+\s*=/gi
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(message)) {
      throw new ValidationError('Message contains potentially dangerous content', 'SECURITY_VIOLATION');
    }
  }
}

function validateSessionId(sessionId) {
  if (!sessionId) return null;
  
  validateSessionIdFormat(sessionId);
  validateSessionIdCharacters(sessionId);
  
  return sessionId;
}

function validateSessionIdFormat(sessionId) {
  if (typeof sessionId !== 'string' || sessionId.length < 8 || sessionId.length > 36) {
    throw new ValidationError('Session ID must be a string between 8-36 characters', 'INVALID_SESSION_ID');
  }
}

function validateSessionIdCharacters(sessionId) {
  const allowedCharsRegex = /^[a-zA-Z0-9\-_]+$/;
  if (!allowedCharsRegex.test(sessionId)) {
    throw new ValidationError('Session ID can only contain letters, numbers, hyphens, and underscores', 'INVALID_SESSION_ID');
  }
}

function validateApiCall(apiCall) {
  validateApiCallStructure(apiCall);
  
  const { endpoint, params } = apiCall;
  validateEndpoint(endpoint);
  validateParams(params);
  validateEndpointSpecificParams(endpoint, params);

  return true;
}

function validateApiCallStructure(apiCall) {
  if (!apiCall || typeof apiCall !== 'object') {
    throw new ValidationError('API call must be an object', 'INVALID_API_CALL');
  }
}

function validateEndpoint(endpoint) {
  if (!endpoint || typeof endpoint !== 'string') {
    throw new ValidationError('Endpoint is required and must be a string', 'INVALID_ENDPOINT');
  }

  if (!ALLOWED_ENDPOINTS.includes(endpoint)) {
    throw new ValidationError(`Endpoint not allowed: ${endpoint}`, 'ENDPOINT_NOT_ALLOWED');
  }
}

function validateParams(params) {
  if (!params || typeof params !== 'object') {
    throw new ValidationError('Params are required and must be an object', 'INVALID_PARAMS');
  }
}

function validateEndpointSpecificParams(endpoint, params) {
  const validators = {
    'search.php': validateSearchParams,
    'filter.php': validateFilterParams,
    'lookup.php': validateLookupParams
  };

  const validator = validators[endpoint];
  if (validator) {
    validator(params);
  }
}

function validateSearchParams(params) {
  if (!params.s) {
    throw new ValidationError('Search parameter "s" is required', 'MISSING_SEARCH_PARAM');
  }
  
  validateParam('s', params.s);
}

function validateFilterParams(params) {
  const hasIngredient = params.i;
  const hasCategory = params.c;
  
  validateFilterParamPresence(hasIngredient, hasCategory);
  validateFilterParamValues(params, hasIngredient, hasCategory);
}

function validateFilterParamPresence(hasIngredient, hasCategory) {
  if (!hasIngredient && !hasCategory) {
    throw new ValidationError('Filter requires either ingredient (i) or category (c) parameter', 'MISSING_FILTER_PARAM');
  }

  if (hasIngredient && hasCategory) {
    throw new ValidationError('Filter can only use one parameter: ingredient (i) or category (c)', 'TOO_MANY_FILTER_PARAMS');
  }
}

function validateFilterParamValues(params, hasIngredient, hasCategory) {
  if (hasIngredient) {
    validateParam('i', params.i);
  }
  
  if (hasCategory) {
    validateParam('c', params.c);
  }
}

function validateLookupParams(params) {
  if (!params.i) {
    throw new ValidationError('Lookup parameter "i" (meal ID) is required', 'MISSING_LOOKUP_PARAM');
  }

  // Meal ID should be numeric string
  if (!/^\d+$/.test(params.i)) {
    throw new ValidationError('Lookup parameter "i" must be a numeric meal ID', 'INVALID_MEAL_ID');
  }
}

function validateParam(paramName, value) {
  const rule = PARAM_RULES[paramName];
  if (!rule) {
    throw new ValidationError(`Unknown parameter: ${paramName}`, 'UNKNOWN_PARAMETER');
  }

  validateParamBasics(paramName, value, rule);
  validateParamEnum(paramName, value, rule);
}

function validateParamBasics(paramName, value, rule) {
  if (rule.required && (!value || value.length === 0)) {
    throw new ValidationError(`Parameter "${paramName}" is required`, 'MISSING_REQUIRED_PARAM');
  }

  if (rule.type === 'string' && typeof value !== 'string') {
    throw new ValidationError(`Parameter "${paramName}" must be a string`, 'INVALID_PARAM_TYPE');
  }

  if (rule.maxLength && value.length > rule.maxLength) {
    throw new ValidationError(`Parameter "${paramName}" too long. Maximum ${rule.maxLength} characters`, 'PARAM_TOO_LONG');
  }
}

function validateParamEnum(paramName, value, rule) {
  // Case-insensitive enum validation for ingredients and categories
  if (rule.enum && paramName !== 'i') { // Skip strict enum for meal ID lookups
    const normalizedValue = value.toLowerCase();
    if (!rule.enum.includes(normalizedValue)) {
      const validOptions = paramName === 'c' ? MEALDB_CATEGORIES : COMMON_INGREDIENTS;
      throw new ValidationError(
        `Invalid ${paramName === 'c' ? 'category' : 'ingredient'}: "${value}". Valid options include: ${validOptions.slice(0, 10).join(', ')}...`,
        'INVALID_ENUM_VALUE'
      );
    }
  }
}

function validateApiCalls(apiCalls) {
  if (!Array.isArray(apiCalls)) {
    throw new ValidationError('API calls must be an array', 'INVALID_API_CALLS_FORMAT');
  }

  if (apiCalls.length === 0) {
    throw new ValidationError('At least one API call is required', 'NO_API_CALLS');
  }

  if (apiCalls.length > MAX_API_CALLS) {
    throw new ValidationError(`Too many API calls. Maximum ${MAX_API_CALLS} allowed`, 'TOO_MANY_API_CALLS');
  }

  apiCalls.forEach((apiCall, index) => {
    try {
      validateApiCall(apiCall);
    } catch (error) {
      throw new ValidationError(`Invalid API call at index ${index}: ${error.message}`, error.code);
    }
  });

  return true;
}

function sanitizeInput(input) {
  if (typeof input !== 'string') return input;
  
  return input
    .trim()
    .replace(/[<>]/g, '') // Remove angle brackets
    .replace(/javascript:/gi, '') // Remove javascript: protocol
    .substring(0, MAX_MESSAGE_LENGTH); // Truncate if too long
}

function isValidJSON(str) {
  try {
    JSON.parse(str);
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = {
  validateUserMessage,
  validateSessionId,
  validateApiCall,
  validateApiCalls,
  sanitizeInput,
  isValidJSON,
  ValidationError,
  MAX_API_CALLS,
  MAX_MESSAGE_LENGTH,
  ALLOWED_ENDPOINTS
};
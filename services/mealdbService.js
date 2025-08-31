const axios = require('axios');
const logger = require('../utils/logger');
require('dotenv').config();

class MealDBService {
  constructor() {
    this.baseURL = process.env.MEALDB_BASE_URL || 'https://www.themealdb.com/api/json/v1/1';
    this.timeout = parseInt(process.env.REQUEST_TIMEOUT_MS) || 30000;
    
    // Create axios instance with default config
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: this.timeout,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });

    // Add response interceptor for logging and error handling
    this.client.interceptors.response.use(
      (response) => {
        logger.debug('MealDB API success', { 
          url: response.config.url, 
          status: response.status 
        });
        return response;
      },
      (error) => {
        logger.error('MealDB API error', { 
          url: error.config?.url, 
          message: error.message 
        });
        return Promise.reject(error);
      }
    );
  }

  async executeCall(endpoint, params) {
    try {
      const url = this.buildURL(endpoint, params);
      const response = await this.client.get(url);
      return this.processResponse(response.data, endpoint);
    } catch (error) {
      this.logAndThrowError(error, endpoint, params);
    }
  }

  logAndThrowError(error, endpoint, params) {
    this.logServiceError(error, endpoint, params);
    const errorMessage = this.determineErrorMessage(error);
    throw new Error(errorMessage);
  }

  logServiceError(error, endpoint, params) {
    logger.error('MealDB Service Error', { 
      endpoint, 
      params, 
      error: error.message,
      code: error.code 
    });
  }

  determineErrorMessage(error) {
    const errorMessages = {
      'ENOTFOUND': 'MealDB service is currently unavailable',
      'ECONNABORTED': 'MealDB request timed out'
    };

    if (errorMessages[error.code]) {
      return errorMessages[error.code];
    } else if (error.response) {
      return `MealDB API error: ${error.response.status} ${error.response.statusText}`;
    } else {
      return `Network error: ${error.message}`;
    }
  }

  async executeBatch(apiCalls) {
    if (!Array.isArray(apiCalls) || apiCalls.length === 0) {
      return [];
    }

    const promises = this.createBatchPromises(apiCalls);
    const results = await Promise.allSettled(promises);
    
    return this.processBatchResults(results, apiCalls);
  }

  createBatchPromises(apiCalls) {
    return apiCalls.map(async (call) => {
      try {
        return await this.executeCall(call.endpoint, call.params);
      } catch (error) {
        return this.createBatchErrorResult(error, call);
      }
    });
  }

  createBatchErrorResult(error, call) {
    logger.warn('Batch call failed', { 
      endpoint: call.endpoint, 
      params: call.params,
      error: error.message 
    });
    
    return {
      error: true,
      message: error.message,
      endpoint: call.endpoint,
      params: call.params
    };
  }

  processBatchResults(results, apiCalls) {
    return results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        return this.handleRejectedBatchResult(result, apiCalls[index], index);
      }
    });
  }

  handleRejectedBatchResult(result, apiCall, index) {
    logger.error('Batch call rejected', { 
      index, 
      reason: result.reason,
      endpoint: apiCall.endpoint 
    });
    
    return {
      error: true,
      message: result.reason.message || 'Unknown error',
      endpoint: apiCall.endpoint,
      params: apiCall.params
    };
  }

  buildURL(endpoint, params) {
    const queryParams = new URLSearchParams();
    
    // Add parameters based on endpoint
    Object.entries(params).forEach(([key, value]) => {
      if (value !== null && value !== undefined) {
        queryParams.append(key, value.toString());
      }
    });

    return `${endpoint}?${queryParams.toString()}`;
  }

  processResponse(data, endpoint) {
    if (!data) {
      return this.createEmptyResponse('No data received from MealDB');
    }

    if (data.meals === null) {
      return this.createEmptyResponse(`No results found for ${endpoint}`);
    }

    if (data.meals && Array.isArray(data.meals)) {
      return this.createValidResponse(data.meals);
    }

    return this.createUnexpectedResponse(data);
  }

  createEmptyResponse(message) {
    return { 
      meals: null, 
      message,
      isEmpty: true
    };
  }

  createValidResponse(meals) {
    return {
      meals,
      count: meals.length,
      isEmpty: false
    };
  }

  createUnexpectedResponse(data) {
    return {
      meals: null,
      message: 'Unexpected response format from MealDB',
      rawData: data,
      isEmpty: true
    };
  }

  // Specific API methods for different endpoints
  async searchByName(query) {
    return await this.executeCall('search.php', { s: query });
  }

  async filterByIngredient(ingredient) {
    return await this.executeCall('filter.php', { i: ingredient });
  }

  async filterByCategory(category) {
    return await this.executeCall('filter.php', { c: category });
  }

  async lookupById(mealId) {
    return await this.executeCall('lookup.php', { i: mealId });
  }

  async getRandomMeal() {
    return await this.executeCall('random.php', {});
  }

  // Helper methods
  hasResults(response) {
    return response && response.meals && response.meals.length > 0 && !response.isEmpty;
  }

  isFilterResult(response) {
    // Filter results only have idMeal, strMeal, strMealThumb
    if (this.hasResults(response)) {
      const firstMeal = response.meals[0];
      // Lookup results have strInstructions, filter results don't
      return !firstMeal.strInstructions;
    }
    return false;
  }

  extractMealIds(filterResponse) {
    if (this.hasResults(filterResponse)) {
      return filterResponse.meals.map(meal => meal.idMeal);
    }
    return [];
  }

  // Get available categories (could be cached)
  async getCategories() {
    try {
      return await this.executeCall('categories.php', {});
    } catch (error) {
      logger.warn('Failed to fetch categories, using fallback', { error: error.message });
      return this.getFallbackCategories();
    }
  }

  getFallbackCategories() {
    const categoryNames = [
      'Beef', 'Chicken', 'Dessert', 'Lamb', 'Miscellaneous', 
      'Pasta', 'Pork', 'Seafood', 'Side', 'Starter', 
      'Vegan', 'Vegetarian', 'Breakfast', 'Goat'
    ];

    return {
      meals: categoryNames.map(name => ({ strCategory: name }))
    };
  }

  // Health check method
  async healthCheck() {
    try {
      const response = await this.client.get('categories.php', { timeout: 5000 });
      return response.status === 200;
    } catch (error) {
      logger.error('MealDB Health Check Failed', { error: error.message });
      return false;
    }
  }

  // Statistics method for debugging
  getStats() {
    return {
      baseURL: this.baseURL,
      timeout: this.timeout,
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = MealDBService;
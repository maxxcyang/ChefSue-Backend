const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const { createPhase1Prompt, createPhase2Prompt, createSynthesisPrompt } = require('../utils/prompts');
const { isValidJSON } = require('../utils/validators');
const logger = require('../utils/logger');
require('dotenv').config();

class AIService {
  constructor() {
    this.bedrock = new BedrockRuntimeClient({
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    });
    
    this.modelId = process.env.BEDROCK_MODEL_ID || 'mistral.mistral-7b-instruct-v0:2';
    this.timeout = parseInt(process.env.REQUEST_TIMEOUT_MS) || 30000;
  }

  async analyzePipeline(userMessage, conversationHistory = []) {
    const prompt = createPhase1Prompt(userMessage, conversationHistory);
    
    try {
      const response = await this.invokeModel(prompt);
      return this.parseAnalysisResponse(response);
    } catch (error) {
      logger.error('AI Pipeline Analysis Error', { error: error.message });
      throw new Error(`Failed to analyze user intent: ${error.message}`);
    }
  }

  parseAnalysisResponse(response) {
    // Try to parse as JSON first (structured response)
    if (isValidJSON(response)) {
      const parsed = JSON.parse(response);
      if (parsed.api_calls && Array.isArray(parsed.api_calls)) {
        return parsed;
      }
    }
    
    // If not valid JSON or doesn't have api_calls, return as direct response
    return { direct_response: response };
  }

  async selectRecipes(filterResults, userMessage) {
    const prompt = createPhase2Prompt(userMessage, filterResults);
    
    try {
      const response = await this.invokeModel(prompt);
      return this.parseSelectionResponse(response, filterResults);
    } catch (error) {
      logger.error('Recipe Selection Error', { error: error.message });
      return this.createFallbackSelectionResult(filterResults);
    }
  }

  parseSelectionResponse(response, filterResults) {
    if (isValidJSON(response)) {
      const parsed = JSON.parse(response);
      if (parsed.api_calls && Array.isArray(parsed.api_calls)) {
        return parsed;
      }
    }
    
    // Fallback: if AI doesn't return valid JSON, select first 3 meals
    return this.createFallbackSelectionResult(filterResults);
  }

  createFallbackSelectionResult(filterResults) {
    const fallbackCalls = this.createFallbackSelection(filterResults);
    return { api_calls: fallbackCalls };
  }

  async synthesizeResponse(mealData, userMessage, conversationHistory = []) {
    const prompt = createSynthesisPrompt(userMessage, mealData, conversationHistory);
    
    try {
      const response = await this.invokeModel(prompt);
      return response;
      
    } catch (error) {
      logger.error('Response Synthesis Error', { error: error.message });
      return this.createFallbackResponse(mealData, userMessage);
    }
  }

  async invokeModel(prompt) {
    const command = new InvokeModelCommand({
      modelId: this.modelId,
      body: JSON.stringify(this.formatPromptForModel(prompt)),
      contentType: 'application/json',
      accept: 'application/json',
    });

    const response = await Promise.race([
      this.bedrock.send(command),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Request timeout')), this.timeout)
      )
    ]);

    const responseBody = new TextDecoder().decode(response.body);
    const parsed = JSON.parse(responseBody);

    return this.extractResponseText(parsed);
  }

  formatPromptForModel(prompt) {
    const baseConfig = this.getBaseConfig();
    const formatters = this.getModelFormatters(baseConfig, prompt);
    const modelType = this.detectModelType(formatters);
    
    return modelType ? formatters[modelType]() : { ...baseConfig, prompt };
  }

  getBaseConfig() {
    return {
      max_tokens: 2048,
      temperature: 0.7,
      top_p: 0.9,
    };
  }

  getModelFormatters(baseConfig, prompt) {
    return {
      mistral: () => ({
        ...baseConfig,
        prompt: `<s>[INST] ${prompt} [/INST]`,
        stop: ['</s>']
      }),
      claude: () => ({
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: 2048,
        temperature: 0.7,
        top_p: 0.9,
        messages: [
          {
            role: "user",
            content: prompt
          }
        ]
      }),
      llama: () => ({
        ...baseConfig,
        prompt: `<|begin_of_text|><|start_header_id|>user<|end_header_id|>\n${prompt}<|eot_id|><|start_header_id|>assistant<|end_header_id|>`
      })
    };
  }

  detectModelType(formatters) {
    return Object.keys(formatters).find(type => this.modelId.includes(type));
  }

  extractResponseText(parsed) {
    // Handle different model response formats
    if (parsed.outputs && parsed.outputs[0]?.text) {
      return parsed.outputs[0].text.trim();
    } else if (parsed.completion) {
      return parsed.completion.trim();
    } else if (parsed.content && parsed.content[0]?.text) {
      return parsed.content[0].text.trim();
    } else if (parsed.text) {
      return parsed.text.trim();
    } else {
      throw new Error('Invalid response format from AI model');
    }
  }

  createFallbackSelection(filterResults) {
    const fallbackCalls = [];
    
    for (const result of filterResults) {
      if (result.meals && result.meals.length > 0) {
        // Take first 3 meals from each filter result
        const selectedMeals = result.meals.slice(0, 3);
        for (const meal of selectedMeals) {
          fallbackCalls.push({
            endpoint: 'lookup.php',
            params: { i: meal.idMeal }
          });
          
          // Don't exceed max calls
          if (fallbackCalls.length >= 3) break;
        }
        
        if (fallbackCalls.length >= 3) break;
      }
    }
    
    return fallbackCalls;
  }

  createFallbackResponse(mealData, userMessage) {
    if (!mealData || mealData.length === 0) {
      return "I'm sorry, I couldn't find any recipes matching your request. Could you try asking about a specific dish or ingredient?";
    }

    const recipes = this.extractRecipesFromMealData(mealData);
    
    if (recipes.length === 0) {
      return "I found some results but couldn't extract the recipe details. Please try a different search term.";
    }

    return this.buildFallbackResponseText(recipes);
  }

  extractRecipesFromMealData(mealData) {
    const recipes = [];
    let recipeCount = 0;

    for (const result of mealData) {
      if (result.meals && result.meals.length > 0) {
        for (const meal of result.meals) {
          if (recipeCount >= 3) break;
          recipes.push(meal);
          recipeCount++;
        }
        if (recipeCount >= 3) break;
      }
    }

    return recipes;
  }

  buildFallbackResponseText(recipes) {
    let response = "Here are some recipes I found for you:\n\n";

    for (const meal of recipes) {
      response += this.formatMealForFallback(meal);
    }

    response += "Would you like detailed instructions for any of these recipes?";
    return response;
  }

  formatMealForFallback(meal) {
    let mealText = `**${meal.strMeal}**\n`;
    
    if (meal.strCategory) {
      mealText += `Category: ${meal.strCategory}\n`;
    }
    
    const ingredients = this.extractMealIngredients(meal);
    if (ingredients.length > 0) {
      mealText += `Key ingredients: ${ingredients.join(', ')}\n`;
    }
    
    return mealText + '\n';
  }

  extractMealIngredients(meal) {
    const ingredients = [];
    for (let i = 1; i <= 6; i++) {
      const ingredient = meal[`strIngredient${i}`];
      if (ingredient && ingredient.trim()) {
        ingredients.push(ingredient.trim());
      }
    }
    return ingredients;
  }

  // Health check method
  async healthCheck() {
    try {
      const response = await this.invokeModel("Say 'OK' if you can respond.");
      return response.toLowerCase().includes('ok');
    } catch (error) {
      logger.error('AI Service Health Check Failed', { error: error.message });
      return false;
    }
  }
}

module.exports = AIService;
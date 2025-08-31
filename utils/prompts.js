const MEALDB_CATEGORIES = [
  'Beef', 'Breakfast', 'Chicken', 'Dessert', 'Goat', 'Lamb', 
  'Miscellaneous', 'Pasta', 'Pork', 'Seafood', 'Side', 'Starter', 
  'Vegan', 'Vegetarian'
];

const COMMON_INGREDIENTS = [
  'Chicken', 'Salmon', 'Beef', 'Pork', 'Avocado', 'Bacon', 'Basil', 
  'Basmati Rice', 'Bread', 'Broccoli', 'Brown Rice', 'Butter', 'Carrots',
  'Cheddar Cheese', 'Cheese', 'Cherry Tomatoes', 'Chicken Breast', 
  'Chicken Stock', 'Chickpeas', 'Cilantro', 'Coconut Milk', 'Cod',
  'Coriander', 'Cream', 'Cucumber', 'Cumin', 'Eggs', 'Extra Virgin Olive Oil',
  'Flour', 'Garlic', 'Ginger', 'Honey', 'Lemon', 'Lime', 'Milk', 'Mushrooms',
  'Onion', 'Parsley', 'Pasta', 'Potatoes', 'Prawns', 'Rice', 'Salt',
  'Spinach', 'Tomatoes', 'Tuna', 'Yogurt', 'Black Pepper', 'Olive Oil',
  'Soy Sauce', 'Vinegar', 'Wine', 'Sugar', 'Lamb', 'Turkey', 'Duck',
  'Asparagus', 'Aubergine', 'Bell Pepper', 'Cabbage', 'Celery', 'Courgettes',
  'Green Beans', 'Leeks', 'Peas', 'Red Onion', 'Sweet Potato'
];

function createPhase1Prompt(userMessage, conversationHistory = []) {
  const contextString = buildPhase1Context(conversationHistory);
  const systemPrompt = buildPhase1SystemPrompt();
  const examples = buildPhase1Examples();
  
  return `${systemPrompt}

${examples}

User request: "${userMessage}"${contextString}

OUTPUT FORMAT:
- Recipe requests: Return ONLY {"api_calls": [...]} as valid JSON
- Greetings/chat: Return ONLY a plain text response (markdown formatting is OK)

DO NOT:
- Include any text before or after JSON when returning api_calls
- Mix JSON and text in the same response
- Return the original prompt or echo the user's message
- Use categories not in the exact list above`;
}

function buildPhase1Context(conversationHistory) {
  return conversationHistory.length > 0 
    ? `\n\nConversation context:\n${conversationHistory.map(msg => `${msg.role}: ${msg.content}`).join('\n')}\n`
    : '';
}

function buildPhase1SystemPrompt() {
  return `You are a cooking assistant with access to MealDB API.

CRITICAL RULES:
1. For cuisine types (Korean, Italian, Chinese, Mexican, Indian, etc.) → ALWAYS use search.php
2. For categories → ONLY use these exact values: ${MEALDB_CATEGORIES.join(', ')}
3. Unknown categories → Use search.php instead
4. Multiple requests → Return multiple API calls

API endpoints:
- search.php?s={query} - Search by name or cuisine type
- filter.php?c={category} - Filter by category (MUST be from list above)
- filter.php?i={ingredient} - Filter by main ingredient`;
}

function buildPhase1Examples() {
  return `Examples:
"korean recipes" → {"api_calls": [{"endpoint": "search.php", "params": {"s": "korean"}}]}
"italian pasta" → {"api_calls": [{"endpoint": "search.php", "params": {"s": "italian pasta"}}]}
"mexican food" → {"api_calls": [{"endpoint": "search.php", "params": {"s": "mexican"}}]}
"vegetarian meals" → {"api_calls": [{"endpoint": "filter.php", "params": {"c": "Vegetarian"}}]}
"beef dishes" → {"api_calls": [{"endpoint": "filter.php", "params": {"c": "Beef"}}]}
"dishes with chicken" → {"api_calls": [{"endpoint": "filter.php", "params": {"i": "Chicken"}}]}
"hello" → "Hello! I'm ChefSue, your cooking assistant. I can help you find delicious recipes!"
"thanks" → "You're welcome! Let me know if you need any recipe suggestions."`;
}

function createPhase2Prompt(userMessage, filterResults) {
  const mealsText = formatFilterResults(filterResults);
  
  return buildPhase2PromptText(userMessage, mealsText);
}

function formatFilterResults(filterResults) {
  return filterResults.map(result => {
    if (result.meals && result.meals.length > 0) {
      return result.meals.map(meal => `- ${meal.strMeal} (ID: ${meal.idMeal})`).join('\n');
    }
    return 'No meals found';
  }).join('\n');
}

function buildPhase2PromptText(userMessage, mealsText) {
  return `The user asked: "${userMessage}"

Here are meal results from filtering:
${mealsText}

Select up to 3 most relevant meals for detailed recipes.
Consider: relevance, variety, user intent.

Return JSON:
{"api_calls": [{"endpoint": "lookup.php", "params": {"i": "mealId"}}...]}

Note: This phase is skipped if:
- No filter results were returned
- Direct recipe search was performed
- Initial API calls returned full recipe details`;
}

function createSynthesisPrompt(userMessage, mealData, conversationHistory = []) {
  const contextString = buildContextString(conversationHistory);
  const dataText = formatMealData(mealData);
  const systemPrompt = buildSynthesisSystemPrompt();

  return `${systemPrompt}

User asked: "${userMessage}"${contextString}

Recipe data available:
${dataText || 'No recipe data found'}

${buildSynthesisInstructions()}`;
}

function buildSynthesisSystemPrompt() {
  return 'You are ChefSue, a friendly cooking assistant.';
}

function buildSynthesisInstructions() {
  return `Provide a helpful, concise response highlighting:
- Recipe names and brief descriptions
- Key ingredients
- Basic preparation steps
- Cooking tips if relevant

Keep response conversational and under 300 words.
If no recipe data is available, provide general cooking advice related to the user's query.`;
}

function buildContextString(conversationHistory) {
  return conversationHistory.length > 0 
    ? `\n\nConversation context:\n${conversationHistory.slice(-4).map(msg => `${msg.role}: ${msg.content}`).join('\n')}\n`
    : '';
}

function formatMealData(mealData) {
  if (!mealData || mealData.length === 0) {
    return '';
  }

  return mealData.map(result => {
    if (result.meals && result.meals.length > 0) {
      return result.meals.map(formatMealInfo).join('\n\n');
    }
    return 'No detailed recipe data available';
  }).join('\n\n');
}

function formatMealInfo(meal) {
  const ingredients = extractIngredients(meal);
  const ingredientText = formatIngredientText(ingredients);
  const instructions = formatInstructionText(meal.strInstructions);
  const image = meal.strMealThumb ? `Image: ${meal.strMealThumb}` : '';
  
  return buildMealInfoText(meal, ingredientText, instructions, image);
}

function formatIngredientText(ingredients) {
  return ingredients.length > 0 
    ? `Ingredients: ${ingredients.slice(0, 8).join(', ')}${ingredients.length > 8 ? '...' : ''}`
    : '';
}

function formatInstructionText(instructions) {
  return instructions 
    ? `Instructions: ${instructions.substring(0, 200)}...`
    : 'Instructions: N/A';
}

function buildMealInfoText(meal, ingredientText, instructions, image) {
  return `**${meal.strMeal}**
Category: ${meal.strCategory || 'N/A'}
Area: ${meal.strArea || 'N/A'}
${ingredientText}
${instructions}
${image}`.trim();
}

function extractIngredients(meal) {
  const ingredients = [];
  for (let i = 1; i <= 20; i++) {
    const ingredient = meal[`strIngredient${i}`];
    const measure = meal[`strMeasure${i}`];
    if (ingredient && ingredient.trim()) {
      ingredients.push(`${measure ? measure.trim() + ' ' : ''}${ingredient.trim()}`);
    }
  }
  return ingredients;
}

module.exports = {
  createPhase1Prompt,
  createPhase2Prompt,
  createSynthesisPrompt,
  MEALDB_CATEGORIES,
  COMMON_INGREDIENTS
};
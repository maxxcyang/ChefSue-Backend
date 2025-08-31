# ChefSue Backend - RAG Pipeline Design

## Overview
ChefSue Backend is an Express.js server that implements a Retrieval-Augmented Generation (RAG) pipeline combining AI interpretation with MealDB API calls to provide intelligent cooking assistance.

## Architecture

### Core Components

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Client    │────▶│   Express    │────▶│     RAG     │
│   (React    │     │   Server     │     │   Pipeline  │
│   Native)   │◀────│              │◀────│             │
└─────────────┘     └──────────────┘     └─────────────┘
                            │                    │
                            ▼                    ▼
                    ┌──────────────┐     ┌─────────────┐
                    │   Session    │     │     AI      │
                    │  Management  │     │   Service   │
                    └──────────────┘     └─────────────┘
                                                 │
                                          ┌──────┴──────┐
                                          ▼             ▼
                                   ┌─────────────┐ ┌─────────────┐
                                   │   AWS       │ │   MealDB    │
                                   │   Bedrock   │ │   Service   │
                                   └─────────────┘ └─────────────┘
```

## Data Flow

### Two-Phase AI Pipeline

#### Phase 1: Intent Analysis & API Planning
```
User Input → AI Analysis → Structured API Calls
```

**Input Example:**
```
"I want healthy chicken recipes"
```

**AI Output:**
```json
{
  "api_calls": [
    {
      "endpoint": "filter.php",
      "params": {"i": "chicken"}
    }
  ]
}
```

#### Phase 2: Recipe Selection & Detail Fetching (Conditional)
```
Filter Results → AI Selection → Detail API Calls → Final Synthesis
```

**Only executed if filter returns results. Skipped if:**
- No results from filter
- Direct recipe search was performed
- API call returned empty

**After filter returns 30 chicken meals:**
- AI analyzes meal names/thumbnails
- Selects relevant meals based on "healthy" criteria
- Generates lookup calls for selected meals

**AI Output:**
```json
{
  "api_calls": [
    {"endpoint": "lookup.php", "params": {"i": "52940"}},
    {"endpoint": "lookup.php", "params": {"i": "52941"}},
    {"endpoint": "lookup.php", "params": {"i": "52942"}}
  ]
}
```

#### Final Synthesis
```
Full Recipe Data → AI Synthesis → User Response
```

## API Endpoints

### `/api/chat` (POST)
Main chat endpoint for processing user queries.

**Request:**
```json
{
  "message": "Show me pasta recipes",
  "sessionId": "uuid-optional"
}
```

**Response:**
```json
{
  "message": "Here are 3 delicious pasta recipes...",
  "sessionId": "uuid"
}
```

### `/health` (GET)
Health check endpoint.

**Response:**
```json
{
  "status": "healthy",
  "service": "ChefSue Backend"
}
```

## Services Architecture

### 1. AI Service (`services/aiService.js`)

**Responsibilities:**
- Initialize AWS Bedrock client
- Generate structured API calls from prompts
- Select recipes from filter results
- Synthesize final responses

**Key Methods:**
```javascript
async analyzePipeline(userMessage, conversationHistory)
// Returns: { api_calls: [...] } or string response

async selectRecipes(filterResults, userIntent)
// Returns: { api_calls: [...] } for detailed lookups

async synthesizeResponse(mealData, userMessage, history)
// Returns: string response for user
```

### 2. MealDB Service (`services/mealdbService.js`)

**Supported Endpoints:**
- `search.php?s={name}` - Search by meal name
- `filter.php?i={ingredient}` - Filter by main ingredient
- `filter.php?c={category}` - Filter by category
- `lookup.php?i={id}` - Get full recipe details

**Key Methods:**
```javascript
async executeCall(endpoint, params)
// Returns: parsed MealDB response

async executeBatch(apiCalls)
// Returns: array of MealDB responses
```

### 3. RAG Pipeline (`services/ragPipeline.js`)

**Orchestration Flow:**
```javascript
async processRequest(userMessage, sessionId) {
  // 1. Get or create session
  const session = sessionManager.getSession(sessionId)
  
  // 2. Phase 1: Analyze intent
  const initialCalls = await aiService.analyzePipeline(
    userMessage, 
    session.history
  )
  
  // 3. Execute initial MealDB calls
  const initialData = await mealdbService.executeBatch(initialCalls)
  
  // 4. Phase 2: If filter results exist and not empty, select specific recipes
  if (hasFilterResults(initialData) && initialData.length > 0) {
    const detailCalls = await aiService.selectRecipes(
      initialData, 
      userMessage
    )
    const detailData = await mealdbService.executeBatch(detailCalls)
    initialData.push(...detailData)
  }
  // Skip Phase 2 if no results or direct search was performed
  
  // 5. Synthesize final response
  const response = await aiService.synthesizeResponse(
    initialData, 
    userMessage,
    session.history
  )
  
  // 6. Update session
  session.addMessage(userMessage, response)
  
  return { message: response, sessionId: session.id }
}
```

## Prompt Engineering

### Phase 1 Prompt Template
```
You are a cooking assistant with access to MealDB API.

Available endpoints:
- search.php?s={name}: Search recipes by name
- filter.php?i={ingredient}: Filter by main ingredient
- filter.php?c={category}: Filter by category

Available categories:
Beef, Chicken, Dessert, Lamb, Miscellaneous, Pasta, Pork, Seafood, 
Side, Starter, Vegan, Vegetarian, Breakfast, Goat

Common ingredients:
Chicken, Salmon, Beef, Pork, Avocado, Apple, Apricot, Bacon, Basil,
Beans, Rice, Pasta, Potato, Tomato, Mushroom, Eggs, Milk, Butter,
Garlic, Onion, Cheese, Carrot, Broccoli, Spinach, Lemon, Lime,
Bread, Sugar, Salt, Pepper, Oil, Vinegar, and more...

User request: "{userMessage}"

Analyze the user's intent and return JSON with needed API calls.
If no API needed, return a direct response as a string.

Examples:
"chicken pasta" → {"api_calls": [{"endpoint": "search.php", "params": {"s": "chicken pasta"}}]}
"vegetarian meals" → {"api_calls": [{"endpoint": "filter.php", "params": {"c": "Vegetarian"}}]}
"dishes with chicken" → {"api_calls": [{"endpoint": "filter.php", "params": {"i": "Chicken"}}]}
"seafood and pasta dishes" → {"api_calls": [{"endpoint": "filter.php", "params": {"c": "Seafood"}}, {"endpoint": "filter.php", "params": {"c": "Pasta"}}]}
"hello" → "Hello! I'm ChefSue, your cooking assistant..."

Note: You can return multiple api_calls for complex requests.
```

### Phase 2 Prompt Template (Conditional - Only if filter results exist)
```
The user asked: "{userMessage}"

Here are meal results from filtering:
{filterResults}

Select up to 3 most relevant meals for detailed recipes.
Consider: relevance, variety, user intent.

Return JSON:
{"api_calls": [{"endpoint": "lookup.php", "params": {"i": "mealId"}}...]}

Note: This phase is skipped if:
- No filter results were returned
- Direct recipe search was performed
- Initial API calls returned full recipe details
```

### Synthesis Prompt Template
```
You are ChefSue, a friendly cooking assistant.

User asked: "{userMessage}"

Recipe data available:
{mealData}

Provide a helpful, concise response highlighting:
- Recipe names and brief descriptions
- Key ingredients
- Basic preparation steps
- Cooking tips if relevant

Keep response conversational and under 300 words.
```

## Session Management

### Structure
```javascript
class Session {
  id: string              // UUID
  history: Message[]      // Conversation history
  lastMealData: Object    // Recent API results for context
  createdAt: Date
  lastActivity: Date
}

class Message {
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}
```

### Memory Management
- Sessions stored in-memory Map
- Max 10 messages per session (sliding window)
- Session timeout: 30 minutes
- Cleanup runs every 15 minutes

## Safety & Validation

### API Call Validation
```javascript
// Whitelist of allowed endpoints
const ALLOWED_ENDPOINTS = [
  'search.php',
  'filter.php', 
  'lookup.php'
]

// Parameter validation
const PARAM_RULES = {
  's': { type: 'string', maxLength: 100 },
  'i': { type: 'string', maxLength: 50 },
  'c': { type: 'string', enum: CATEGORIES },
  'a': { type: 'string', enum: AREAS }
}

// Max API calls per request
const MAX_API_CALLS = 5

// Request timeout
const REQUEST_TIMEOUT = 30000 // 30 seconds
```

### Input Sanitization
- Strip HTML/script tags
- Limit message length (500 chars)
- Validate session IDs
- Escape special characters

## Error Handling

### Error Categories
1. **AI Service Errors**
   - Invalid structured output
   - Bedrock API failures
   - Timeout errors

2. **MealDB Errors**
   - API unavailable
   - Invalid responses
   - Rate limiting

3. **Validation Errors**
   - Invalid endpoints
   - Malformed parameters
   - Security violations

### Error Response Format
```json
{
  "error": "User-friendly error message",
  "code": "ERROR_CODE",
  "details": {} // Only in development
}
```

### Fallback Strategies
- If MealDB returns no results → AI provides general cooking advice
- If filter returns empty → Skip Phase 2, provide helpful suggestions
- If AI fails → Return simple keyword-based search
- If all fails → Apologetic message with retry suggestion

## Configuration

### Environment Variables
```env
# Server
PORT=3000

# AWS Bedrock
AWS_ACCESS_KEY_ID=xxx
AWS_SECRET_ACCESS_KEY=xxx
AWS_REGION=us-east-1
BEDROCK_MODEL_ID=mistral.mistral-7b-instruct-v0:2

# MealDB
MEALDB_BASE_URL=https://www.themealdb.com/api/json/v1/1

# Optional
NODE_ENV=development
LOG_LEVEL=info
SESSION_TIMEOUT_MINUTES=30
MAX_CONVERSATION_LENGTH=10
```

## Performance Considerations

### Optimization Strategies
1. **Parallel API Calls**: Execute multiple MealDB lookups concurrently
2. **Early Returns**: Skip Phase 2 if no filter results
3. **Streaming**: Consider streaming for large responses (future)
4. **Connection Pooling**: Reuse HTTP connections

### Metrics to Track
- Response time per phase
- API call success rates
- Session duration
- Most requested queries
- Error frequency by type

## Testing Strategy

### Unit Tests
- AI prompt parsing
- API call validation
- Session management
- Error handling

### Integration Tests
- Full pipeline flow
- Multi-turn conversations
- Error scenarios
- Timeout handling

### Test Cases
```javascript
// Single recipe search
"How to make pad thai"

// Filter with selection
"Healthy vegetarian dinners"

// Multiple filters
"Quick chicken or fish recipes"

// Conversation context
"Tell me more about the second recipe"

// Error handling
"Show me recipes with <script>alert('xss')</script>"
```

## Future Enhancements

### Short Term
1. Response caching (Redis)
2. Rate limiting per user
3. Request logging and analytics
4. More MealDB endpoints (areas, ingredients list)

### Medium Term
1. User preferences storage
2. Recipe recommendations based on history
3. Nutritional information integration
4. Shopping list generation

### Long Term
1. Custom recipe database
2. Image generation for recipes
3. Voice input/output support
4. Multi-language support

## Deployment Considerations

### Development
```bash
npm run dev
# Uses nodemon for auto-reload
# Verbose logging enabled
# CORS allows all origins
```

### Production
```bash
npm start
# PM2 for process management
# Structured logging (JSON)
# CORS restricted to frontend domain
# HTTPS required
```

### Monitoring
- Health checks every 30s
- Memory usage alerts
- Response time tracking
- Error rate monitoring
- AWS CloudWatch integration

## Security Checklist

- [ ] Environment variables secured
- [ ] Input validation implemented
- [ ] SQL injection prevention (N/A - no database)
- [ ] XSS prevention
- [ ] Rate limiting (future)
- [ ] HTTPS only in production
- [ ] API key rotation schedule
- [ ] Audit logging
- [ ] Session hijacking prevention
- [ ] CORS properly configured
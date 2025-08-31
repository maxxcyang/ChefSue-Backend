# CLAUDE.md - Project Information for Claude Code

## Project Overview
**ChefSue Backend** is a Node.js Express server implementing a Retrieval-Augmented Generation (RAG) pipeline for intelligent cooking assistance. It combines AWS Bedrock AI with MealDB API integration to provide contextual recipe recommendations.

## Technology Stack
- **Runtime:** Node.js
- **Framework:** Express.js v5.1.0
- **AI Service:** AWS Bedrock (Mistral 7B Instruct)
- **External API:** MealDB API
- **Key Dependencies:**
  - `@aws-sdk/client-bedrock-runtime` - AWS Bedrock integration
  - `axios` - HTTP requests to MealDB
  - `cors` - Cross-origin resource sharing
  - `dotenv` - Environment variable management
  - `swagger-jsdoc` & `swagger-ui-express` - API documentation
  - `uuid` - Session ID generation

## Project Structure
```
ChefSue-Backend/
├── server.js                 # Main Express server with API endpoints
├── package.json              # Dependencies and scripts
├── .env                      # Environment configuration (not in git)
├── middleware/
│   └── errorHandler.js       # Error handling middleware
├── services/
│   ├── aiService.js          # AWS Bedrock AI integration
│   ├── mealdbService.js      # MealDB API client
│   └── ragPipeline.js        # Main orchestration logic
├── utils/
│   ├── logger.js             # Logging utilities
│   ├── prompts.js            # AI prompt templates
│   └── validators.js         # Input validation
├── checks.sh                 # Code quality check script
└── design.md                 # Detailed technical design document
```

## Key Features
- **Two-Phase RAG Pipeline:** Intent analysis → Recipe selection → Response synthesis
- **Conversational Memory:** Session-based chat with context preservation
- **MealDB Integration:** Access to thousands of recipes with smart filtering
- **Input Validation:** Comprehensive security and error handling
- **Swagger Documentation:** Auto-generated API docs at `/api-docs`

## Available Scripts
```bash
npm start          # Start production server
npm run dev        # Start development server with nodemon
npm test           # Run tests (placeholder)
./checks.sh        # Run comprehensive code quality checks
```

## API Endpoints

### Main Endpoints
- **POST /api/chat** - Process cooking queries through RAG pipeline
- **GET /health** - Service health check
- **GET /stats** - Development statistics (dev only)
- **POST /api/test** - Run test cases (dev only)
- **GET /api-docs** - Swagger API documentation

### Sample Request/Response
```json
// POST /api/chat
{
  "message": "Show me healthy chicken recipes",
  "sessionId": "optional-uuid"
}

// Response
{
  "message": "Here are 3 healthy chicken recipes...",
  "sessionId": "uuid",
  "timestamp": "2025-08-25T..."
}
```

## Environment Configuration
Create `.env` file with:
```env
PORT=3000
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
AWS_REGION=us-east-1
BEDROCK_MODEL_ID=mistral.mistral-7b-instruct-v0:2
MEALDB_BASE_URL=https://www.themealdb.com/api/json/v1/1
NODE_ENV=development
```

## Development Workflow

### Starting Development
1. `npm install` - Install dependencies
2. Configure `.env` with AWS credentials
3. `npm run dev` - Start development server
4. Visit `http://localhost:3000/api-docs` for API documentation

### Code Quality
- Run `./checks.sh` for comprehensive quality checks including:
  - Syntax validation
  - Security vulnerability scanning
  - File structure verification
  - Environment configuration validation
  - Code complexity analysis

### Testing
- Use `/api/test` endpoint in development for pipeline testing
- Test queries: greetings, recipe searches, complex requests
- Monitor health at `/health` endpoint

## Architecture Notes

### RAG Pipeline Flow
1. **Phase 1:** User message → AI analysis → MealDB API calls
2. **Phase 2:** Filter results → AI selection → Detailed recipe lookups (conditional)
3. **Synthesis:** Recipe data + context → Final user response

### Session Management
- In-memory session storage with UUID identifiers
- Conversation history limited to 10 messages
- 30-minute session timeout with automatic cleanup

### Error Handling
- Graceful fallbacks for API failures
- Input validation and sanitization
- Structured error responses
- Comprehensive logging with different levels

## Security Features
- Input sanitization against XSS
- API endpoint validation
- Environment variable protection
- Request timeout handling
- CORS configuration
- No hardcoded secrets in code

## Performance Considerations
- Parallel MealDB API calls
- Early returns to skip unnecessary phases
- Connection pooling for HTTP requests
- Session cleanup to prevent memory leaks

## Common Development Tasks

### Adding New API Endpoints
1. Define routes in `server.js` with Swagger documentation
2. Add validation in `utils/validators.js` if needed
3. Update error handling in `middleware/errorHandler.js`

### Modifying AI Prompts
- Edit templates in `utils/prompts.js`
- Test changes using `/api/test` endpoint
- Consider prompt versioning for A/B testing

### Updating MealDB Integration
- Modify `services/mealdbService.js`
- Add endpoint validation in validators
- Update API documentation

### Debugging Issues
1. Check logs for error details
2. Use `/stats` endpoint for metrics
3. Test with `/api/test` for pipeline verification
4. Run `./checks.sh` for code quality issues

## Deployment Notes
- Ensure all environment variables are configured
- Use PM2 or similar for process management in production
- Set `NODE_ENV=production` to disable debug endpoints
- Configure HTTPS and restrict CORS origins
- Monitor with health checks and logging

This project follows security best practices and is designed for defensive purposes only.
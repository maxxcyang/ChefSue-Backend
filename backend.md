# ChefSue Backend API

Simple Express.js backend for handling AWS Bedrock calls, avoiding React Native compatibility issues.

## Quick Setup

### 1. Create Backend Directory
```bash
mkdir chefsue-backend
cd chefsue-backend
npm init -y
```

### 2. Install Dependencies
```bash
npm install express cors dotenv @aws-sdk/client-bedrock-runtime
npm install -D nodemon
```

### 3. Create `.env` File
```env
PORT=3000
AWS_ACCESS_KEY_ID=your_access_key_here
AWS_SECRET_ACCESS_KEY=your_secret_access_key_here
AWS_REGION=us-east-1
BEDROCK_MODEL_ID=mistral.mistral-7b-instruct-v0:2
```

### 4. Create `server.js`
```javascript
const express = require('express');
const cors = require('cors');
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Initialize Bedrock client
const bedrock = new BedrockRuntimeClient({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// System prompt for ChefSue
const SYSTEM_PROMPT = `You are ChefSue, a friendly and knowledgeable cooking assistant. You specialize in providing practical cooking tips, recipe suggestions, ingredient substitutions, cooking techniques, and food safety advice. 

Your responses should be:
- Concise but helpful
- Easy to understand for home cooks of all skill levels
- Focused on practical, actionable advice
- Encouraging and supportive

Always prioritize food safety and provide clear, step-by-step instructions when appropriate.`;

// Chat endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Format prompt for Mistral
    const prompt = `<s>[INST] ${SYSTEM_PROMPT}\n\nUser: ${message} [/INST]`;

    // Call Bedrock
    const command = new InvokeModelCommand({
      modelId: process.env.BEDROCK_MODEL_ID,
      body: JSON.stringify({
        prompt,
        max_tokens: 2048,
        temperature: 0.7,
        top_p: 0.9,
        stop: ['</s>'],
      }),
      contentType: 'application/json',
      accept: 'application/json',
    });

    const response = await bedrock.send(command);
    const responseBody = new TextDecoder().decode(response.body);
    const parsed = JSON.parse(responseBody);

    if (parsed.outputs && parsed.outputs[0]?.text) {
      res.json({ 
        message: parsed.outputs[0].text,
        timestamp: new Date().toISOString()
      });
    } else {
      throw new Error('Invalid response format from Bedrock');
    }
  } catch (error) {
    console.error('Bedrock error:', error);
    res.status(500).json({ 
      error: 'Failed to get response from cooking assistant',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'ChefSue Backend' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`ChefSue backend running on port ${PORT}`);
});
```

### 5. Update `package.json` Scripts
```json
{
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js"
  }
}
```

### 6. Run the Backend
```bash
npm run dev
```

## React Native Integration

### Update BedrockService.ts
```typescript
export class BedrockService {
  private apiUrl = 'http://localhost:3000/api/chat'; // Use your IP for real device

  async getResponse(userMessage: string): Promise<string> {
    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: userMessage }),
      });

      if (!response.ok) {
        throw new Error('Failed to get response');
      }

      const data = await response.json();
      return data.message;
    } catch (error) {
      console.error('API error:', error);
      throw new Error('Failed to connect to cooking assistant');
    }
  }
}
```

### For iOS Simulator
API URL: `http://localhost:3000/api/chat`

### For Real Device
1. Find your computer's IP: `ifconfig | grep inet`
2. Use: `http://YOUR_IP:3000/api/chat`
3. Add to Info.plist if needed for HTTP:
```xml
<key>NSAppTransportSecurity</key>
<dict>
  <key>NSAllowsArbitraryLoads</key>
  <true/>
</dict>
```

## Production Deployment

### Option 1: Railway
```bash
railway login
railway init
railway add
railway up
```

### Option 2: Heroku
```bash
heroku create chefsue-backend
heroku config:set AWS_ACCESS_KEY_ID=xxx
heroku config:set AWS_SECRET_ACCESS_KEY=xxx
git push heroku main
```

### Option 3: AWS Lambda
Use Serverless Framework:
```bash
npm install -g serverless
serverless create --template aws-nodejs --path chefsue-lambda
```

## Security Best Practices

1. **Rate Limiting**
```javascript
const rateLimit = require('express-rate-limit');
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 10 // limit each IP to 10 requests per minute
});
app.use('/api/chat', limiter);
```

2. **API Key Authentication**
```javascript
app.use((req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (apiKey !== process.env.API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});
```

3. **Input Validation**
```javascript
const maxMessageLength = 500;
if (message.length > maxMessageLength) {
  return res.status(400).json({ error: 'Message too long' });
}
```

4. **CORS Configuration**
```javascript
const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  credentials: true,
};
app.use(cors(corsOptions));
```

## Additional Features

### Conversation History
```javascript
// Store conversation in memory (use Redis/DB for production)
const conversations = new Map();

app.post('/api/chat', async (req, res) => {
  const { message, conversationId } = req.body;
  
  // Get or create conversation history
  const history = conversations.get(conversationId) || [];
  history.push({ role: 'user', content: message });
  
  // Include history in prompt...
  
  // Save response to history
  history.push({ role: 'assistant', content: response });
  conversations.set(conversationId, history.slice(-10)); // Keep last 10 messages
});
```

### Response Caching
```javascript
const NodeCache = require('node-cache');
const cache = new NodeCache({ stdTTL: 600 }); // 10 minute cache

app.post('/api/chat', async (req, res) => {
  const cacheKey = `chat:${message.toLowerCase().trim()}`;
  const cached = cache.get(cacheKey);
  
  if (cached) {
    return res.json({ message: cached, cached: true });
  }
  
  // ... get response from Bedrock
  cache.set(cacheKey, response);
});
```

## Testing

### Test with cURL
```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "How do I make scrambled eggs?"}'
```

### Test with Postman
1. Create POST request to `http://localhost:3000/api/chat`
2. Set body to raw JSON:
```json
{
  "message": "What temperature should I cook chicken to?"
}
```

## Monitoring

Add logging for debugging:
```javascript
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});
```

## Benefits of This Approach

1. ✅ **No React Native compatibility issues** - Backend handles all AWS SDK complexity
2. ✅ **More secure** - AWS credentials never exposed to client
3. ✅ **Easier to debug** - Standard Node.js environment
4. ✅ **Scalable** - Can add caching, rate limiting, multiple models
5. ✅ **Reusable** - Same API works for web, mobile, any client
6. ✅ **Testable** - Easy to test API endpoints independently

## Next Steps

1. Set up the backend following steps 1-6
2. Update your React Native app's BedrockService
3. Test locally with simulator
4. Deploy backend to production
5. Update React Native app with production URL
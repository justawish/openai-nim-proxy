// server.js - OpenAI to NVIDIA NIM API Proxy (Janitor-Compatible)
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// LOG ALL REQUESTS (for debugging Janitor)
app.use((req, res, next) => {
  console.log(`➡️ ${req.method} ${req.path}`);
  next();
});

// NVIDIA NIM API configuration
const NIM_API_BASE = process.env.NIM_API_BASE || 'https://integrate.api.nvidia.com/v1';
const NIM_API_KEY = process.env.NIM_API_KEY;

const MODEL_MAPPING = {
  'gpt-3.5-turbo': 'deepseek-ai/deepseek-r1-0528',
  'gpt-4': 'deepseek-ai/deepseek-r1-0528',
  'gpt-4-turbo': 'deepseek-ai/deepseek-r1-0528',
  'gpt-4o': 'deepseek-ai/deepseek-r1-0528'
};

// Root endpoint (Janitor expects this to respond)
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'NIM Proxy Running' });
});

// Health
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'OpenAI → NIM Proxy' });
});

// List models (OpenAI format)
app.get('/v1/models', (req, res) => {
  res.json({
    object: 'list',
    data: Object.keys(MODEL_MAPPING).map(model => ({
      id: model,
      object: 'model',
      created: Date.now(),
      owned_by: 'nvidia-nim-proxy'
    }))
  });
});

/* ==================================================
   🔧 COMPATIBILITY ENDPOINTS FOR JANITOR
   ================================================== */

// OpenAI completions → redirect to chat
app.post('/v1/completions', (req, res) => {
  console.log('🔁 Redirecting /v1/completions → /v1/chat/completions');
  req.url = '/v1/chat/completions';
  app.handle(req, res);
});

// OpenRouter / Anthropics style → also redirect
app.post('/v1/messages', (req, res) => {
  console.log('🔁 Redirecting /v1/messages → /v1/chat/completions');
  req.url = '/v1/chat/completions';
  app.handle(req, res);
});

// Legacy OpenAI route
app.post('/v1/chat', (req, res) => {
  console.log('🔁 Redirecting /v1/chat → /v1/chat/completions');
  req.url = '/v1/chat/completions';
  app.handle(req, res);
});

/* ==================================================
   🔥 MAIN CHAT COMPLETION HANDLER
   ================================================== */

app.post('/v1/chat/completions', async (req, res) => {
  try {
    const { model, messages } = req.body;

    // Resolve model
    const nimModel = MODEL_MAPPING[model] || model;

    const nimRequest = {
      model: nimModel,
      messages,
      temperature: req.body.temperature || 0.7,
      max_tokens: req.body.max_tokens || 2048,
      stream: false
    };

    console.log(`📡 Sending to NIM: ${NIM_API_BASE}/chat/completions`);

    const response = await axios.post(
      `${NIM_API_BASE}/chat/completions`,
      nimRequest,
      {
        headers: {
          Authorization: `Bearer ${NIM_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    // Convert NIM response to OpenAI format
    res.json({
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: model,
      choices: response.data.choices.map(choice => ({
        index: choice.index,
        message: {
          role: choice.message.role,
          content: choice.message.content
        },
        finish_reason: choice.finish_reason
      })),
      usage: response.data.usage
    });

  } catch (err) {
    console.error('❌ Proxy Error:', err.response?.data || err.message);
    res.status(err.response?.status || 500).json({
      error: err.response?.data || err.message
    });
  }
});

/* ==================================================
   404 Catch-All
   ================================================== */
app.all('*', (req, res) => {
  console.log(`❌ Unknown route: ${req.path}`);
  res.status(404).json({ error: `Route ${req.path} not found` });
});

app.listen(PORT, () => console.log(`🚀 NIM Proxy running on port ${PORT}`));

import express from 'express';
import crypto from 'crypto';

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration from environment variables
const COOLIFY_WEBHOOK_URL = process.env.COOLIFY_WEBHOOK_URL;
const GITHUB_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET;

if (!COOLIFY_WEBHOOK_URL) {
  console.error('ERROR: COOLIFY_WEBHOOK_URL environment variable is required');
  process.exit(1);
}

console.log(`Webhook relay starting...`);
console.log(`Will forward to: ${COOLIFY_WEBHOOK_URL}`);
console.log(`Webhook secret: ${GITHUB_WEBHOOK_SECRET ? 'configured' : 'not configured (signatures will not be verified)'}`);

// Parse JSON bodies with raw body for signature verification
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString('utf8');
  }
}));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    coolifyUrl: COOLIFY_WEBHOOK_URL,
    hasSecret: !!GITHUB_WEBHOOK_SECRET,
  });
});

// Verify GitHub webhook signature
function verifyGitHubSignature(payload, signature) {
  if (!GITHUB_WEBHOOK_SECRET) {
    console.warn('Warning: No webhook secret configured, skipping signature verification');
    return true;
  }

  if (!signature) {
    console.error('No signature provided in request');
    return false;
  }

  const hmac = crypto.createHmac('sha256', GITHUB_WEBHOOK_SECRET);
  const digest = 'sha256=' + hmac.update(payload).digest('hex');

  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
}

// GitHub webhook endpoint
app.post('/webhook/github', async (req, res) => {
  const signature = req.headers['x-hub-signature-256'];
  const event = req.headers['x-github-event'];
  const delivery = req.headers['x-github-delivery'];

  console.log(`Received GitHub webhook:`);
  console.log(`  Event: ${event}`);
  console.log(`  Delivery ID: ${delivery}`);

  // Verify signature if secret is configured
  if (GITHUB_WEBHOOK_SECRET) {
    const payload = req.rawBody || JSON.stringify(req.body);
    if (!verifyGitHubSignature(payload, signature)) {
      console.error('Signature verification failed!');
      return res.status(401).json({ error: 'Invalid signature' });
    }
    console.log('  Signature: verified ✓');
  }

  // Forward to Coolify
  try {
    console.log(`Forwarding to Coolify: ${COOLIFY_WEBHOOK_URL}`);

    // Forward all GitHub headers to Coolify
    const forwardHeaders = {};
    Object.keys(req.headers).forEach(key => {
      if (key.startsWith('x-github-') || key.startsWith('x-hub-') || key === 'user-agent') {
        forwardHeaders[key] = req.headers[key];
      }
    });
    forwardHeaders['content-type'] = 'application/json';

    const response = await fetch(COOLIFY_WEBHOOK_URL, {
      method: 'POST',
      headers: forwardHeaders,
      body: req.rawBody || JSON.stringify(req.body),
    });

    const responseText = await response.text();
    console.log(`Coolify response: ${response.status} ${response.statusText}`);
    console.log(`Coolify body: ${responseText.substring(0, 200)}`);

    if (!response.ok) {
      console.error(`Coolify error: ${responseText}`);
      return res.status(502).json({
        error: 'Coolify webhook failed',
        status: response.status,
        message: responseText.substring(0, 500),
      });
    }

    res.status(200).json({
      success: true,
      message: 'Webhook forwarded to Coolify',
      coolifyStatus: response.status,
      coolifyResponse: responseText.substring(0, 200),
    });
  } catch (error) {
    console.error('Error forwarding webhook:', error.message);
    res.status(500).json({
      error: 'Failed to forward webhook',
      message: error.message,
    });
  }
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    service: 'Coolify Webhook Relay',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      webhook: '/webhook/github',
    },
  });
});

app.listen(PORT, () => {
  console.log(`Webhook relay listening on port ${PORT}`);
});

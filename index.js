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

// Parse JSON bodies
app.use(express.json());

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
    const payload = JSON.stringify(req.body);
    if (!verifyGitHubSignature(payload, signature)) {
      console.error('Signature verification failed!');
      return res.status(401).json({ error: 'Invalid signature' });
    }
    console.log('  Signature: verified ✓');
  }

  // Forward to Coolify
  try {
    console.log(`Forwarding to Coolify: ${COOLIFY_WEBHOOK_URL}`);

    const response = await fetch(COOLIFY_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Event': event,
        'X-GitHub-Delivery': delivery,
        'X-Hub-Signature-256': signature || '',
      },
      body: JSON.stringify(req.body),
    });

    console.log(`Coolify response: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      const text = await response.text();
      console.error(`Coolify error: ${text}`);
      return res.status(502).json({
        error: 'Coolify webhook failed',
        status: response.status,
        message: text,
      });
    }

    const result = await response.text();
    console.log(`Coolify result: ${result}`);

    res.status(200).json({
      success: true,
      message: 'Webhook forwarded to Coolify',
      coolifyStatus: response.status,
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

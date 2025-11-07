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

if (!GITHUB_WEBHOOK_SECRET) {
  console.error('ERROR: GITHUB_WEBHOOK_SECRET environment variable is required');
  console.error('Webhook signature verification is mandatory for security');
  process.exit(1);
}

console.log(`Webhook relay starting...`);
console.log(`Forwarding configured: yes`);
console.log(`Webhook secret: configured`);

// Security headers middleware
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// Simple rate limiting: track IPs and request counts
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 30; // 30 requests per minute

function rateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();

  if (!rateLimitMap.has(ip)) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return next();
  }

  const limitInfo = rateLimitMap.get(ip);

  if (now > limitInfo.resetTime) {
    // Reset the counter
    rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return next();
  }

  if (limitInfo.count >= MAX_REQUESTS_PER_WINDOW) {
    console.warn(`Rate limit exceeded for IP: ${ip}`);
    return res.status(429).json({ error: 'Too many requests' });
  }

  limitInfo.count++;
  next();
}

// Clean up rate limit map periodically
setInterval(() => {
  const now = Date.now();
  for (const [ip, info] of rateLimitMap.entries()) {
    if (now > info.resetTime) {
      rateLimitMap.delete(ip);
    }
  }
}, RATE_LIMIT_WINDOW);

// Apply rate limiting to all routes
app.use(rateLimit);

// Parse JSON bodies with raw body for signature verification
// Limit payload size to 10MB to prevent abuse
app.use(express.json({
  limit: '10mb',
  verify: (req, res, buf) => {
    req.rawBody = buf.toString('utf8');
  }
}));

// Health check endpoint
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    configured: true,
  });
});

// Verify GitHub webhook signature
function verifyGitHubSignature(payload, signature) {
  if (!signature) {
    console.error('No signature provided in request');
    return false;
  }

  if (!signature.startsWith('sha256=')) {
    console.error('Invalid signature format');
    return false;
  }

  const hmac = crypto.createHmac('sha256', GITHUB_WEBHOOK_SECRET);
  const digest = 'sha256=' + hmac.update(payload).digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
  } catch (error) {
    console.error('Signature comparison failed:', error.message);
    return false;
  }
}

// GitHub webhook endpoint
app.post('/webhook/github', async (req, res) => {
  const signature = req.headers['x-hub-signature-256'];
  const event = req.headers['x-github-event'];
  const delivery = req.headers['x-github-delivery'];

  // Validate required headers
  if (!event || !delivery) {
    console.error('Missing required GitHub headers');
    return res.status(400).json({ error: 'Invalid webhook request' });
  }

  // Validate content type
  const contentType = req.headers['content-type'];
  if (!contentType || !contentType.includes('application/json')) {
    console.error('Invalid content type');
    return res.status(400).json({ error: 'Content-Type must be application/json' });
  }

  console.log(`Received GitHub webhook:`);
  console.log(`  Event: ${event}`);
  console.log(`  Delivery ID: ${delivery}`);

  // Verify signature (mandatory)
  const payload = req.rawBody || JSON.stringify(req.body);
  if (!verifyGitHubSignature(payload, signature)) {
    console.error('Signature verification failed!');
    return res.status(401).json({ error: 'Unauthorized' });
  }
  console.log('  Signature: verified ✓');

  // Forward to Coolify
  try {
    console.log(`Forwarding webhook to destination`);

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

    console.log(`Destination response: ${response.status}`);

    if (!response.ok) {
      console.error(`Destination returned error status: ${response.status}`);
      return res.status(502).json({
        error: 'Gateway error',
      });
    }

    res.status(200).json({
      success: true,
    });
  } catch (error) {
    console.error('Error forwarding webhook:', error.message);
    res.status(500).json({
      error: 'Internal server error',
    });
  }
});

// Root endpoint
app.get('/', (_req, res) => {
  res.json({
    service: 'Webhook Relay',
    version: '1.0.0',
  });
});

app.listen(PORT, () => {
  console.log(`Webhook relay listening on port ${PORT}`);
});

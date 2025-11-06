# Coolify Webhook Relay

A simple webhook relay service that receives GitHub webhooks publicly and forwards them to Coolify running on a private network.

## Architecture

```
GitHub (public)
   |
   | HTTPS webhook
   |
   v
Webhook Relay (Hetzner, public HTTPS)
   |
   | Forwards via Tailscale
   |
   v
Coolify (Pi5, private network)
```

## How It Works

1. GitHub sends webhook to relay's public HTTPS endpoint
2. Relay verifies GitHub signature (optional but recommended)
3. Relay forwards webhook to Coolify's private endpoint via Tailscale
4. Coolify triggers deployment

## Environment Variables

### Required

- `COOLIFY_WEBHOOK_URL` - Full URL to Coolify webhook endpoint
  - Example: `http://pi5.banjo-pike.ts.net:8000/api/v1/deploy?uuid=ck4ss0wkooggkckw04occg0c&force=false`

### Optional

- `GITHUB_WEBHOOK_SECRET` - GitHub webhook secret for signature verification
  - Highly recommended for security
  - Set the same value in GitHub webhook settings
- `PORT` - Port to listen on (default: 3000)

## Deployment with Coolify

1. **Create GitHub repository** with this code
2. **In Coolify UI:**
   - Add new application
   - Select your GitHub repository
   - Configure environment variables:
     - `COOLIFY_WEBHOOK_URL`: Coolify webhook URL for target application
     - `GITHUB_WEBHOOK_SECRET`: Generate random secret
   - Set domain: `webhook.koenvangilst.nl` (or subdomain of your choice)
   - Deploy

3. **In GitHub repository settings:**
   - Add webhook: `https://webhook.koenvangilst.nl/webhook/github`
   - Content type: `application/json`
   - Secret: Same as `GITHUB_WEBHOOK_SECRET`
   - Events: Just the push event

## Endpoints

- `GET /` - Service information
- `GET /health` - Health check
- `POST /webhook/github` - GitHub webhook receiver

## Security

- Verifies GitHub webhook signatures when secret is configured
- Only forwards to configured Coolify URL
- No authentication required on relay (GitHub signature is authentication)

## Development

```bash
# Install dependencies
npm install

# Set environment variables
export COOLIFY_WEBHOOK_URL="http://pi5.banjo-pike.ts.net:8000/api/v1/deploy?uuid=xxx"
export GITHUB_WEBHOOK_SECRET="your-secret-here"

# Run
npm start
```

## License

MIT

# Lovable OSS

An open-source AI-powered web app builder. Describe your app and get a fully functional React application generated in seconds.

## Links

- [GitHub Repository](https://github.com/diggerhq/osslovable)
- [OpenComputer](https://opencomputer.dev)
- [Live Demo](https://openlovable.cc)

## Tech Stack

- **Frontend:** React, TypeScript, Vite, Tailwind CSS, CodeMirror
- **Backend:** Node.js, Express, TypeScript
- **AI:** Anthropic Claude SDK
- **Sandbox:** OpenComputer SDK

## Getting Started

```bash
# Install dependencies
npm run install:all

# Create .env with your API keys
cp .env.example .env

# Start development server
npm run dev
```

### Environment Variables

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API key for Claude |
| `OPENCOMPUTER_API_KEY` | OpenComputer API key for sandboxes |
| `DEPLOY_DOMAIN` | Custom domain for deploy URLs (defaults to `openlovable.cc`) |

## Deployment

The app is deployed on [Fly.io](https://fly.io) and available at [openlovable.cc](https://openlovable.cc).

```bash
flyctl deploy --app openlovable
```

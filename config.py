import os

# Server ports
DASHBOARD_PORT = 5001
AGENT_API_PORT = 5002

# Database
DB_PATH = os.path.join(os.path.dirname(__file__), "vault.db")

# Token / request lifetimes (seconds)
TOKEN_TTL_SECONDS = 900   # 15 min — never renewable, always re-request
REQUEST_TTL_SECONDS = 60  # pending request expires after 60s

# Ed25519 identity key file (never commit this)
TOKEN_KEY_FILE = os.path.join(os.path.dirname(__file__), ".gr_identity.key")

# OAuth redirect base (fill in real values before running OAuth flow)
OAUTH_REDIRECT_URI = "http://localhost:5001/auth/callback"

# OAuth service configs — populate client_id/secret from your app registrations
OAUTH_SERVICES = {
    "google": {
        "client_id": "PLACEHOLDER_GOOGLE_CLIENT_ID",         # MOCK
        "client_secret": "PLACEHOLDER_GOOGLE_CLIENT_SECRET", # MOCK
        "scope": "openid email https://www.googleapis.com/auth/gmail.readonly",
    },
    "github": {
        "client_id": "PLACEHOLDER_GITHUB_CLIENT_ID",         # MOCK
        "client_secret": "PLACEHOLDER_GITHUB_CLIENT_SECRET", # MOCK
        "scope": "repo read:user",
    },
}

# Headless-login site adapters (stub — populated in Phase 13)
SITE_ADAPTERS: dict = {}

# Build-completion ping key (Claude Code only — not a product feature)
BARK_KEY = os.environ.get("BARK_KEY", "")

declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    OPENAI_API_KEY?: string;
    OPENAI_MODEL?: string;
    ANTHROPIC_API_KEY?: string;
    ANTHROPIC_MODEL?: string;
    GEMINI_API_KEY?: string;
    GEMINI_MODEL?: string;
    META_API_KEY?: string;
    META_API_BASE_URL?: string;
    META_MODEL?: string;
    COUNCIL_PROVIDER_TIMEOUT_MS?: string;
  }
}

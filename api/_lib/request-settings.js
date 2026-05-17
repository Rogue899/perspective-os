const HEADER_MAP = {
  geminiKey: 'x-pos-gemini-key',
  groqKey: 'x-pos-groq-key',
  marketstackKey: 'x-pos-marketstack-key',
  newsdataKey: 'x-pos-newsdata-key',
  acledEmail: 'x-pos-acled-email',
  acledPassword: 'x-pos-acled-password',
  upstashUrl: 'x-pos-upstash-url',
  upstashToken: 'x-pos-upstash-token',
};

export const SETTINGS_ACCESS_CONTROL_HEADERS = [
  'Content-Type',
  ...Object.values(HEADER_MAP),
].join(', ');

function readHeader(req, name) {
  return req?.headers?.get?.(name) ?? '';
}

export function getRequestIntegrationSettings(req) {
  return {
    geminiKey: readHeader(req, HEADER_MAP.geminiKey) || process.env.GEMINI_API_KEY || '',
    groqKey: readHeader(req, HEADER_MAP.groqKey) || process.env.GROQ_API_KEY || '',
    marketstackKey: readHeader(req, HEADER_MAP.marketstackKey) || process.env.MARKETSTACK_API_KEY || '',
    newsdataKey: readHeader(req, HEADER_MAP.newsdataKey) || process.env.NEWSDATA_API_KEY || '',
    acledEmail: readHeader(req, HEADER_MAP.acledEmail) || process.env.ACLED_EMAIL || '',
    acledPassword: readHeader(req, HEADER_MAP.acledPassword) || process.env.ACLED_PASSWORD || '',
    upstashUrl: readHeader(req, HEADER_MAP.upstashUrl) || process.env.UPSTASH_REDIS_REST_URL || '',
    upstashToken: readHeader(req, HEADER_MAP.upstashToken) || process.env.UPSTASH_REDIS_REST_TOKEN || '',
  };
}
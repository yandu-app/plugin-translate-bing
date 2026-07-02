import type { Plugin, TranslationAdapter } from '@yandu/types';

const TIMEOUT_MS = 15_000;
const BING_TRANSLATOR_URL = 'https://cn.bing.com/translator';

interface BingToken { ig: string; iid: string; key: string; token: string; }

let cachedToken: BingToken | null = null;
let tokenExpiresAt = 0;

async function fetchToken(): Promise<BingToken> {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;

  const res = await fetch(BING_TRANSLATOR_URL, {
    headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const html = await res.text();

  const igMatch = html.match(/IG:"([^"]+)"/);
  const iidMatch = html.match(/data-iid="([^"]+)"/);
  const abuseMatch = html.match(/params_AbusePreventionHelper\s*=\s*\[(\d+),"([^"]+)",(\d+)\]/);

  if (!igMatch) throw new Error('Failed to extract Bing IG token');
  if (!abuseMatch) throw new Error('Failed to extract Bing abuse prevention token');

  cachedToken = {
    ig: igMatch[1],
    iid: iidMatch?.[1] ?? 'translator.5023',
    key: abuseMatch[1],
    token: abuseMatch[2],
  };
  tokenExpiresAt = Date.now() + 50 * 60 * 1000;

  return cachedToken;
}

class BingTranslateAdapter implements TranslationAdapter {
  id = 'bing';
  name = 'Bing Translator';
  supportsStreaming = false;
  maxTextLength = 5000;

  async translate(
    text: string,
    targetLanguage: string,
    _options?: { baseUrl?: string }
  ): Promise<string> {
    if (!text.trim()) return text;

    const lang = targetLanguage === 'zh-CN' || targetLanguage === 'zh-Hans'
      ? 'zh-Hans'
      : targetLanguage === 'zh-TW' || targetLanguage === 'zh-Hant'
        ? 'zh-Hant'
        : targetLanguage;

    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await fetchToken();
      const url = `https://cn.bing.com/ttranslatev3?isVertical=1&IG=${token.ig}&IID=${token.iid}`;

      const params = new URLSearchParams();
      params.set('fromLang', 'auto-detect');
      params.set('to', lang);
      params.set('text', text);
      params.set('key', token.key);
      params.set('token', token.token);

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        body: params.toString(),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (!res.ok) throw new Error(`Bing translate failed: ${res.status}`);

      const data = await res.json() as Array<{
        translations?: Array<{ text: string }>;
        statusCode?: number;
      }>;

      const translated = data[0]?.translations?.[0]?.text;
      if (translated) return translated;

      cachedToken = null;
      tokenExpiresAt = 0;
    }

    throw new Error('Bing translate returned empty result after retry');
  }
}

export default {
  name: '@yandu/plugin-translate-bing',
  version: '1.0.0',
  register(system) {
    const adapter = new BingTranslateAdapter();
    system.capabilities.register(
      { type: 'translation', id: adapter.id, name: adapter.name },
      adapter
    );
  },
} satisfies Plugin;

// AI provider router for MyStage Pulse (main process only).
//
// Primary: Groq. Fallback: OpenAI. Both expose OpenAI-compatible chat
// completions, called with plain fetch (as MyZenn's relay server calls Groq).
// A provider is used only when its key is present in .env. Within a provider,
// retired or unknown models fall through to the next model in its list.
// Outages, rate limits and auth errors fall through to the next provider.
//
// Only text crosses this boundary: the scenario prompt, the typed conversation
// and a one-word body state. Never video, images or raw readings.
'use strict';

const MODEL_GONE = /model_not_found|decommissioned|does not exist|not found|not supported|unsupported/i;

/** OpenAI reasoning models reject custom temperature and spend tokens thinking. */
const isOpenAiReasoning = (model) => /^(gpt-5|o\d)/.test(model);

const PROVIDERS = {
  groq: {
    url: 'https://api.groq.com/openai/v1/chat/completions',
    keyVar: 'GROQ_API_KEY',
    modelVar: 'GROQ_MODEL',
    models: ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b', 'llama-3.1-8b-instant'],
    params(model, maxTokens) {
      if (model.startsWith('openai/gpt-oss')) {
        return { max_tokens: maxTokens + 600, reasoning_effort: 'low', temperature: 0.85 };
      }
      return { max_tokens: maxTokens, temperature: 0.85 };
    },
  },
  openai: {
    url: 'https://api.openai.com/v1/chat/completions',
    keyVar: 'OPENAI_API_KEY',
    modelVar: 'OPENAI_MODEL',
    models: ['gpt-4.1-mini', 'gpt-5-mini', 'gpt-4o-mini'],
    params(model, maxTokens) {
      if (isOpenAiReasoning(model)) return { max_completion_tokens: maxTokens + 800, reasoning_effort: 'low' };
      return { max_completion_tokens: maxTokens, temperature: 0.85 };
    },
  },
};

/** Order in which providers are tried. */
const PROVIDER_ORDER = ['groq', 'openai'];

const unique = (list) => [...new Set(list.filter(Boolean))];

/**
 * @param {{
 *   env: Record<string, string | undefined>,
 *   fetchImpl?: typeof fetch,
 *   timeoutMs?: number,
 *   log?: (msg: string) => void,
 * }} options
 */
function createLlm({ env, fetchImpl = globalThis.fetch, timeoutMs = 20_000, log = (m) => console.warn(m) }) {
  /** @type {('groq' | 'openai')[]} */
  const providers = PROVIDER_ORDER.filter((p) => Boolean(env[PROVIDERS[p].keyVar]));

  async function callProvider(provider, { system, turns, maxTokens }) {
    const cfg = PROVIDERS[provider];
    let lastError;
    for (const model of unique([env[cfg.modelVar], ...cfg.models])) {
      const body = {
        model,
        messages: [{ role: 'system', content: system }, ...turns.map((t) => ({ role: t.role, content: t.text }))],
        ...cfg.params(model, maxTokens),
      };

      let res;
      try {
        res = await fetchImpl(cfg.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env[cfg.keyVar]}` },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        // Network failure or timeout: another model on the same provider will not help.
        throw new Error(`request failed (${err && err.message})`);
      }

      if (res.ok) {
        const data = await res.json();
        const text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
        if (text && text.trim()) return { text: text.trim(), model };
        lastError = new Error(`${model} returned an empty reply`);
        continue;
      }

      const detail = (await res.text()).slice(0, 300);
      lastError = new Error(`HTTP ${res.status} from ${model}: ${detail}`);
      if (res.status === 404 || MODEL_GONE.test(detail)) continue;
      throw lastError; // 401 / 429 / 5xx: let the fallback provider answer
    }
    throw lastError;
  }

  /**
   * @param {{ system: string, turns: { role: 'user' | 'assistant', text: string }[], maxTokens?: number }} request
   * @returns {Promise<{ text: string, provider: 'groq' | 'openai', model: string, fellBack: boolean }>}
   */
  async function generate({ system, turns, maxTokens = 220 }) {
    if (providers.length === 0) {
      throw new Error('No AI key configured. Add GROQ_API_KEY (and optionally OPENAI_API_KEY as a fallback) to .env.');
    }
    const failures = [];
    for (const provider of providers) {
      try {
        const out = await callProvider(provider, { system, turns, maxTokens });
        return { text: out.text, provider, model: out.model, fellBack: failures.length > 0 };
      } catch (err) {
        const message = `${provider}: ${err && err.message}`;
        failures.push(message);
        log(`[ai] ${message}`);
      }
    }
    throw new Error(`No AI provider could answer. ${failures.join(' | ')}`);
  }

  return { providers, generate };
}

module.exports = { createLlm, PROVIDERS, PROVIDER_ORDER };

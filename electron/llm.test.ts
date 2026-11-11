import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createLlm, PROVIDERS } = require('./llm.cjs');

const GROQ_URL = PROVIDERS.groq.url;
const OPENAI_URL = PROVIDERS.openai.url;
const request = { system: 'You are a tough interviewer.', turns: [{ role: 'user' as const, text: 'Hi, thanks for meeting me.' }] };

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

const reply = (text: string) => jsonResponse(200, { choices: [{ message: { content: text } }] });

type Init = { headers: Record<string, string>; body: string };

/** Fake fetch that answers per provider URL. */
function routedFetch(routes: Record<string, (init: Init) => unknown>) {
  return vi.fn(async (url: string, init: Init) => {
    const handler = routes[url];
    if (!handler) throw new Error(`unexpected URL ${url}`);
    return handler(init);
  });
}

const both = { GROQ_API_KEY: 'groq-key', OPENAI_API_KEY: 'openai-key' };
const quiet = () => {};

describe('provider order: Groq primary, OpenAI fallback', () => {
  it('lists providers in fallback order based on which keys exist', () => {
    expect(createLlm({ env: both, fetchImpl: vi.fn(), log: quiet }).providers).toEqual(['groq', 'openai']);
    expect(createLlm({ env: { OPENAI_API_KEY: 'k' }, fetchImpl: vi.fn(), log: quiet }).providers).toEqual(['openai']);
    expect(createLlm({ env: {}, fetchImpl: vi.fn(), log: quiet }).providers).toEqual([]);
  });

  it('uses Groq when it answers, and never calls OpenAI', async () => {
    const fetchImpl = routedFetch({ [GROQ_URL]: () => reply('Tell me about yourself.'), [OPENAI_URL]: () => reply('should not be used') });
    const out = await createLlm({ env: both, fetchImpl, log: quiet }).generate(request);
    expect(out).toMatchObject({ text: 'Tell me about yourself.', provider: 'groq', model: PROVIDERS.groq.models[0], fellBack: false });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('sends the system prompt and turns in chat format with the bearer key', async () => {
    const fetchImpl = routedFetch({ [GROQ_URL]: () => reply('ok') });
    await createLlm({ env: both, fetchImpl, log: quiet }).generate(request);
    const init = fetchImpl.mock.calls[0][1];
    expect(init.headers.Authorization).toBe('Bearer groq-key');
    const body = JSON.parse(init.body);
    expect(body.messages[0]).toEqual({ role: 'system', content: request.system });
    expect(body.messages[1]).toEqual({ role: 'user', content: request.turns[0].text });
  });

  it.each([
    ['rate-limited', () => jsonResponse(429, 'rate limit exceeded')],
    ['down', () => jsonResponse(503, 'service unavailable')],
    ['rejecting the key', () => jsonResponse(401, 'invalid api key')],
    ['unreachable', () => {
      throw new Error('ECONNRESET');
    }],
  ])('falls back to OpenAI when Groq is %s', async (_label, groqFails) => {
    const fetchImpl = routedFetch({ [GROQ_URL]: groqFails, [OPENAI_URL]: () => reply('OpenAI here.') });
    const out = await createLlm({ env: both, fetchImpl, log: quiet }).generate(request);
    expect(out).toMatchObject({ text: 'OpenAI here.', provider: 'openai', fellBack: true });
    const openAiInit = fetchImpl.mock.calls.find(([url]) => url === OPENAI_URL)![1];
    expect(openAiInit.headers.Authorization).toBe('Bearer openai-key');
  });

  it('reports both failures when Groq and OpenAI both fail', async () => {
    const fetchImpl = routedFetch({ [GROQ_URL]: () => jsonResponse(401, 'invalid api key'), [OPENAI_URL]: () => jsonResponse(429, 'quota exceeded') });
    await expect(createLlm({ env: both, fetchImpl, log: quiet }).generate(request)).rejects.toThrow(/groq: HTTP 401.*openai: HTTP 429/);
  });

  it('explains how to fix a missing key', async () => {
    await expect(createLlm({ env: {}, fetchImpl: vi.fn(), log: quiet }).generate(request)).rejects.toThrow(/GROQ_API_KEY/);
  });
});

describe('models', () => {
  it('tries the next Groq model when one has been retired', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(400, { error: { code: 'model_decommissioned', message: 'The model has been decommissioned' } }))
      .mockResolvedValueOnce(reply('Second model answered.'));
    const out = await createLlm({ env: { GROQ_API_KEY: 'g' }, fetchImpl, log: quiet }).generate(request);
    expect(out).toMatchObject({ provider: 'groq', model: PROVIDERS.groq.models[1] });
  });

  it('honours GROQ_MODEL and OPENAI_MODEL overrides first', async () => {
    const fetchImpl = routedFetch({ [GROQ_URL]: () => jsonResponse(500, 'boom'), [OPENAI_URL]: () => reply('ok') });
    await createLlm({ env: { ...both, GROQ_MODEL: 'my-groq', OPENAI_MODEL: 'my-openai' }, fetchImpl, log: quiet }).generate(request);
    const models = fetchImpl.mock.calls.map(([, init]) => JSON.parse(init.body).model);
    expect(models).toEqual(['my-groq', 'my-openai']);
  });

  it('uses max_completion_tokens and temperature for standard OpenAI models', async () => {
    const fetchImpl = routedFetch({ [OPENAI_URL]: () => reply('ok') });
    await createLlm({ env: { OPENAI_API_KEY: 'k', OPENAI_MODEL: 'gpt-4.1-mini' }, fetchImpl, log: quiet }).generate({ ...request, maxTokens: 200 });
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body).toMatchObject({ max_completion_tokens: 200, temperature: 0.85 });
    expect(body.max_tokens).toBeUndefined();
  });

  it('omits temperature and adds reasoning effort for OpenAI reasoning models', async () => {
    const fetchImpl = routedFetch({ [OPENAI_URL]: () => reply('ok') });
    await createLlm({ env: { OPENAI_API_KEY: 'k', OPENAI_MODEL: 'gpt-5-mini' }, fetchImpl, log: quiet }).generate(request);
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.temperature).toBeUndefined();
    expect(body.reasoning_effort).toBe('low');
    expect(body.max_completion_tokens).toBeGreaterThan(220);
  });
});

// Shared wording for the optional AI partner, so every screen discloses the
// same route: Groq first, OpenAI only as a fallback.

export type AiProvider = 'groq' | 'openai';

export const PROVIDER_NAME: Record<AiProvider, string> = {
  groq: 'Groq',
  openai: 'OpenAI',
};

/** e.g. "Groq, with OpenAI as a fallback" */
export function aiRoute(providers: AiProvider[] | undefined): string {
  if (!providers || providers.length === 0) return 'no AI service';
  const [primary, ...rest] = providers;
  if (rest.length === 0) return PROVIDER_NAME[primary];
  return `${PROVIDER_NAME[primary]}, with ${rest.map((p) => PROVIDER_NAME[p]).join(' and ')} as a fallback`;
}

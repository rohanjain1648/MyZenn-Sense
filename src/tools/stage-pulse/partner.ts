import type { StageTurn } from '@/env';
import type { AiProvider } from '@/lib/ai';
import type { DifficultyLevel, StageScenario } from '@/myzenn/stageScenarios';

// Built-in scripted partner: works fully offline, so MyStage Pulse never needs
// an AI service. The optional AI partner (Groq first, OpenAI fallback) is used
// only when the user turns it on in Privacy & settings and has added a key.
const SCRIPTED: Record<string, string[]> = {
  'job-interview': [
    'Okay. Can you give me a specific example of a challenge you handled at work?',
    'What would your last manager say is your biggest weakness?',
    'Why are you looking to leave your current role?',
    'Where do you see yourself in three years?',
    'If you got this job, what would you change in your first month?',
    'Last one: do you have any questions for me?',
  ],
  'difficult-conversation': [
    "I don't really understand why this is coming up now.",
    'It feels like you are blaming me for all of it.',
    "Okay... so what do you actually want me to do differently?",
    "I didn't realise it affected you that much.",
    'Can you tell me what it was like for you?',
    "Alright. I'm listening.",
  ],
  'public-speaking': [
    'Interesting. Can you expand on that last point?',
    'How do you know that is true? What is your evidence?',
    'Someone at the back says they did not quite follow. Could you put it more simply?',
    'What is the one thing you want us to remember?',
    'How would this work in practice?',
    'Thank you. Any final words for the audience?',
  ],
  'meeting-new-people': [
    'So how do you know the host?',
    'Oh nice. And what do you do when you are not working?',
    "Ha, I've never tried that. What got you into it?",
    'Have you been to one of these events before?',
    'Sorry, I missed your name in all the noise. What was it again?',
    'It was really nice talking with you.',
  ],
  'asking-for-raise': [
    'Okay. What makes you feel now is the right time?',
    'Budgets are tight this year. What makes your case different?',
    'What number did you have in mind?',
    'Some of that was part of your job description already, though.',
    "If I can't do the full amount, what would work for you?",
    "Let me take this to leadership. I'll get back to you.",
  ],
  'confronting-conflict': [
    "Wait, what are you talking about? I didn't mean anything by it.",
    "Honestly, I think you're overreacting a bit.",
    'Everyone else thought it was fine.',
    'So what do you want me to say?',
    "Okay. I didn't see it that way, but I hear you.",
    "Fine. I'll be more careful.",
  ],
  'first-date': [
    'So, what do you like to do on weekends?',
    'Ha, really? Tell me more about that.',
    'What is something people usually get wrong about you?',
    "I'm kind of a homebody, honestly. Is that weird?",
    'What made you swipe right, if you do not mind me asking?',
    'This has been nice. I have to head off soon, though.',
  ],
};

const FALLBACK = ['Go on.', 'And why is that?', 'Hmm. Say more.', 'Okay.', 'What do you mean exactly?', 'I see.'];

export const QUICK_REPLIES = [
  'Can I take a moment to think about that?',
  'Let me explain what I mean.',
  'I hear you. Here is how I see it.',
];

export const MAX_PARTNER_TURNS = 6;

export async function partnerReply(opts: {
  scenario: StageScenario;
  difficulty: DifficultyLevel;
  turns: StageTurn[];
  bodyState: 'settled' | 'tense';
  useAi: boolean;
}): Promise<{ text: string; ai: boolean; provider?: AiProvider; fellBack?: boolean; aiFailed?: boolean }> {
  const partnerTurns = opts.turns.filter((t) => t.role === 'partner').length;
  if (opts.useAi && window.myzennSense) {
    try {
      const reply = await window.myzennSense.stageReply({
        system: opts.difficulty.systemPrompt,
        turns: opts.turns,
        bodyState: opts.bodyState,
      });
      return { text: reply.text, ai: true, provider: reply.provider, fellBack: reply.fellBack };
    } catch (err) {
      console.warn('[stage] AI partner unavailable, using scripted partner', err);
      return { text: scripted(opts.scenario.id, partnerTurns, opts.bodyState, opts.difficulty), ai: false, aiFailed: true };
    }
  }
  await new Promise((r) => setTimeout(r, 900 + Math.random() * 900));
  return { text: scripted(opts.scenario.id, partnerTurns, opts.bodyState, opts.difficulty), ai: false };
}

function scripted(scenarioId: string, partnerTurns: number, bodyState: 'settled' | 'tense', difficulty: DifficultyLevel) {
  const lines = SCRIPTED[scenarioId] ?? FALLBACK;
  const line = lines[Math.max(0, partnerTurns - 1) % lines.length];
  if (bodyState === 'tense' && difficulty.id === 'easy') return `Take your time. ${line}`;
  return line;
}

export function scriptedDebrief(stats: { pauses: number; averageRecoverySec: number | null; turns: number }): string[] {
  const tips: string[] = [];
  if (stats.pauses === 0) {
    tips.push('Your body stayed close to your resting rhythm the whole way. Try a harder partner next time.');
  } else {
    tips.push(
      `Your partner paused ${stats.pauses} time${stats.pauses === 1 ? '' : 's'} so you could breathe. Noticing the rise is the skill, and you practised it.`,
    );
  }
  if (stats.averageRecoverySec !== null) {
    tips.push(
      stats.averageRecoverySec < 30
        ? `You came back down in about ${Math.round(stats.averageRecoverySec)} seconds on average. Three slow breaths work for you.`
        : `Settling took about ${Math.round(stats.averageRecoverySec)} seconds. Try a longer out-breath (count of six) next time.`,
    );
  }
  tips.push(
    stats.turns < 3
      ? 'Short rehearsals are fine. Next time, try staying in it for a few more replies.'
      : 'Before the real conversation, take three slow breaths first. Your body has now rehearsed that pause.',
  );
  return tips;
}

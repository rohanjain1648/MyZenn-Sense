// Spoken breathing cues for MyBreath Live.
//
// Uses the operating system's own text-to-speech through the Web Speech API,
// limited to voices that run on this computer (localService), so the cue words
// never go to an online voice service. If there is no local voice, a soft tone
// marks each breath instead: rising for the in-breath, falling for the out-breath.

export type Cue = 'in' | 'out' | 'settle';

const WORDS: Record<Cue, string> = {
  in: 'Breathe in',
  out: 'Breathe out',
  settle: 'Breathe naturally. Listening to your rhythm first.',
};

/** Pick an offline voice: the user's own language variant first, then any English one. */
export function pickVoice(voices: readonly SpeechSynthesisVoice[], lang: string): SpeechSynthesisVoice | null {
  const local = voices.filter((v) => v.localService);
  const wanted = (lang || 'en-US').toLowerCase();
  const sameVariant = local.filter((v) => v.lang.toLowerCase().replace('_', '-') === wanted);
  const english = local.filter((v) => v.lang.toLowerCase().startsWith('en'));
  const pool = wanted.startsWith('en') && sameVariant.length ? sameVariant : english;
  return pool.find((v) => v.default) ?? pool[0] ?? null;
}

function synth(): SpeechSynthesis | null {
  return typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
}

// undefined = not looked up yet (voices load asynchronously in Chromium).
let voice: SpeechSynthesisVoice | null | undefined;
let listening = false;

function currentVoice(): SpeechSynthesisVoice | null {
  const s = synth();
  if (!s) return null;
  if (!listening) {
    listening = true;
    s.addEventListener?.('voiceschanged', () => {
      voice = undefined;
    });
  }
  if (voice === undefined) {
    const list = s.getVoices();
    // An empty list usually means "not loaded yet": look again next cue.
    if (!list.length) return null;
    voice = pickVoice(list, navigator.language);
  }
  return voice;
}

let audio: AudioContext | null = null;

function tone(rising: boolean) {
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') void audio.resume();
    const now = audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    const low = 330;
    const high = 392;
    osc.type = 'sine';
    osc.frequency.setValueAtTime(rising ? low : high, now);
    osc.frequency.linearRampToValueAtTime(rising ? high : low, now + 0.6);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
    osc.connect(gain).connect(audio.destination);
    osc.start(now);
    osc.stop(now + 0.95);
  } catch {
    /* no audio output available */
  }
}

/** Say a cue now, cutting off any earlier cue so the voice never lags the circle. */
export function speakCue(cue: Cue) {
  const s = synth();
  const v = currentVoice();
  if (!s || !v) {
    if (cue !== 'settle') tone(cue === 'in');
    return;
  }
  s.cancel();
  if (s.paused) s.resume();
  const u = new SpeechSynthesisUtterance(WORDS[cue]);
  u.voice = v;
  u.lang = v.lang;
  u.rate = 0.9;
  u.pitch = 1;
  u.volume = 1;
  s.speak(u);
}

export function stopVoice() {
  synth()?.cancel();
}

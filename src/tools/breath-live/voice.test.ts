import { describe, expect, it } from 'vitest';
import { pickVoice } from './voice';

const v = (name: string, lang: string, localService: boolean, isDefault = false) =>
  ({ name, lang, localService, default: isDefault, voiceURI: name }) as SpeechSynthesisVoice;

describe('pickVoice', () => {
  it('never picks an online voice', () => {
    expect(pickVoice([v('Cloud Natural', 'en-US', false)], 'en-US')).toBeNull();
  });

  it('prefers the user language variant among local voices', () => {
    const voices = [v('David', 'en-US', true, true), v('Heera', 'en-IN', true), v('Online', 'en-IN', false)];
    expect(pickVoice(voices, 'en-IN')?.name).toBe('Heera');
  });

  it('falls back to the default local English voice', () => {
    const voices = [v('Hazel', 'en-GB', true), v('Zira', 'en-US', true, true), v('Hemant', 'hi-IN', true)];
    expect(pickVoice(voices, 'hi-IN')?.name).toBe('Zira');
  });

  it('returns null when no local English voice exists', () => {
    expect(pickVoice([v('Hemant', 'hi-IN', true)], 'en-US')).toBeNull();
  });
});

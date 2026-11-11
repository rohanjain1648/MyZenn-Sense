import type { Guidance, GuidanceSeverity } from './types';

// SmartSpectra ValidationCode values (stable across SDK versions, see
// @smartspectra/node-sdk ValidationCode). Mapped to calm, actionable
// sentences so the user always knows what to change, instead of seeing codes.
export const ValidationCodes = {
  ok: 0,
  noFace: 1,
  multipleFaces: 2,
  faceNotCentered: 3,
  faceSizeOutOfRange: 4,
  tooDark: 5,
  tooBright: 6,
  chestNotVisible: 7,
  cameraTuning: 10,
  frameRateTooLow: 11,
  excessiveMotion: 12,
  faceTooClose: 13,
  faceTooFar: 14,
  faceTooHigh: 15,
  faceTooLow: 16,
  faceNotForward: 17,
} as const;

const MESSAGES: Record<number, [string, GuidanceSeverity]> = {
  [ValidationCodes.ok]: ['Signal looks good. Just be here.', 'ok'],
  [ValidationCodes.noFace]: ['Bring your face into the frame.', 'fix'],
  [ValidationCodes.multipleFaces]: ['Only one face at a time, please. Others can step out of view.', 'fix'],
  [ValidationCodes.faceNotCentered]: ['Center your face in the frame.', 'fix'],
  [ValidationCodes.faceSizeOutOfRange]: ['Adjust your distance from the camera.', 'fix'],
  [ValidationCodes.tooDark]: ['A little dark. Face a window or a soft lamp.', 'fix'],
  [ValidationCodes.tooBright]: ['Too bright or backlit. Avoid a light behind you.', 'fix'],
  [ValidationCodes.chestNotVisible]: ['Tilt the screen so your shoulders and chest are visible.', 'fix'],
  [ValidationCodes.cameraTuning]: ['Tuning the camera to your light...', 'tuning'],
  [ValidationCodes.frameRateTooLow]: ['The camera is struggling. Close other camera apps or add light.', 'fix'],
  [ValidationCodes.excessiveMotion]: ['Settle in and hold still. Keep the laptop steady.', 'fix'],
  [ValidationCodes.faceTooClose]: ['Lean back a little.', 'fix'],
  [ValidationCodes.faceTooFar]: ['Come a little closer to the camera.', 'fix'],
  [ValidationCodes.faceTooHigh]: ["You're near the top of the frame. Tilt the screen back a little.", 'fix'],
  [ValidationCodes.faceTooLow]: ["You're near the bottom of the frame. Tilt the screen forward a little.", 'fix'],
  [ValidationCodes.faceNotForward]: ['Face the screen directly.', 'fix'],
};

export function guidanceFor(code: number, hint?: string): Guidance {
  const entry = MESSAGES[code];
  if (entry) return { code, message: entry[0], severity: entry[1] };
  return { code, message: hint || 'Adjusting...', severity: 'tuning' };
}

/** SDK warm-up windows: readings are not trustworthy before these elapse. */
export const WARMUP_MS = {
  pulse: 12_000,
  breathing: 30_000,
  hrv: 60_000,
} as const;

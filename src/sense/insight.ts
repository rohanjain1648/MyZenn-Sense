// Presage LLM Insights helpers.
//
// The Node SDK delivers each insight as a serialized `presage.smartspectra.Insight`
// protobuf but does not ship a decoder. The message is tiny, so we decode
// it by hand (schema from Presage's Data Types reference):
//
//   message Insight {
//     int32 request_id = 1;
//     string processed_at = 2;
//     oneof result { string analysis = 3; string error = 4; }
//     InsightType type = 5;
//   }

export interface Insight {
  requestId: number;
  processedAt: string;
  analysis: string | null;
  error: string | null;
  type: number;
}

const utf8Decoder = new TextDecoder();
const utf8Encoder = new TextEncoder();

function readVarint(buf: Uint8Array, pos: number): [number, number] {
  let result = 0;
  let shift = 0;
  let byte: number;
  do {
    if (pos >= buf.length) throw new Error('Truncated varint');
    byte = buf[pos++];
    if (shift < 28) result |= (byte & 0x7f) << shift;
    else result += (byte & 0x7f) * 2 ** shift;
    shift += 7;
  } while (byte & 0x80);
  return [result, pos];
}

export function decodeInsight(buf: Uint8Array): Insight {
  const out: Insight = { requestId: 0, processedAt: '', analysis: null, error: null, type: 0 };
  let pos = 0;
  while (pos < buf.length) {
    let tag: number;
    [tag, pos] = readVarint(buf, pos);
    const field = tag >>> 3;
    const wire = tag & 7;
    if (wire === 0) {
      let value: number;
      [value, pos] = readVarint(buf, pos);
      if (field === 1) out.requestId = value | 0;
      else if (field === 5) out.type = value;
    } else if (wire === 2) {
      let length: number;
      [length, pos] = readVarint(buf, pos);
      if (pos + length > buf.length) throw new Error('Truncated field');
      const text = utf8Decoder.decode(buf.subarray(pos, pos + length));
      pos += length;
      if (field === 2) out.processedAt = text;
      else if (field === 3) out.analysis = text;
      else if (field === 4) out.error = text;
    } else if (wire === 1) {
      pos += 8;
    } else if (wire === 5) {
      pos += 4;
    } else {
      throw new Error(`Unsupported wire type ${wire}`);
    }
  }
  return out;
}

function writeVarint(bytes: number[], value: number) {
  let v = value >>> 0;
  while (v > 0x7f) {
    bytes.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  bytes.push(v);
}

/** Encoder for tests and for practice mode's simulated insights. */
export function encodeInsight(insight: Partial<Insight>): Uint8Array {
  const bytes: number[] = [];
  const str = (field: number, value: string | null | undefined) => {
    if (value === null || value === undefined) return;
    const data = utf8Encoder.encode(value);
    writeVarint(bytes, (field << 3) | 2);
    writeVarint(bytes, data.length);
    bytes.push(...data);
  };
  if (insight.requestId) {
    writeVarint(bytes, (1 << 3) | 0);
    writeVarint(bytes, insight.requestId);
  }
  str(2, insight.processedAt);
  str(3, insight.analysis);
  str(4, insight.error);
  if (insight.type) {
    writeVarint(bytes, (5 << 3) | 0);
    writeVarint(bytes, insight.type);
  }
  return new Uint8Array(bytes);
}

/**
 * Prompt for the end-of-session reflection. Follows Presage's prompt guidance:
 * ask only about the measured pulse, HRV and breathing rate, add our own
 * session context, and never ask for medical judgement. Stays far below the
 * 2048-byte prompt limit.
 */
export function reflectionPrompt(ctx: { minutes: number; breathingBefore: number; breathingAfter: number | null }): string {
  const pace =
    ctx.breathingAfter !== null
      ? `easing from about ${ctx.breathingBefore.toFixed(0)} to ${ctx.breathingAfter.toFixed(0)} breaths per minute`
      : `starting at about ${ctx.breathingBefore.toFixed(0)} breaths per minute`;
  // No numbers in the reply: the app already shows the measured values, and a
  // quoted figure from the model's buffer could contradict them on screen.
  return (
    `I just finished a ${Math.max(1, Math.round(ctx.minutes))}-minute guided slow-breathing exercise in a wellness app, ${pace}. ` +
    'In two or three warm, encouraging sentences, reflect on how my pulse, heart-rate variability and breathing rate look ' +
    'during this calm practice. Describe changes in words and do not quote any numbers. ' +
    'Keep it to general wellness: no medical advice, no diagnosis, and no mention of health conditions.'
  );
}

// Words that would turn a wellness reflection into a medical statement. The
// challenge rules forbid diagnosis or treatment claims, so any reflection that
// contains them is not shown at all.
const MEDICAL_TERMS =
  /\b(diagnos\w*|disease\w*|disorder\w*|doctor\w*|physician\w*|medicat\w*|prescri\w*|treat(?:ment|ing|ed)?|therap\w*|clinic\w*|arrhythmi\w*|tachycardi\w*|bradycardi\w*|hypertensi\w*|hypotensi\w*|blood pressure|cardiac|heart condition\w*|symptom\w*|emergenc\w*|abnormal\w*|condition\w*)\b/i;

// Model-added disclaimers like "This is not medical advice." are dropped;
// the app shows its own wellness disclaimer instead.
const DISCLAIMER = /\b(not (?:a substitute for |intended as )?(?:professional )?medical advice|not medical advice|consult (?:a|your) (?:doctor|healthcare|physician)\w*)\b/i;

/**
 * Returns the reflection text that is safe to show in a wellness app, or null
 * when it strays into medical territory and must not be shown.
 */
export function wellnessOnly(text: string | null | undefined): string | null {
  if (!text) return null;
  const sentences = text
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?])\s+/)
    .filter((s) => s && !DISCLAIMER.test(s));
  const kept = sentences.join(' ').trim();
  if (!kept || MEDICAL_TERMS.test(kept)) return null;
  return kept;
}

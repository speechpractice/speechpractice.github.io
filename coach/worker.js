// Speak & Move: optional AI encouragement (Cloudflare Workers AI, free tier).
// The app sends only {lang, kind, level}. No free text from users ever reaches the model,
// so it cannot be steered into giving advice. Each line is checked before it is returned,
// and anything that fails the checks gets a 204, so the app uses its built-in line instead.

const ORIGINS = ["https://speechpractice.github.io", "https://speakandmove.github.io"];
const LANGS = { en: "English", ta: "Tamil", hi: "Hindi", es: "Spanish", fr: "French", pt: "Brazilian Portuguese", id: "Indonesian", ru: "Russian", ar: "Modern Standard Arabic", zh: "Simplified Chinese", bn: "Bengali" };
// Non-Latin languages must answer in their own script.
const SCRIPT = { ta: /[஀-௿]/, hi: /[ऀ-ॿ]/, bn: /[ঀ-৿]/, ar: /[؀-ۿ]/, ru: /[Ѐ-ӿ]/, zh: /[一-鿿]/ };
const MOMENT = {
  "speak:great": "just finished a round of voice practice and kept a strong, loud voice the whole time. Praise them.",
  "speak:ok": "just finished a round of voice practice and was loud for part of it. Praise them, and cue keeping the voice strong right to the end.",
  "speak:low": "just finished a round of voice practice and was quieter than the target. Encourage them kindly, and cue a big breath and a louder voice next time.",
  "speak:move": "just finished a round of voice practice. Praise them.",
  "move:move": "just finished one gentle movement exercise. Praise them, and encourage a steady, comfortable pace."
};
// English meanings that mention health or advice are rejected.
const BLOCK = /doctor|medic|disease|parkinson|stroke|sclerosis|therap|diagnos|symptom|pain|cure|heal|treat|pill|drug|dose|injur|patient|condition|illness|sick/i;
const pool = new Map(); // a few approved lines per moment, reused while this worker instance is warm

const cors = (origin) => ({ "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Vary": "Origin" });
const json = (obj, origin, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...cors(origin) } });

function prompt(lang, moment) {
  return `Write one short, warm line of encouragement for an adult who ${moment}

Rules:
- Language: ${LANGS[lang]}. At most 10 words. Plain everyday words, friendly and respectful, suitable for an older adult.
- Use wording that works for any gender. If ${LANGS[lang]} marks gender in verbs or adjectives, rephrase to avoid it.
- Only praise or a cue about voice loudness, breathing or steady movement. Never mention health, illness, doctors, treatment, pain or the body beyond breath, belly and voice.
- No numbers, no emoji, no names, no questions.

Reply with JSON only, no other text:
{"say": "<the line in ${LANGS[lang]}>", "latin": "<the line in English letters, or empty if it is already in Latin letters>", "en": "<the English meaning>"}`;
}

function check(o, lang) {
  if (!o || typeof o.say !== "string" || typeof o.en !== "string") return null;
  const say = o.say.trim(), en = o.en.trim(), latin = typeof o.latin === "string" ? o.latin.trim() : "";
  if (!say || say.length > 120 || en.length > 120 || latin.length > 160) return null;
  if (/[0-9?<>{}]/.test(say) || BLOCK.test(en) || BLOCK.test(latin)) return null;
  if (SCRIPT[lang] && !SCRIPT[lang].test(say)) return null;
  if (lang === "en") return { say, latin: "", en: "" };
  return { say, latin: SCRIPT[lang] ? latin : "", en };
}

function parse(text) {
  const m = String(text || "").match(/\{[\s\S]*\}/);
  try { return m ? JSON.parse(m[0]) : null; } catch (e) { return null; }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (!ORIGINS.includes(origin)) return new Response("Not allowed", { status: 403 });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: cors(origin) });

    // Loose per-address limit; Cloudflare counts this without storing anything for us.
    if (env.LIMITER) {
      const { success } = await env.LIMITER.limit({ key: request.headers.get("CF-Connecting-IP") || "x" });
      if (!success) return json({ error: "slow down" }, origin, 429);
    }

    let b;
    try { b = JSON.parse((await request.text()).slice(0, 300)); } catch (e) { return json({ error: "bad request" }, origin, 400); }
    const lang = LANGS[b.lang] ? b.lang : null, key = `${b.kind}:${b.level}`;
    if (!lang || !MOMENT[key]) return json({ error: "bad request" }, origin, 400);

    const k = `${lang}|${key}`, have = pool.get(k) || [];
    if (have.length >= 6) return json(have[Math.floor(Math.random() * have.length)], origin);

    try {
      const out = await env.AI.run(env.MODEL || "@cf/google/gemma-3-12b-it", {
        messages: [{ role: "user", content: prompt(lang, MOMENT[key]) }],
        max_tokens: 160, temperature: 0.8
      });
      const line = check(parse(out && out.response), lang);
      if (!line) return new Response(null, { status: 204, headers: cors(origin) });
      if (!have.some((x) => x.say === line.say)) { have.push(line); pool.set(k, have); }
      return json(line, origin);
    } catch (e) {
      // Includes the free daily allowance running out: the app then uses its built-in lines.
      return new Response(null, { status: 204, headers: cors(origin) });
    }
  }
};

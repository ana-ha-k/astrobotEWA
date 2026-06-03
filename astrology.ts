import OpenAI from "openai";

if (!process.env.GROQ_API_KEY) {
  throw new Error("GROQ_API_KEY must be set.");
}

const openai = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: "https://api.groq.com/openai/v1",
});

export const NAKSHATRAS = [
  "Ashwini", "Bharani", "Krittika", "Rohini", "Mrigashira", "Ardra",
  "Punarvasu", "Pushya", "Ashlesha", "Magha", "Purva Phalguni", "Uttara Phalguni",
  "Hasta", "Chitra", "Swati", "Vishakha", "Anuradha", "Jyeshtha",
  "Mula", "Purva Ashadha", "Uttara Ashadha", "Shravana", "Dhanishtha", "Shatabhisha",
  "Purva Bhadrapada", "Uttara Bhadrapada", "Revati",
] as const;

export type Nakshatra = (typeof NAKSHATRAS)[number];

export interface DailyForecast {
  nakshatras: Record<Nakshatra, string>;
}

export async function generateDailyForecast(): Promise<DailyForecast> {
  const prompt = `You are a Vedic astrology oracle who is absolutely, unshakeably, borderline-delusionally optimistic. You write collective daily forecasts rooted purely in each nakshatra's inherent nature, energy, deity, and qualities — no planets, no transits, no houses, no zodiac signs mentioned at all.

Write a punchy 1–2 sentence delusional-optimist manifestation forecast for each of the 27 nakshatras, drawing only from that nakshatra's own essence and symbolism. End each with a relevant emoji.

Respond ONLY with valid JSON — no markdown, no extra text:
{
  "Ashwini": "...",
  "Bharani": "...",
  "Krittika": "...",
  "Rohini": "...",
  "Mrigashira": "...",
  "Ardra": "...",
  "Punarvasu": "...",
  "Pushya": "...",
  "Ashlesha": "...",
  "Magha": "...",
  "Purva Phalguni": "...",
  "Uttara Phalguni": "...",
  "Hasta": "...",
  "Chitra": "...",
  "Swati": "...",
  "Vishakha": "...",
  "Anuradha": "...",
  "Jyeshtha": "...",
  "Mula": "...",
  "Purva Ashadha": "...",
  "Uttara Ashadha": "...",
  "Shravana": "...",
  "Dhanishtha": "...",
  "Shatabhisha": "...",
  "Purva Bhadrapada": "...",
  "Uttara Bhadrapada": "...",
  "Revati": "..."
}`;

  const response = await openai.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    max_tokens: 4000,
    messages: [{ role: "user", content: prompt }],
  });

  const raw = response.choices[0]?.message?.content ?? "{}";
  try {
    const cleaned = raw.replace(/```json|```/g, "").trim();
    return { nakshatras: JSON.parse(cleaned) as Record<Nakshatra, string> };
  } catch {
    const fallback = "Your nakshatra energy is fully activated and working in your favour today. ✨";
    return { nakshatras: Object.fromEntries(NAKSHATRAS.map((n) => [n, fallback])) as Record<Nakshatra, string> };
  }
}

export interface OracleCard {
  name: string; theme: string; message: string; guidance: string; affirmation: string;
}

export async function generateOracleCard(): Promise<OracleCard> {
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const response = await openai.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    max_tokens: 400,
    messages: [{
      role: "user",
      content: `You are drawing a daily oracle card for a spiritual manifestation community called "Cosmic Creator's". Today is ${today}.
The card must be positive, expansive, and rooted in spiritual/Vedic/cosmic energy. No fear, no warnings — only growth, abundance, and alignment.
Respond ONLY with valid JSON, no markdown:
{"name":"...","theme":"...","message":"...","guidance":"...","affirmation":"..."}`,
    }],
  });
  const raw = response.choices[0]?.message?.content ?? "{}";
  try {
    return JSON.parse(raw.replace(/```json|```/g, "").trim()) as OracleCard;
  } catch {
    return {
      name: "The Cosmic Receiver", theme: "Abundance",
      message: "The universe has already said yes. Your only job today is to stay open, stay soft, and let the good find you.",
      guidance: "Take one moment today to sit in silence and simply receive.",
      affirmation: "I am open, I am worthy, and abundance flows to me with ease.",
    };
  }
}

export async function generateAbundanceTeaching(): Promise<string> {
  const topics = [
    "nervous system regulation and how it blocks manifestation",
    "the theta brainwave state and subconscious reprogramming",
    "cortisol patterns and how stress keeps abundance away",
    "HRV (heart rate variability) and its connection to manifestation",
    "neuroplasticity and rewiring the brain for abundance",
    "the vagus nerve and its role in feeling safe to receive",
    "somatic healing and releasing stored scarcity from the body",
    "Kriya Yoga and its effect on the nervous system",
    "identity shifting and becoming the person who has it all",
    "the subconscious mind and why affirmations alone don't work",
    "co-regulation and how your environment shapes your frequency",
    "the reticular activating system and why you see what you believe",
    "dopamine, motivation, and building momentum in manifestation",
    "oxytocin and the role of safety in receiving love and money",
    "window of tolerance and expanding your capacity for abundance",
  ];
  const topic = topics[Math.floor(Math.random() * topics.length)];
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  const response = await openai.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    max_tokens: 500,
    messages: [{
      role: "user",
      content: `You are writing for "Cosmic Creator's", a spiritual manifestation community that bridges neuroscience, Kriya Yoga, and abundance. Today is ${today}.

Write a short, punchy abundance teaching about: ${topic}

Format:
- Start with one bold insight (1 sentence, no fluff)
- 2-3 sentences of neuroscience/spiritual explanation in simple language
- One practical thing they can do TODAY
- End with one high-frequency affirmation in italics

Keep it under 150 words. No hashtags. Speak directly to the reader as "you". Tone: confident, warm, knowledgeable — like a mentor who has been where they are.`,
    }],
  });
  return response.choices[0]?.message?.content?.trim() ?? 
    "**Your nervous system is the gateway to abundance.**\n\nWhen you are in a state of chronic stress, your brain literally cannot perceive opportunities. Cortisol narrows your focus to survival not creation.\n\nToday: Take 5 slow exhales to activate your parasympathetic nervous system before you work on your goals.\n\n*I am safe to receive. My nervous system is regulated. Abundance flows through me now.*";
}

export async function generateManifestationPrompt(): Promise<string> {
  const weekNumber = Math.ceil((Date.now() - new Date(new Date().getFullYear(), 0, 1).getTime()) / (7 * 24 * 60 * 60 * 1000));
  const response = await openai.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    max_tokens: 400,
    messages: [{
      role: "user",
      content: `You are writing for a spiritual manifestation community called "Cosmic Creator's". It is week ${weekNumber} of the year.
Write a Monday morning "This week I will..." manifestation post. Start with a single esoteric insight (1-2 sentences). Then a blank line. Then: **This week I will...** Then 3 sentence completions starting with →. End with one emoji on its own line. No extra text.`,
    }],
  });
  return response.choices[0]?.message?.content?.trim()
    ?? "The cosmos are conspiring for your highest good this week. ✨\n\n**This week I will...**\n\n→ call in what is already mine\n→ move as if the miracle has happened\n→ trust that my frequency is doing the work\n\n🌙";
}

// Vercel serverless function: auto-correction + report formatting for intern updates.
// Needs one environment variable in Vercel: ANTHROPIC_API_KEY
// Optional: POLISH_MODEL (default below)

const MODEL = process.env.POLISH_MODEL || "claude-sonnet-5-5";

const TASK_PROMPT = `You edit daily work updates written by interns at Admakai (an AI content team that makes music, ads and videos with tools like Suno AI, Gemini, Flow Music and CapCut).
The intern's text may be in Bangla, English or mixed, with spelling mistakes or casual wording.
Rewrite it as a clean, professional report in English:
- One task per item, past tense, short and clear (max about 20 words each).
- Fix spelling and grammar. Keep tool and product names exactly (Suno AI, Gemini, Flow Music, CapCut, OVC, TVC).
- Keep every number and fact the intern gave. Never invent tasks, tools, numbers or results.
- Merge duplicates. Maximum 8 items.
Return ONLY JSON: {"items":["...","..."]}`;

const SUMMARY_PROMPT = `You write the executive-summary themes for a daily intern task report.
Input: one line per intern in the form "Name (Team X): task; task".
Write 2 to 4 short theme bullets, each in the exact form "Label: one sentence", for example:
"Music: 9 interns worked on songs, mostly with Suno AI, including Bengali songs and a TVC song."
"Video: OVC videos (Rafatul, Sadik), 1 ad (Tasnimul)."
Rules: use only facts present in the input; use first names or short names only; be accurate with counts; professional English; no extra text.
Return ONLY JSON: {"items":["Label: ...","Label: ..."]}`;

function parseItems(text) {
  const clean = String(text || "").replace(/```json|```/g, "").trim();
  const start = clean.indexOf("{"), end = clean.lastIndexOf("}");
  const obj = JSON.parse(start >= 0 ? clean.slice(start, end + 1) : clean);
  if (!obj || !Array.isArray(obj.items)) throw new Error("bad shape");
  return obj.items.map(String).map(s => s.trim()).filter(Boolean).slice(0, 12);
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error: "ANTHROPIC_API_KEY is not set" });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const mode = body && body.mode, text = body && typeof body.text === "string" ? body.text.trim() : "";
  if (mode !== "task" && mode !== "summary") return res.status(400).json({ error: "bad mode" });
  if (!text) return res.status(400).json({ error: "empty text" });
  if (text.length > (mode === "task" ? 3000 : 12000)) return res.status(400).json({ error: "text too long" });

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 900,
        system: mode === "task" ? TASK_PROMPT : SUMMARY_PROMPT,
        messages: [{ role: "user", content: text }]
      })
    });
    if (!r.ok) return res.status(502).json({ error: "upstream " + r.status });
    const data = await r.json();
    const out = (data.content || []).map(c => c.text || "").join("");
    const items = parseItems(out);
    if (!items.length) return res.status(502).json({ error: "empty result" });
    return res.status(200).json({ items });
  } catch (e) {
    return res.status(502).json({ error: "failed" });
  }
};

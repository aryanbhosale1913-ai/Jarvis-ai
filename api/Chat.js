module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: "Server is missing GEMINI_API_KEY. Add it in Vercel Environment Variables."
    });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const message = typeof body.message === "string" ? body.message.trim() : "";
    const history = Array.isArray(body.history) ? body.history : [];
    const memories = Array.isArray(body.memories) ? body.memories : [];
    const clientTime = typeof body.clientTime === "string" ? body.clientTime : new Date().toUTCString();

    if (!message) {
      return res.status(400).json({ error: "Message cannot be empty." });
    }

    if (message.length > 4000) {
      return res.status(400).json({ error: "Message is too long (max 4000 characters)." });
    }

    const memorySection =
      memories.length > 0
        ? `\nKnown facts & preferences about Aryan:\n- ${memories.slice(0, 30).join("\n- ")}`
        : "\nNo saved personal preferences yet.";

    const systemPrompt = `You are JARVIS, a personal AI assistant built by and for your owner, Aryan.
Current local date/time for Aryan: ${clientTime}

Personality:
- Intelligent, calm, logical, sophisticated, helpful, and occasionally dryly witty (inspired by Iron Man's JARVIS, without overdoing movie quotes).
- Address Aryan naturally (occasionally "Aryan" or "sir" in a tasteful, modern way).
- Keep responses concise and conversational by default so they sound great when spoken aloud, while giving clear step-by-step depth whenever Aryan asks for explanations or help.

Honesty rules (CRITICAL):
- Do NOT pretend to have capabilities you do not currently have. Right now in Phase 1, you CANNOT browse the live internet, set iOS reminders, trigger Apple Shortcuts, control smart home devices, or inspect uploaded images. If asked, politely tell Aryan that module is planned for a future phase and offer what you *can* help with right now.

Memory instructions:
- Use the known facts below naturally when relevant.${memorySection}
- ONLY if Aryan explicitly asks you to remember something or states a clear personal preference/fact (e.g., "Remember I live in Mumbai", "I prefer short answers", "My favorite language is Python"), add a single line at the very end of your response in this exact format:
[[MEMORY: concise fact about Aryan]]
- Do not output [[MEMORY: ...]] unless there is a genuinely new preference or fact to save.`;

    const contents = [];
    for (const item of history.slice(-14)) {
      if (!item || typeof item.text !== "string" || !item.text.trim()) continue;
      const role = item.role === "model" ? "model" : "user";
      if (contents.length === 0 && role !== "user") continue;
      if (contents.length > 0 && contents[contents.length - 1].role === role) continue;
      contents.push({ role, parts: [{ text: item.text.trim() }] });
    }

    if (contents.length > 0 && contents[contents.length - 1].role === "user") {
      contents.pop();
    }
    contents.push({ role: "user", parts: [{ text: message }] });

    const payload = {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 800
      }
    };

    const models = ["gemini-3.8-flash", "gemini-3.5-flash-lite"];
    let lastError = null;
    let data = null;
    let modelUsed = models[0];

    for (const model of models) {
      modelUsed = model;
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        data = await response.json();
        break;
      }

      const errText = await response.text();
      lastError = { status: response.status, detail: errText };

      if (response.status === 429 || response.status === 503) {
        continue;
      } else {
        break;
      }
    }

    if (!data) {
      if (lastError && lastError.status === 429) {
        return res.status(429).json({
          error: "Free Gemini quota reached for now. No charges were made—please wait a bit and try again."
        });
      }
      return res.status(502).json({
        error: "JARVIS could not reach the Gemini brain right now. Please try again in a moment."
      });
    }

    const rawText =
      data.candidates?.[0]?.content?.parts
        ?.map((part) => part.text || "")
        .join("")
        .trim() || "";

    if (!rawText) {
      return res.status(500).json({
        error: "Gemini returned an empty response."
      });
    }

    const newMemories = [];
    const cleanedReply = rawText
      .replace(/\[\[MEMORY:\s*(.+?)\]\]/gi, (_, fact) => {
        const cleanFact = fact.trim();
        if (cleanFact) newMemories.push(cleanFact);
        return "";
      })
      .trim();

    return res.status(200).json({
      reply: cleanedReply || "Understood, Aryan.",
      newMemories,
      modelUsed
    });
  } catch (err) {
    return res.status(500).json({
      error: "Unexpected server error while processing your request."
    });
  }
};

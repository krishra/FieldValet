// FieldValet — Azure AI Translator wrapper.
//
// Detects the source language and translates English<->Spanish in a single call.
// If the Translator app settings are not configured, translation is skipped
// gracefully (the message still posts, just without a translated block).
//
// Required app settings: TRANSLATOR_KEY, TRANSLATOR_REGION.
// Optional: TRANSLATOR_ENDPOINT (defaults to the global endpoint).

const DEFAULT_ENDPOINT = "https://api.cognitive.microsofttranslator.com";

function isConfigured() {
  return Boolean(process.env.TRANSLATOR_KEY && process.env.TRANSLATOR_REGION);
}

// Returns { detected, translatedText, translatedLang }.
// detected/translated are "" when translation is unavailable or unneeded.
async function translate(text) {
  const empty = { detected: "", translatedText: "", translatedLang: "" };
  if (!isConfigured() || !text || !text.trim()) return empty;

  const endpoint = (process.env.TRANSLATOR_ENDPOINT || DEFAULT_ENDPOINT).replace(/\/$/, "");
  const url = `${endpoint}/translate?api-version=3.0&to=en&to=es`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": process.env.TRANSLATOR_KEY,
        "Ocp-Apim-Subscription-Region": process.env.TRANSLATOR_REGION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([{ Text: text }]),
    });
    if (!res.ok) return empty;
    const data = await res.json();
    const first = Array.isArray(data) ? data[0] : null;
    if (!first) return empty;

    const detected = (first.detectedLanguage && first.detectedLanguage.language) || "";
    // Translate into the "other" language of the en/es pair. If the source is
    // neither, surface an English translation.
    const translatedLang = detected === "es" ? "en" : "es";
    const match = (first.translations || []).find((t) => t.to === translatedLang);
    const translatedText = match ? match.text : "";

    // Don't echo an identical string back as a "translation".
    if (!translatedText || translatedText.trim() === text.trim()) {
      return { detected, translatedText: "", translatedLang: "" };
    }
    return { detected, translatedText, translatedLang };
  } catch (e) {
    return empty;
  }
}

module.exports = { translate, isConfigured };

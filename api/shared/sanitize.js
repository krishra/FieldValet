// FieldValet — message text sanitisation.
//
// Messages are stored as PLAIN TEXT (emoji are just Unicode). The client applies a
// tiny, safe markdown subset (**bold**, *italic*, links) at render time over
// HTML-escaped text, so we never persist or trust raw HTML — no stored-XSS surface.
const MAX_LEN = 2000;

// Strip any HTML tags, normalise newlines, and clamp to the max length.
function toPlainText(input) {
  let s = String(input == null ? "" : input);
  s = s.replace(/<[^>]*>/g, ""); // remove tags
  s = s.replace(/\r\n?/g, "\n"); // normalise newlines
  // Collapse runs of >2 blank lines, trim trailing whitespace per line.
  s = s
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (s.length > MAX_LEN) s = s.slice(0, MAX_LEN);
  return s;
}

module.exports = { toPlainText, MAX_LEN };

/**
 * Marks the words of a search in a text, ignoring diacritics and case ("racadau" marks
 * "Răcădău"). Returns plain parts for React to render, never HTML. Folding is done character by
 * character, so positions in the folded text match the original.
 */
export interface Part {
  text: string;
  match: boolean;
}

function foldChar(c: string): string {
  const f = c.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  return f.length === 1 ? f : c.toLowerCase().slice(0, 1) || c;
}

export function fold(text: string): string {
  return Array.from(text, foldChar).join("");
}

export function searchTerms(q: string): string[] {
  return (q.match(/[\p{L}\p{N}]+/gu) ?? []).map(fold).filter((t) => t.length > 0);
}

/** A word matches a term when it starts with it, or shares enough of its beginning to be the
 * same word inflected ("locuinte" ~ "locuință"), as Postgres' Romanian stemming does. */
function matches(word: string, term: string): boolean {
  if (word.startsWith(term)) return true;
  const need = Math.max(4, term.length - 2);
  return term.length >= 5 && word.length >= need && word.slice(0, need) === term.slice(0, need);
}

export function highlight(text: string, terms: string[]): Part[] {
  if (!terms.length || !text) return [{ text, match: false }];
  const chars = Array.from(text);
  const folded = chars.map(foldChar);
  const parts: Part[] = [];
  let plain = "";
  let i = 0;
  while (i < chars.length) {
    if (/[\p{L}\p{N}]/u.test(chars[i]!) && (i === 0 || !/[\p{L}\p{N}]/u.test(chars[i - 1]!))) {
      let end = i;
      while (end < chars.length && /[\p{L}\p{N}]/u.test(chars[end]!)) end++;
      const word = folded.slice(i, end).join("");
      if (terms.some((t) => matches(word, t))) {
        if (plain) parts.push({ text: plain, match: false });
        plain = "";
        parts.push({ text: chars.slice(i, end).join(""), match: true });
        i = end;
        continue;
      }
    }
    plain += chars[i];
    i++;
  }
  if (plain) parts.push({ text: plain, match: false });
  return parts;
}

/** About `size` characters of `text` around its first match, cut at word boundaries. */
export function snippet(text: string, terms: string[], size = 220): string {
  if (text.length <= size) return text;
  const parts = highlight(text, terms);
  const at = parts.findIndex((p) => p.match);
  const before = parts.slice(0, Math.max(0, at)).reduce((n, p) => n + p.text.length, 0);
  let start = Math.max(0, before - Math.floor(size / 3));
  if (start > 0) start = text.indexOf(" ", start) + 1 || start;
  let end = Math.min(text.length, start + size);
  if (end < text.length) end = text.lastIndexOf(" ", end) || end;
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

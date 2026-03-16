// ---------------------------------------------------------------------------
// Parse plain text deck lists in common formats:
//   "4x Lightning Bolt"  |  "4 Lightning Bolt"  |  "Lightning Bolt x4"
// Also handles sideboard sections and MTG Arena format
// ---------------------------------------------------------------------------

export interface ParsedDeckEntry {
  quantity: number;
  name: string;
  setCode?: string;
  isSideboard: boolean;
}

export function parseTextDeckList(text: string): ParsedDeckEntry[] {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const entries: ParsedDeckEntry[] = [];
  let isSideboard = false;

  for (const line of lines) {
    // Detect sideboard section
    if (/^(sideboard|side|sb):?\s*$/i.test(line)) {
      isSideboard = true;
      continue;
    }
    if (/^(main|maindeck|main deck|deck):?\s*$/i.test(line)) {
      isSideboard = false;
      continue;
    }
    // Skip comments
    if (line.startsWith('//') || line.startsWith('#')) continue;

    // Pattern: "4x Card Name" or "4 Card Name"
    let match = line.match(/^(\d+)\s*x?\s+(.+?)(?:\s+\((\w+)\)(?:\s+\d+)?)?$/i);
    if (match) {
      entries.push({
        quantity: parseInt(match[1], 10),
        name: match[2].trim(),
        setCode: match[3],
        isSideboard
      });
      continue;
    }

    // Pattern: "Card Name x4"
    match = line.match(/^(.+?)\s+x(\d+)$/i);
    if (match) {
      entries.push({
        quantity: parseInt(match[2], 10),
        name: match[1].trim(),
        isSideboard
      });
      continue;
    }

    // Fallback: treat as single copy
    if (line.length > 0 && !line.startsWith('---')) {
      entries.push({ quantity: 1, name: line, isSideboard });
    }
  }

  return entries;
}

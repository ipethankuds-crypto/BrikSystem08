import fs from 'fs';

const html = fs.readFileSync('index.html', 'utf8');
const match = html.match(/<script type="text\/babel">([\s\S]*?)<\/script>/);
if (!match) { console.log('No babel script'); process.exit(1); }

const code = match[1];
const lines = code.split('\n');

let braceCount = 0;
let parenCount = 0;
let inString = false;
let stringChar = '';
let prevChar = '';
const issues = [];

for (let li = 0; li < lines.length; li++) {
  const line = lines[li];
  for (let ci = 0; ci < line.length; ci++) {
    const ch = line[ci];
    if (inString) {
      if (ch === stringChar && prevChar !== '\\') inString = false;
    } else {
      if (ch === '"' || ch === "'" || ch === '`') { inString = true; stringChar = ch; }
      else if (ch === '{') braceCount++;
      else if (ch === '}') { braceCount--; if (braceCount < -2) issues.push(`line ${li+1} (braces=${braceCount}): ${line.trim().slice(0,80)}`); }
      else if (ch === '(') parenCount++;
      else if (ch === ')') { parenCount--; if (parenCount < -3) issues.push(`line ${li+1} (parens=${parenCount}): ${line.trim().slice(0,80)}`); }
    }
    prevChar = ch;
  }
}

console.log(`Final: braces=${braceCount}, parens=${parenCount}`);
if (issues.length > 0) {
  console.log('Potential issues found:');
  issues.forEach(i => console.log(' -', i));
} else {
  console.log('No obvious bracket issues found!');
}

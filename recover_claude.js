const fs = require('fs');
const path = require('path');

const logDir = '/Users/dukewang/.claude/projects/-Users-dukewang-Fantasy-Futbol';
const files = fs.readdirSync(logDir).filter(f => f.endsWith('.jsonl'));

if (!fs.existsSync('/tmp/claude_recover')) fs.mkdirSync('/tmp/claude_recover');

let fileVersions = {};

function extractToolCalls(file) {
  const content = fs.readFileSync(path.join(logDir, file), 'utf-8');
  const lines = content.split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);

      // Look for Read tool results containing full file content
      if (obj.toolUseResult && obj.toolUseResult.file && obj.toolUseResult.file.filePath) {
        const fpath = obj.toolUseResult.file.filePath;
        const text = obj.toolUseResult.file.content;
        if (text) {
          fileVersions[fpath] = text;
        }
      }

      // Look for Write tool usages
      if (obj.message && obj.message.content && Array.isArray(obj.message.content)) {
        for (const block of obj.message.content) {
          if (block.type === 'tool_use' && (block.name === 'WriteFile' || block.name === 'Write')) {
            const fpath = block.input.absolute_path || block.input.file_path || block.input.target_file || block.input.target;
            if (!fpath) continue;
            const text = block.input.file_contents || block.input.content || block.input.code_content || '';
            fileVersions[fpath] = text;
          }
          if (block.type === 'tool_use' && block.name === 'Edit' && obj.toolUseResult && obj.toolUseResult.newString) {
            // We can't easily apply partial edits here without writing a patcher.
            // But usually toolUseResult has the newString? No, toolUseResult has the full `newString` or `file`... wait, Edit toolResult outputs the new whole file sometimes? Let's just rely on Read and Write for now.
          }
        }
      }
    } catch { }
  }
}

for (const file of files) {
  extractToolCalls(file);
}

// Dump all latest known file contents into the recovery directory mapped by their base name
for (const [fpath, text] of Object.entries(fileVersions)) {
  const targets = [
    'LineupEditor.tsx',
    'TransferMarketClient.tsx',
    'fixtures/page.tsx',
    'standings/page.tsx',
    'transfers/page.tsx',
    'matchups/page.tsx',
    'process-auctions/route.ts',
    'auctions/route.ts',
    'sync/players/route.ts',
    'auto-pick/route.ts',
    'matchups/route.ts',
    'teams/[teamId]/drop/route.ts',
    'teams/[teamId]/lineup/route.ts',
    'generator.ts'
  ];

  for (const t of targets) {
    if (fpath.includes(t)) {
      // preserve the dir structure in tmp
      const rel = fpath.split('/src/')[1];
      if (rel) {
        const outPath = path.join('/tmp/claude_recover', rel);
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, text);
        console.log(`Recovered: ${fpath} -> ${outPath}`);
      }
    }
  }
}

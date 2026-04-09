const fs = require('fs');
const path = require('path');

const logDir = '/Users/dukewang/.claude/projects/-Users-dukewang-Fantasy-Futbol';
const files = fs.readdirSync(logDir).filter(f => f.endsWith('.jsonl'));

if (!fs.existsSync('/tmp/claude_recover2')) fs.mkdirSync('/tmp/claude_recover2');

let fileVersions = {};

function extractToolCalls(file) {
    const content = fs.readFileSync(path.join(logDir, file), 'utf-8');
    const lines = content.split('\n');
    for (const line of lines) {
        if (!line.trim()) continue;
        try {
            const obj = JSON.parse(line);

            if (obj.toolUseResult && obj.toolUseResult.file && obj.toolUseResult.file.filePath) {
                const fpath = obj.toolUseResult.file.filePath;
                const text = obj.toolUseResult.file.content;
                if (text) fileVersions[fpath] = text;
            }

            if (obj.message && obj.message.content && Array.isArray(obj.message.content)) {
                for (const block of obj.message.content) {
                    if (block.type === 'tool_use' && (block.name === 'WriteFile' || block.name === 'Write')) {
                        const fpath = block.input.absolute_path || block.input.file_path || block.input.target_file || block.input.target;
                        if (!fpath) continue;
                        const text = block.input.file_contents || block.input.content || block.input.code_content || '';
                        fileVersions[fpath] = text;
                    }
                }
            }
        } catch { }
    }
}

for (const file of files) {
    extractToolCalls(file);
}

for (const [fpath, text] of Object.entries(fileVersions)) {
    const targets = [
        'auctions/bid/route.ts',
        'drop/route.ts',
        'insertMatchups.ts',
        'types/index.ts'
    ];

    for (const t of targets) {
        if (fpath.includes(t)) {
            const rel = fpath.split('/src/')[1];
            if (rel) {
                const outPath = path.join('/tmp/claude_recover2', rel);
                fs.mkdirSync(path.dirname(outPath), { recursive: true });
                fs.writeFileSync(outPath, text);
                console.log(`Recovered: ${fpath} -> ${outPath}`);
            }
        }
    }
}

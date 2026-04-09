const fs = require('fs');
const path = require('path');

const CLAUDE_DIR = path.join(process.env.HOME, '.claude/projects');
// Find the right project folder
const folders = fs.readdirSync(CLAUDE_DIR).filter(f => !f.startsWith('.'));
const projectFolder = folders.find(f => f.includes('Fantasy-Futbol'));

if (!projectFolder) {
    console.log('Project folder not found');
    process.exit(1);
}

const logsDir = path.join(CLAUDE_DIR, projectFolder);
const files = fs.readdirSync(logsDir).filter(f => f.endsWith('.jsonl'));

let bestDraftCss = '';
let maxLen = 0;

for (const file of files) {
    const content = fs.readFileSync(path.join(logsDir, file), 'utf-8');
    const lines = content.split('\n').filter(l => l.trim().length > 0);

    for (const line of lines) {
        try {
            const entry = JSON.parse(line);
            // Let's check user inputs and assistant responses
            // Assistant response with tool_use
            if (entry.message?.content) {
                for (const block of entry.message.content) {
                    if (block.type === 'tool_use' && (block.name === 'WriteFile' || block.name === 'Edit')) {
                        const fileArg = block.input.file_path || block.input.target_file || block.input.TargetFile;
                        if (fileArg && fileArg.includes('draft.module.css')) {
                            const fileContent = block.input.file_contents || block.input.file_content || block.input.CodeContent;
                            if (fileContent && fileContent.length > maxLen) {
                                maxLen = fileContent.length;
                                bestDraftCss = fileContent;
                            }
                        }
                    }
                }
            }
        } catch {
            // ignore
        }
    }
}

if (bestDraftCss) {
    fs.writeFileSync('recovered_draft.module.css', bestDraftCss);
    console.log('Recovered draft.module.css! Length:', bestDraftCss.length);
} else {
    console.log('Could not find draft.module.css in logs.');
}

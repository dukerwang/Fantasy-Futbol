const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..', 'src');

function getFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach((file) => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getFiles(fullPath));
    } else if (file.endsWith('.ts') || file.endsWith('.tsx')) {
      results.push(fullPath);
    }
  });
  return results;
}

const files = getFiles(srcDir);
const exportsMap = [];

// Regex to capture exports
const exportRegex = /^export\s+(const|function|type|interface|class|enum)\s+([a-zA-Z0-9_]+)/gm;
const namedExportsRegex = /^export\s+{[^}]+}/gm;

files.forEach((file) => {
  const content = fs.readFileSync(file, 'utf8');
  let match;
  
  // Find standard exports
  while ((match = exportRegex.exec(content)) !== null) {
    const type = match[1];
    const name = match[2];
    exportsMap.push({ file, name, type });
  }
  
  // Find default export
  const defaultMatch = content.match(/^export\s+default\s+(?:function\s+([a-zA-Z0-9_]+)|class\s+([a-zA-Z0-9_]+)|([a-zA-Z0-9_]+))/m);
  if (defaultMatch) {
    const name = defaultMatch[1] || defaultMatch[2] || defaultMatch[3];
    if (name && name !== 'async') {
      exportsMap.push({ file, name, type: 'default' });
    }
  }
});

console.log(`Found ${exportsMap.length} exported items. Checking references...`);

const deadExports = [];

exportsMap.forEach((exp) => {
  let count = 0;
  const pattern = new RegExp(`\\b${exp.name}\\b`);
  
  files.forEach((file) => {
    if (file === exp.file) return; // skip self
    const content = fs.readFileSync(file, 'utf8');
    if (pattern.test(content)) {
      count++;
    }
  });
  
  if (count === 0) {
    deadExports.push(exp);
  }
});

console.log('\n--- DEAD EXPORTS ---');
deadExports.forEach((exp) => {
  const relPath = path.relative(path.join(__dirname, '..'), exp.file);
  console.log(`${exp.type} ${exp.name} in ${relPath}`);
});

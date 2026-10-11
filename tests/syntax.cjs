const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
let scripts = 0;
for (const file of fs.readdirSync(root).filter(f => /\.(gs|html)$/.test(f))) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  if (file.endsWith('.gs')) { new vm.Script(source, {filename:file}); scripts++; }
  else for (const match of source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    new vm.Script(match[1].replace(/<\?[\s\S]*?\?>/g, 'template'), {filename:file}); scripts++;
  }
}
JSON.parse(fs.readFileSync(path.join(root, 'appsscript.json'), 'utf8'));
console.log(`PASS: ${scripts} scripts and Apps Script manifest parse`);

const fs = require('node:fs');
const path = require('node:path');

function readBackendSources(directory = path.resolve(__dirname, '..', '..')) {
  return fs.readdirSync(directory, {withFileTypes:true})
    .filter(entry => entry.isFile() && entry.name.endsWith('.gs'))
    .map(entry => entry.name)
    .sort()
    .map(name => ({name, source:fs.readFileSync(path.join(directory, name), 'utf8')}));
}

module.exports = {readBackendSources};

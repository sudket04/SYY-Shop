// Evaluate the repository's server scriptlets. This is not HtmlService's contextual escaping engine.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
let invoiceMathSource, stockQuantitySource;
function evaluateTemplate(file, values = {}) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  let program = 'const output=[];\n', offset = 0;
  for (const match of source.matchAll(/<\?(!=|=)?([\s\S]*?)\?>/g)) {
    program += 'output.push(' + JSON.stringify(source.slice(offset, match.index)) + ');\n';
    const expression = match[2].trim().replace(/;$/, '');
    if (match[1]) program += 'output.push(' + (match[1] === '=' ? '__escape' : 'String') + '((' + expression + ')));\n';
    else program += match[2] + '\n';
    offset = match.index + match[0].length;
  }
  program += 'output.push(' + JSON.stringify(source.slice(offset)) + ');\noutput.join("");';
  return vm.runInNewContext(program, {
    include_: name => fs.readFileSync(path.join(root, name + '.html'), 'utf8'),
    __escape: value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])),
    ...(file==='Master_Tax_Invoice.html' ? {invoiceMathSource:invoiceMathSource ||= require('./services.cjs').setup().c.calcTaxInvoiceTotals_.toString()} : {}),
    ...(['StockIssue.html','Purchase_Orders.html'].includes(file) ? {stockQuantitySource:stockQuantitySource ||= require('./services.cjs').setup().c.addStockQuantity_.toString()} : {}),
    ...values
  }, {filename: file, timeout: 1000});
}
module.exports = {evaluateTemplate};

// Exercise the served commit renderer using a minimal text-only DOM.
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const page = readFileSync(process.argv[2], 'utf8');
const record = JSON.parse(readFileSync(0, 'utf8'));
class Element {
  constructor() { this.textContent = ''; this.children = []; }
  append(...children) { this.children.push(...children); }
}
const body = page.split('(() => {')[1].split('  async function load()')[0];
const context = {document: {createElement: () => new Element()}, record};
vm.runInNewContext(body + '\nglobalThis.rendered = renderCommit(record);', context);
const text = node => [node.textContent, ...node.children.map(text)].join('\n');
console.log(text(context.rendered));

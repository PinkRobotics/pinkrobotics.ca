// Exercise the served renderers using a minimal text-only DOM.
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const page = readFileSync(process.argv[2], 'utf8');
const record = JSON.parse(readFileSync(0, 'utf8'));
class Element {
  constructor() { this.textContent = ''; this.children = []; this.hidden = true; }
  append(...children) { this.children.push(...children); }
  setAttribute() {}
  scrollIntoView() {}
}
const body = page.split('(() => {')[1].split('  async function load()')[0];
const text = node => [node.textContent, ...node.children.map(text)].join('\n');
if (process.argv[3] === '--page') {
  const elements = new Map();
  const get = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  const context = {Node: Element, AbortSignal, Intl, location: {hash: ''}, addEventListener() {},
    document: {createElement: () => new Element(), createTextNode: value => {
      const node = new Element(); node.textContent = value; return node;
    }, getElementById: get}, fetch: async () => ({ok: true, json: async () => record})};
  const script = page.split('<script>')[1].split('</script>')[0].replace('  load();', '  globalThis.ready = load();');
  vm.runInNewContext(script, context);
  await context.ready;
  console.log(JSON.stringify({visible: !get('record').hidden, landings: text(get('landing-list'))}));
} else {
  const context = {document: {createElement: () => new Element()}, record};
  vm.runInNewContext(body + '\nglobalThis.rendered = renderCommit(record);', context);
  console.log(text(context.rendered));
}

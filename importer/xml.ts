// Minimal, deterministic XML reader for Tiled TMX/TSX files.  It preserves
// child order (needed for pytmx layer indices) and intentionally implements
// only XML 1.0 constructs used by the pinned Tuxemon checkout.

export interface XmlNode {
  name: string;
  attrs: Readonly<Record<string, string>>;
  children: XmlNode[];
  text: string;
}
function decodeEntity(entity: string): string {
  if (entity === "amp") return "&";
  if (entity === "lt") return "<";
  if (entity === "gt") return ">";
  if (entity === "quot") return '"';
  if (entity === "apos") return "'";
  if (entity.startsWith("#x")) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
  if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
  throw new Error(`xml: unsupported entity &${entity};`);
}

export function decodeXml(value: string): string {
  return value.replace(/&([^;]+);/g, (_whole, entity: string) => decodeEntity(entity));
}

function tagEnd(source: string, start: number): number {
  let quote = "";
  for (let i = start; i < source.length; i++) {
    const ch = source[i]!;
    if (quote) {
      if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ">") {
      return i;
    }
  }
  throw new Error("xml: unterminated tag");
}

function parseOpenTag(raw: string): { name: string; attrs: Record<string, string> } {
  const nameMatch = /^\s*([^\s/>]+)/.exec(raw);
  if (!nameMatch) throw new Error(`xml: malformed tag <${raw}>`);
  const name = nameMatch[1]!;
  const attrs: Record<string, string> = {};
  const rest = raw.slice(nameMatch[0].length);
  const attr = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (const match of rest.matchAll(attr)) {
    const key = match[1]!;
    if (Object.hasOwn(attrs, key)) throw new Error(`xml: duplicate attribute ${key} on <${name}>`);
    attrs[key] = decodeXml(match[2] ?? match[3] ?? "");
  }
  // Attribute values in TMX are always quoted.  Reject otherwise-visible
  // syntax so a malformed source cannot silently change an imported map.
  const residue = rest.replace(attr, "").trim();
  if (residue) throw new Error(`xml: malformed attributes on <${name}>: ${residue}`);
  return { name, attrs };
}

export function parseXml(source: string, label = "<xml>"): XmlNode {
  const root: XmlNode = { name: "#document", attrs: {}, children: [], text: "" };
  const stack = [root];
  let cursor = 0;
  try {
    while (cursor < source.length) {
      const lt = source.indexOf("<", cursor);
      if (lt < 0) {
        stack.at(-1)!.text += decodeXml(source.slice(cursor));
        break;
      }
      if (lt > cursor) stack.at(-1)!.text += decodeXml(source.slice(cursor, lt));

      if (source.startsWith("<!--", lt)) {
        const end = source.indexOf("-->", lt + 4);
        if (end < 0) throw new Error("unterminated comment");
        cursor = end + 3;
        continue;
      }
      if (source.startsWith("<![CDATA[", lt)) {
        const end = source.indexOf("]]>", lt + 9);
        if (end < 0) throw new Error("unterminated CDATA");
        stack.at(-1)!.text += source.slice(lt + 9, end);
        cursor = end + 3;
        continue;
      }
      if (source.startsWith("<?", lt)) {
        const end = source.indexOf("?>", lt + 2);
        if (end < 0) throw new Error("unterminated processing instruction");
        cursor = end + 2;
        continue;
      }
      if (source.startsWith("<!", lt)) {
        const end = tagEnd(source, lt + 2);
        cursor = end + 1;
        continue;
      }

      const end = tagEnd(source, lt + 1);
      let raw = source.slice(lt + 1, end).trim();
      if (raw.startsWith("/")) {
        const name = raw.slice(1).trim();
        const node = stack.pop();
        if (!node || node === root || node.name !== name) {
          throw new Error(`mismatched closing tag </${name}> (open: <${node?.name ?? "none"}>)`);
        }
      } else {
        const selfClosing = raw.endsWith("/");
        if (selfClosing) raw = raw.slice(0, -1).trimEnd();
        const parsed = parseOpenTag(raw);
        const node: XmlNode = { ...parsed, children: [], text: "" };
        stack.at(-1)!.children.push(node);
        if (!selfClosing) stack.push(node);
      }
      cursor = end + 1;
    }
    if (stack.length !== 1) throw new Error(`unclosed tag <${stack.at(-1)!.name}>`);
    if (root.children.length !== 1) throw new Error(`expected one document element, got ${root.children.length}`);
    return root.children[0]!;
  } catch (error) {
    throw new Error(`${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function child(node: XmlNode, name: string): XmlNode | undefined {
  return node.children.find((entry) => entry.name === name);
}

export function children(node: XmlNode, name: string): XmlNode[] {
  return node.children.filter((entry) => entry.name === name);
}

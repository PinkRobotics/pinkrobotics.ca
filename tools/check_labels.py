#!/usr/bin/env python3
"""Check every inline SVG on site-owned HTML pages for estimated label collisions.

Adapted from the supplied label-overlap probe. Width is an estimate, not a font
measurement: characters * font-size * 0.6, plus letter spacing. The vertical box
extends 0.8 em above and 0.2 em below the baseline. Translate transforms, inherited
presentation attributes and inline styles are supported. Unsupported text geometry
fails explicitly; external stylesheets, font shaping and glyph outlines are not
measured. A clean estimate still needs visual inspection.
"""
import argparse
import html
from pathlib import Path
import re
import xml.etree.ElementTree as ET

EM = 0.6
STYLE = ('font-size', 'letter-spacing', 'text-anchor')


def number(value):
    return float(value.removesuffix('px'))


def boxes(svg):
    root = ET.fromstring(html.unescape(svg).replace('&', '&amp;'))
    view = [float(v) for v in re.split(r'[ ,]+', root.get('viewBox', '').strip()) if v]
    if len(view) != 4 or view[2] <= 0 or view[3] <= 0:
        raise ValueError('missing or invalid viewBox')
    result = []

    def walk(node, dx=0, dy=0, inherited=None):
        style = dict(inherited or {'font-size': '12', 'letter-spacing': '0', 'text-anchor': 'start'})
        style.update({k: node.get(k) for k in STYLE if node.get(k) is not None})
        inline = dict(re.findall(r'([\w-]+)\s*:\s*([^;]+)', node.get('style', '')))
        style.update({k: v.strip() for k, v in inline.items() if k in STYLE})
        has_text = any(n.tag.split('}')[-1] == 'text' for n in node.iter())
        if has_text:
            transform = node.get('transform', '')
            for m in re.finditer(r'translate\(\s*(-?[\d.]+)(?:[ ,]+(-?[\d.]+))?\s*\)', transform):
                dx += float(m[1]); dy += float(m[2] or 0)
            if re.sub(r'translate\([^)]*\)', '', transform).strip():
                raise ValueError('unsupported text transform')
            if 'transform' in inline:
                raise ValueError('unsupported CSS text transform')
        if node.tag.split('}')[-1] == 'text':
            if list(node) or any(k in node.attrib for k in ('textLength', 'lengthAdjust', 'rotate', 'class')):
                raise ValueError('unsupported text geometry')
            text = ' '.join(''.join(node.itertext()).split())
            if not text:
                return
            size = number(style['font-size'])
            spacing = style['letter-spacing']
            extra = float(spacing[:-2]) * size if spacing.endswith('em') else number(spacing)
            width = len(text) * size * EM + max(0, len(text) - 1) * extra
            x = number(node.get('x', '0')) + number(node.get('dx', '0')) + dx
            y = number(node.get('y', '0')) + number(node.get('dy', '0')) + dy
            anchor = style['text-anchor']
            if anchor not in ('start', 'middle', 'end'):
                raise ValueError('unsupported text anchor')
            x -= width / 2 if anchor == 'middle' else width if anchor == 'end' else 0
            result.append((x, x + width, y - size * .8, y + size * .2, text))
        else:
            for child in node:
                walk(child, dx, dy, style)
    walk(root)
    return view, result


def inspect_svg(svg):
    view, labels = boxes(svg)
    x, y, width, height = view
    findings = []
    for i, a in enumerate(labels):
        if a[0] < x or a[1] > x + width or a[2] < y or a[3] > y + height:
            findings.append(f'OUTSIDE label {i + 1}: {a[4]!r}')
        for j, b in enumerate(labels[i + 1:], i + 2):
            ox = min(a[1], b[1]) - max(a[0], b[0])
            oy = min(a[3], b[3]) - max(a[2], b[2])
            if ox > 0 and oy > 0:
                findings.append(f'OVERLAP {ox:.1f} x {oy:.1f} units: label {i + 1} {a[4]!r} / label {j} {b[4]!r}')
    return len(labels), findings


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('files', nargs='*', type=Path)
    parser.add_argument('--site', type=Path, default=Path('site'))
    args = parser.parse_args(argv)
    files = args.files or sorted(p for p in args.site.rglob('*.html')
        if p.relative_to(args.site).parts[0] not in {'airships', 'airship3d'})
    total = labels = failures = 0
    for path in files:
        for i, match in enumerate(re.finditer(r'<svg\b.*?</svg>', path.read_text(), re.S), 1):
            total += 1
            try:
                count, findings = inspect_svg(match[0])
                labels += count
            except (ValueError, ET.ParseError) as error:
                findings = [f'UNMEASURED {error}']
            for finding in findings:
                print(f'{path}:svg[{i}]: {finding}')
            failures += len(findings)
    print(f'labelcheck: svgs={total} labels={labels} findings={failures}; width estimate={EM} em per character')
    return int(bool(failures))


if __name__ == '__main__':
    raise SystemExit(main())

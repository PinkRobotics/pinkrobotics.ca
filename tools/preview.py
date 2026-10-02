#!/usr/bin/env python3
"""Serve a fresh export on the first free localhost port from 8980 to 8989."""

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from export import ExportError, export_site


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dest', required=True, type=Path)
    parser.add_argument('--activity', type=Path)
    args = parser.parse_args()
    try:
        count = export_site(args.dest, activity_file=args.activity)
    except (ExportError, OSError) as error:
        print(f'PREVIEW REFUSED: {error}')
        return 1
    handler = partial(SimpleHTTPRequestHandler, directory=str(args.dest.absolute()))
    for port in range(8980, 8990):
        try:
            server = ThreadingHTTPServer(('127.0.0.1', port), handler)
            break
        except OSError:
            continue
    else:
        print('PREVIEW REFUSED: ports 8980 to 8989 are busy')
        return 1
    print(f'preview: {count} files at http://127.0.0.1:{server.server_port}/', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

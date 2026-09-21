#!/usr/bin/env python3
"""rebuild_csp.py — regenerate the script-src hash list in _headers from the
actual inline scripts in every served HTML page.

WHY THIS EXISTS: Cloudflare enforces the CSP in _headers against inline
<script> blocks by sha256 hash. Editing any inline JS without rebuilding the
hash list silently blocks that script in production (localhost does NOT
enforce CSP, so local tests pass while prod JS is dead). This bit the site
twice (services page 20min dead, redeem typing dead + theme-bootstrap blocked
site-wide). Run this after ANY change to inline JS, or better: avoid inline
JS entirely (external .js files are CSP-immune).

Usage (from workers/site/):
  python rebuild_csp.py           # rewrite _headers in place
  python rebuild_csp.py --check   # print drift report only

The script-src line MUST keep its quoting: every hash as 'sha256-<b64>'.
"""
import base64
import hashlib
import re
import sys
import glob
import os

HERE = os.path.dirname(os.path.abspath(__file__))
HEADERS = os.path.join(HERE, '_headers')

INLINE_RE = re.compile(r'<script(?![^>]*\bsrc=)([^>]*)>(.*?)</script>', re.S)
HASH_IN_LINE_RE = re.compile(r"'sha256-[A-Za-z0-9+/=]{43,44}'")
CSP_LINE_PREFIX = '  Content-Security-Policy:'


def page_scripts(html):
    """Yield (page, length, hash) for every executable inline script."""
    out = []
    for attrs, body in re.findall(INLINE_RE, html):
        if 'ld+json' in attrs or 'application/ld+json' in attrs:
            continue
        if not body.strip():
            continue
        digest = base64.b64encode(hashlib.sha256(body.encode('utf-8')).digest()).decode()
        out.append((len(body), digest, body[:60]))
    return out


def collect():
    hashes = {}   # digest -> first page that owns it
    for f in sorted(glob.glob(os.path.join(HERE, '*.html'))):
        rel = os.path.basename(f)
        html = open(f, encoding='utf-8').read()
        for length, digest, head in page_scripts(html):
            hashes.setdefault(digest, (rel, length))
    return hashes


def main():
    check_only = '--check' in sys.argv
    fresh = collect()

    lines = open(HEADERS, encoding='utf-8').read().splitlines()
    csp_idx = next(i for i, l in enumerate(lines) if l.startswith(CSP_LINE_PREFIX) and 'script-src' in l)
    csp_line = lines[csp_idx]

    current = set(HASH_IN_LINE_RE.findall(csp_line))
    fresh_set = {f"'sha256-{d}'" for d in fresh}

    missing = fresh_set - current
    stale = current - fresh_set

    print(f"pages scanned : {len(glob.glob(os.path.join(HERE, '*.html')))}")
    print(f"hashes needed: {len(fresh_set)}")
    print(f"in _headers  : {len(current)}")
    if missing:
        print("MISSING (prod-blocked scripts!):")
        for h in sorted(missing):
            d = h[len("'sha256-"):-1]
            page, length = fresh[d]
            print(f"  {h}  ({page}, {length} chars)")
    if stale:
        print(f"STALE (unused, safe to drop): {len(stale)}")
    if not missing and not stale:
        print("CSP hash list is in sync.")
        return 0

    if check_only:
        return 1 if missing else 0

    # rebuild the script-src segment, preserving everything before/after it
    before, after = csp_line.split("script-src ", 1)
    # after = "'self' 'sha256-...' ... ; style-src ..." — keep directives after the first ';'
    directives = after.split(';', 1)
    rest = (';' + directives[1]) if len(directives) > 1 else ''
    new_segment = "'self' " + ' '.join(sorted(fresh_set))
    new_line = before + 'script-src ' + new_segment + rest + ''
    lines[csp_idx] = new_line

    # sanity: every hash quoted, valid b64 length, line length guard (<2000 documented)
    found = HASH_IN_LINE_RE.findall(new_line)
    assert all(len(h.rstrip("'")) == 52 for h in found), f"bad hash length: {[len(h) for h in found]}"
    assert new_line.count("'sha256-") == len(fresh_set), "hash count mismatch"
    print(f"\nrewrote _headers line {csp_idx + 1}: {len(fresh_set)} hashes, {len(new_line)} chars")
    if len(new_line) > 1900:
        print("WARNING: approaching the 2000-char header limit — externalize more inline scripts.")
    open(HEADERS, 'w', encoding='utf-8', newline='\n').write('\n'.join(lines) + '\n')
    print("_headers updated. Deploy reminder: bump ?v= in pages + sw.js cache name, then wrangler deploy.")
    return 0


if __name__ == '__main__':
    sys.exit(main())

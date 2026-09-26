#!/usr/bin/env bash
# Downloads the shared libraries headless Chrome needs into /tmp/libs/all.
# The sandbox image ships without them, so UI tests need this first.
set -euo pipefail
DIR=/tmp/libs
mkdir -p "$DIR/all"
python3 - <<'PY'
import urllib.request, lzma, re, io, tarfile, os
def http(url): return urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent":"curl/8"}), timeout=180).read()
want = {"libxcomposite1","libxdamage1","libxfixes3","libxrandr2","libasound2","libatk1.0-0",
        "libatk-bridge2.0-0","libatspi2.0-0","libdbus-1-3","libgbm1","libnspr4","libnss3",
        "libxkbcommon0","libxi6","libxrender1","libdrm2","libwayland-server0","libcairo2",
        "libpango-1.0-0","libpangocairo-1.0-0"}
raw = lzma.decompress(http("http://deb.debian.org/debian/dists/bookworm/main/binary-amd64/Packages.xz")).decode("utf8","ignore")
found = {}
for block in raw.split("\n\n"):
    m = re.search(r'^Package: (.+)$', block, re.M)
    if not m or m.group(1).strip() not in want: continue
    fn = re.search(r'^Filename: (.+)$', block, re.M)
    if fn: found[m.group(1).strip()] = fn.group(1).strip()
os.makedirs("/tmp/libs/ext", exist_ok=True)
for pkg, path in found.items():
    try: data = http("http://deb.debian.org/debian/" + path)
    except Exception: continue
    pos = 8
    while pos + 60 <= len(data):
        hdr = data[pos:pos+60]; nm = hdr[0:16].decode('latin1').strip()
        size = int(hdr[48:58].decode('latin1').strip() or 0); body = data[pos+60:pos+60+size]
        if nm.startswith('data.tar'):
            mode = 'r:xz' if body[:6]==b'\xfd7zXZ\x00' else 'r:gz' if body[:2]==b'\x1f\x8b' else 'r:'
            tarfile.open(fileobj=io.BytesIO(body), mode=mode).extractall('/tmp/libs/ext'); break
        pos += 60 + size + (size % 2)
print("packages fetched:", len(found))
PY
find "$DIR/ext" -name "*.so*" -type f -exec cp -n {} "$DIR/all/" \; 2>/dev/null || true
find "$DIR/ext" -name "*.so*" -type l -exec cp -nP {} "$DIR/all/" \; 2>/dev/null || true
echo "libs available: $(ls "$DIR/all" | wc -l)"

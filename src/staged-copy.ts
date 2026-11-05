// Isolated Python standard library only; the Graphify interpreter already supplies it.
// Read raw Git blobs rather than checkout filters, archives' export-ignore, or working files.
export const STAGED_COPY = String.raw`
import json, os, pathlib, subprocess, sys, uuid
data = json.load(sys.stdin)
root = pathlib.Path(data['root']).resolve()
root.mkdir(parents=True, exist_ok=True)
state_path = pathlib.Path(data['state'])
try:
    old = json.loads(state_path.read_text(encoding='utf-8'))
except (FileNotFoundError, ValueError):
    old = {}
files = data['files']
def target(name):
    parts = pathlib.PurePosixPath(name).parts
    if not parts or pathlib.PurePosixPath(name).is_absolute() or '..' in parts:
        raise RuntimeError('Invalid staged path: ' + name)
    result = root.joinpath(*parts)
    if not result.resolve().is_relative_to(root):
        raise RuntimeError('Staged path escapes private snapshot: ' + name)
    parent = result.parent
    while parent != root:
        if parent.is_symlink():
            raise RuntimeError('Symlink in private snapshot: ' + name)
        parent = parent.parent
    return result
removed = 0
for name in old.keys() - files.keys():
    location = target(name)
    if location.is_file() or location.is_symlink():
        location.unlink()
        removed += 1
    parent = location.parent
    while parent != root:
        try:
            parent.rmdir()
        except OSError:
            break
        parent = parent.parent
pending = []
result = {}
for name, sha in files.items():
    location = target(name)
    previous = old.get(name, {})
    stat = location.stat() if location.is_file() and not location.is_symlink() else None
    if stat and previous.get('sha') == sha and previous.get('size') == stat.st_size and previous.get('mtime') == stat.st_mtime_ns:
        result[name] = previous
    else:
        pending.append((name, sha, location))
if pending:
    child = subprocess.Popen(['git', '-C', data['repo'], 'cat-file', '--batch'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        for name, sha, location in pending:
            child.stdin.write((sha + '\n').encode('ascii'))
            child.stdin.flush()
            header = child.stdout.readline().decode('ascii').strip().split()
            if len(header) != 3 or header[0] != sha or header[1] != 'blob':
                raise RuntimeError('Invalid staged blob response')
            remaining = int(header[2])
            location.parent.mkdir(parents=True, exist_ok=True)
            if location.is_dir():
                location.rmdir()
            temporary = location.with_name(location.name + '.' + uuid.uuid4().hex + '.tmp')
            with temporary.open('xb') as output:
                while remaining:
                    chunk = child.stdout.read(min(remaining, 1024 * 1024))
                    if not chunk:
                        raise RuntimeError('Incomplete staged blob')
                    output.write(chunk)
                    remaining -= len(chunk)
            if child.stdout.read(1) != b'\n':
                raise RuntimeError('Invalid staged blob boundary')
            os.replace(temporary, location)
            stat = location.stat()
            result[name] = {'sha': sha, 'size': stat.st_size, 'mtime': stat.st_mtime_ns}
        child.stdin.close()
        if child.wait() != 0:
            raise RuntimeError('Git blob reader failed')
    finally:
        if child.poll() is None:
            child.kill()
            child.wait()
state_path.parent.mkdir(parents=True, exist_ok=True)
temporary = state_path.with_name(state_path.name + '.' + uuid.uuid4().hex + '.tmp')
temporary.write_text(json.dumps(result), encoding='utf-8')
os.replace(temporary, state_path)
print(json.dumps({'files': len(result), 'written': len(pending), 'removed': removed}))
`;

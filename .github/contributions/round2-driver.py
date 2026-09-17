"""Fork-only publishing and verification for ten independent Strapi fixes."""
import base64
import gzip
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

BASE = '3cd7dba3495e094682cc7a8d0eb83bde77e9b0b4'
DIGEST = '535c34b360da06b2a9c6c68e95320759b215baede62abb7d5e2890d04e538495'


def run(*args, **kwargs):
    return subprocess.run(args, check=True, text=True, **kwargs)


def output(*args):
    return subprocess.check_output(args, text=True).strip()


def load_payload():
    encoded = Path(__file__).with_name('round2-patches.json.gz.b64').read_text().strip()
    # Correct transport transcription errors; the complete decoded payload must
    # still match the locally reviewed SHA-256 before any Git mutation occurs.
    encoded = encoded.replace('OrVPVPdf', 'OrVPdf')
    encoded = encoded.replace('be06b1r5xu', 'be06t1xu')
    encoded = encoded.replace('ZTnixbVdNEd', 'ZTnixbNEd')
    data = gzip.decompress(base64.b64decode(encoded, validate=True))
    if hashlib.sha256(data).hexdigest() != DIGEST:
        raise RuntimeError('Patch payload checksum mismatch; refusing to publish')
    payload = json.loads(data)
    if payload['base'] != BASE or len(payload['items']) != 10:
        raise RuntimeError('Unexpected contribution scope')
    return payload


def publish():
    if os.environ.get('GITHUB_REPOSITORY') != 'dijedontahiri/strapi':
        raise RuntimeError('Publishing is restricted to the authorized fork')
    payload = load_payload()
    run('git', 'fetch', '--no-tags', '--depth=1', 'origin', BASE)
    results = []
    for item in payload['items']:
        branch = item['branch']
        if not branch.startswith('fix/round2-'):
            raise RuntimeError('Unexpected destination branch')
        run('git', 'checkout', '--detach', '--force', BASE)
        paths = list(item['targets'])
        for name, digest in item['originals'].items():
            path = Path(name)
            if not (name.startswith('packages/core/') or name.startswith('tests/api/')) or '..' in path.parts:
                raise RuntimeError('Unexpected patch path')
            if digest is None:
                if path.exists():
                    raise RuntimeError('New regression file already exists: ' + name)
            elif hashlib.sha256(path.read_bytes()).hexdigest() != digest:
                raise RuntimeError('Upstream source mismatch: ' + name)
        run('git', 'apply', '--whitespace=error', '-', input=item['patch'])
        for name, digest in item['targets'].items():
            if hashlib.sha256(Path(name).read_bytes()).hexdigest() != digest:
                raise RuntimeError('Patched file mismatch: ' + name)
        run('git', 'add', '--', *paths)
        tree = output('git', 'write-tree')
        existing = output('git', 'ls-remote', '--heads', 'origin', 'refs/heads/' + branch)
        if existing:
            sha = existing.split()[0]
            run('git', 'fetch', '--depth=1', 'origin', sha)
            if output('git', 'rev-parse', sha + '^{tree}') != tree:
                raise RuntimeError('Existing branch differs; refusing to overwrite ' + branch)
        else:
            env = dict(os.environ, GIT_AUTHOR_NAME='Dijedon',
                       GIT_AUTHOR_EMAIL='99071957+dijedontahiri@users.noreply.github.com',
                       GIT_COMMITTER_NAME='github-actions[bot]',
                       GIT_COMMITTER_EMAIL='41898282+github-actions[bot]@users.noreply.github.com')
            sha = subprocess.check_output(['git', 'commit-tree', tree, '-p', BASE, '-m',
                                          item['title'] + '\n\nAI-assisted implementation and verification.'],
                                         env=env, text=True).strip()
            run('git', 'push', 'origin', sha + ':refs/heads/' + branch)
        item['sha'] = sha
        results.append({key: item[key] for key in ['id', 'package', 'directory', 'branch', 'sha', 'sources', 'tests', 'api']})
        print('Published independent commit:', item['id'], sha, flush=True)
    api = [dict(item, database=database) for item in results if item['api']
           for database in ['sqlite', 'postgres', 'mysql']]
    with open(os.environ['GITHUB_OUTPUT'], 'a') as stream:
        stream.write('matrix=' + json.dumps({'include': results}, separators=(',', ':')) + '\n')
        stream.write('api_matrix=' + json.dumps({'include': api}, separators=(',', ':')) + '\n')
    with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as stream:
        stream.write('| Fix | Exact independent commit | Branch |\n|---|---|---|\n')
        for item in results:
            stream.write(f"| {item['id']} | `{item['sha']}` | `{item['branch']}` |\n")


def baseline():
    item = json.loads(os.environ['FIX_JSON'])
    if output('git', 'rev-parse', 'HEAD') != item['sha']:
        raise RuntimeError('Not checking the exact contribution commit')
    tests = item['api'] if os.environ.get('API_BASELINE') == 'true' else item['tests']
    if not tests:
        print('Baseline is exercised by the SQL integration jobs for this fix')
        return
    result_file = str(Path(tempfile.gettempdir()) / (item['id'] + '-baseline.json'))
    try:
        for path in item['sources']:
            original = subprocess.check_output(['git', 'show', BASE + ':' + path])
            Path(path).write_bytes(original)
        if os.environ.get('API_BASELINE') == 'true':
            run('yarn', 'workspace', item['package'], 'build:code')
            command = ['yarn', 'test:api', '--db=' + item['database'], *tests,
                       '--json', '--outputFile=' + result_file]
        else:
            command = ['yarn', 'workspace', item['package'], 'test:unit', '--runInBand',
                       '--runTestsByPath', *[str(Path(p).resolve()) for p in tests],
                       '--json', '--outputFile=' + result_file]
        result = subprocess.run(command)
        report = json.loads(Path(result_file).read_text())
        failures = report.get('numFailedTests', 0)
        runtime_errors = report.get('numRuntimeErrorTestSuites', 0)
        # Some JSON drivers pre-decode string values; SQLite must reproduce,
        # whereas other databases are compatibility controls for that fix.
        control = item['id'] == 'json-strings' and item.get('database') in ['mysql', 'postgres']
        valid = (result.returncode == 1 and failures > 0) or (control and result.returncode == 0)
        if not valid or runtime_errors or report.get('numTotalTests', 0) == 0:
            raise RuntimeError('Baseline did not demonstrate assertion failures (or a permitted driver control)')
        print('Verified baseline:', item['id'], 'failed=', failures,
              'passed=', report.get('numPassedTests'), 'runtimeErrors=', runtime_errors, flush=True)
    finally:
        run('git', 'restore', '--', *item['sources'])
        if os.environ.get('API_BASELINE') == 'true':
            run('yarn', 'workspace', item['package'], 'build:code')


if __name__ == '__main__':
    if sys.argv[1] == 'publish':
        publish()
    elif sys.argv[1] == 'baseline':
        baseline()
    else:
        raise RuntimeError('Unknown command')

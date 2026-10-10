/**
 * Test helpers shared by the benchmark's tests. This file is not a test.
 *
 * `writeFakeHost` writes an executable that stands in for a coding-agent CLI.
 * It behaves like the sigil-compute-design orchestrator: it runs the pinned
 * `sigilc` from PATH inside its pass directory, reads every unread source
 * with `(reading ...)` rows (or the planted contradiction), ingests them,
 * writes the readings back into the copied root, checks, and hands back a state.
 */

export interface FakeHostOptions {
  /** Which host's output shape to imitate. */
  readonly host?: "claude" | "codex";
  /** Read Booking's two range-change Facets as a contradiction. */
  readonly planted?: boolean;
  /** A source the fake never reads, so it stays unread. */
  readonly skipSource?: string;
  /** The state to hand back instead of the check's real one. */
  readonly handback?: string;
  /** Omit the `Hand-back state:` line entirely. */
  readonly noHandback?: boolean;
  /** Models and efforts the fake's children report. Codex only for efforts. */
  readonly childModel?: string;
  readonly childEffort?: string;
  /** Exit non-zero after writing the readings. */
  readonly exitCode?: number;
  /** A file the fake writes into, outside its pass directory. */
  readonly tamperPath?: string;
  /** Sleep this long before doing anything, to exercise timeouts. */
  readonly sleepSeconds?: number;
  /** Read only this many sources, so the rest stay unread. */
  readonly stopAfterSources?: number;
  /** Sleep this long after the readings are stored and before handing back. */
  readonly sleepAfterSeconds?: number;
}

const SCRIPT = String.raw`#!/usr/bin/env python3
import json, os, shutil, subprocess, sys, time

OPTIONS = json.loads(__OPTIONS__)

if sys.argv[1:2] == ['--version']:
    print('fake-host 1.0')
    sys.exit(0)

argv = sys.argv[1:]
with open(os.path.join(os.getcwd(), 'run', 'argv.json'), 'w') as f:
    json.dump({'argv': argv, 'cwd': os.getcwd(), 'codexHome': os.environ.get('CODEX_HOME'),
               'sigilc': shutil.which('sigilc')}, f)

if OPTIONS.get('sleepSeconds'):
    time.sleep(OPTIONS['sleepSeconds'])

def claims(*args):
    return subprocess.run(['sigilc', *args], capture_output=True, text=True)

store_entries = os.listdir('store')
with open('run/start-state.json', 'w') as f:
    json.dump({
        'storeEntries': store_entries,
        'rootConfig': os.path.exists('root/.sigil/config.json'),
        'rootClaims': os.path.exists('root/.sigil/claims'),
        'skills': sorted(os.listdir('skills')),
        'computeSkill': os.path.exists('skills/sigil-compute-design/SKILL.md'),
    }, f)

first = claims('check', '--root', 'root', '--store', 'store')
report = json.load(open(json.loads(first.stdout)['report']))
sources = sorted({unit['source'] for unit in report['unread']})
planted = OPTIONS.get('planted', False)
read_count = 0
for source in sources:
    if source == OPTIONS.get('skipSource'):
        continue
    if OPTIONS.get('stopAfterSources') is not None and read_count >= OPTIONS['stopAfterSources']:
        break
    read_count += 1
    prep = 'run/prep-' + source
    prepared = claims('prepare', '--source', source, '--out', prep, '--root', 'root', '--store', 'store')
    if prepared.returncode != 0:
        sys.stderr.write(prepared.stderr)
        sys.exit(3)
    request = json.load(open(prep + '/request.json'))
    rows = []
    for row in request['rows']:
        if row.get('context'):
            continue
        facet = json.dumps(row['facet'])
        if planted and row['section'] == 'interface' and 'Booking provides a renter a *range change*' in row['prose']:
            rows.append('(claim ' + facet + ' "Booking" "provides" "range change" "required" "true")')
        elif planted and row['section'] == 'constraints' and 'Booking must not provide a range change' in row['prose']:
            rows.append('(claim ' + facet + ' "Booking" "provides" "range change" "required" "false")')
        else:
            rows.append('(reading ' + facet + ' "no-commitment")')
    answer = 'run/' + source + '.rows'
    with open(answer, 'w') as f:
        f.write('\n'.join(rows) + '\n')
    ingested = claims('ingest', '--binding', prep + '/binding.json', '--claims', answer, '--root', 'root', '--store', 'store')
    if ingested.returncode not in (0, 1):
        sys.stderr.write(ingested.stderr)
        sys.exit(3)

# The skill's write-back: readings land in the copied root, never the fixture.
os.makedirs('root/.sigil/claims/interpretations', exist_ok=True)
for name in os.listdir('store/claims/interpretations'):
    shutil.copy(os.path.join('store/claims/interpretations', name),
                os.path.join('root/.sigil/claims/interpretations', name))

if OPTIONS.get('tamperPath'):
    with open(OPTIONS['tamperPath'], 'w') as f:
        f.write('tampered')

if OPTIONS.get('sleepAfterSeconds'):
    time.sleep(OPTIONS['sleepAfterSeconds'])

final = claims('check', '--root', 'root', '--store', 'store')
state = json.loads(final.stdout)['state']
handback = OPTIONS.get('handback') or state

lines = []
text = 'Final check: ' + state + '.'
if not OPTIONS.get('noHandback'):
    text += '\nHand-back state: ' + handback
child_model = OPTIONS.get('childModel', 'served-fake-model')
if OPTIONS.get('host') == 'codex':
    home = os.environ['CODEX_HOME']
    sessions = os.path.join(home, 'sessions', '2026', '10', '08')
    os.makedirs(sessions, exist_ok=True)
    def rollout(name, child, model, effort, calls):
        with open(os.path.join(sessions, 'rollout-' + name + '.jsonl'), 'w') as f:
            meta = {'type': 'session_meta', 'payload': {'source': {'subagent': {}} if child else 'exec'}}
            f.write(json.dumps(meta) + '\n')
            f.write(json.dumps({'type': 'turn_context', 'payload': {'model': model, 'effort': effort}}) + '\n')
            for call in calls:
                f.write(json.dumps({'type': 'response_item', 'payload': {'type': 'function_call', 'name': call[0], 'arguments': json.dumps(call[1])}}) + '\n')
    rollout('parent', False, 'served-fake-model', OPTIONS.get('parentEffort', 'medium'),
            [('spawn_agent', {'fork_turns': 'none'})])
    if 'childEffort' in OPTIONS or child_model:
        rollout('child', True, child_model, OPTIONS.get('childEffort', 'medium'), [])
    for i, arg in enumerate(argv):
        if arg == '--output-last-message':
            with open(argv[i + 1], 'w') as f:
                f.write(text)
else:
    print(json.dumps({'type': 'system', 'subtype': 'init', 'agents': ['interpreter']}))
    print(json.dumps({'type': 'assistant', 'message': {'model': 'served-fake-model'}}))
    print(json.dumps({'type': 'assistant', 'parent_tool_use_id': 'toolu_1', 'message': {'model': child_model}}))
    print(json.dumps({'type': 'result', 'result': text}))
sys.exit(OPTIONS.get('exitCode', 0))
`;

/** Write an executable fake host to `path`. */
export async function writeFakeHost(
  path: string,
  options: FakeHostOptions = {},
): Promise<string> {
  await Deno.writeTextFile(
    path,
    SCRIPT.replace("__OPTIONS__", JSON.stringify(JSON.stringify(options))),
  );
  await Deno.chmod(path, 0o755);
  return path;
}

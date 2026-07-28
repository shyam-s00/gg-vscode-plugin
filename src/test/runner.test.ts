import * as assert from 'assert';

import { consumeHeartbeatLines, GgRunner, HeartbeatPayload, RunExitInfo } from '../run/runner';

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor timed out');
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

suite('consumeHeartbeatLines', () => {
  test('parses complete JSON lines and buffers the trailing incomplete one', () => {
    const { payloads, remainder } = consumeHeartbeatLines(
      '{"time":"t1","event":"started"}\n{"time":"t2","event":"heartbe',
    );
    assert.strictEqual(payloads.length, 1);
    assert.strictEqual(payloads[0].event, 'started');
    assert.strictEqual(remainder, '{"time":"t2","event":"heartbe');
  });

  test('ignores non-JSON lines', () => {
    const { payloads } = consumeHeartbeatLines('not json at all\n{"time":"t","event":"finished"}\n');
    assert.strictEqual(payloads.length, 1);
    assert.strictEqual(payloads[0].event, 'finished');
  });

  test('ignores JSON lines without a string event field', () => {
    const { payloads } = consumeHeartbeatLines('{"time":"t"}\n{"event":123}\n[1,2,3]\n');
    assert.strictEqual(payloads.length, 0);
  });

  test('handles an empty buffer', () => {
    const { payloads, remainder } = consumeHeartbeatLines('');
    assert.deepStrictEqual(payloads, []);
    assert.strictEqual(remainder, '');
  });

  test('reassembles a payload split across two chunks', () => {
    const first = consumeHeartbeatLines('{"time":"t1","event":"sta');
    assert.strictEqual(first.payloads.length, 0);

    const second = consumeHeartbeatLines(`${first.remainder}rted"}\n`);
    assert.strictEqual(second.payloads.length, 1);
    assert.strictEqual(second.payloads[0].event, 'started');
  });
});

suite('GgRunner', () => {
  test('isRunning is false before the first start()', () => {
    const runner = new GgRunner();
    assert.strictEqual(runner.isRunning, false);
  });

  test('stop() is a safe no-op when nothing is running', () => {
    const runner = new GgRunner();
    assert.doesNotThrow(() => runner.stop());
  });

  test('streams parsed heartbeat payloads from a spawned process, ignoring non-JSON lines', async function () {
    this.timeout(5000);
    const runner = new GgRunner();
    const script = [
      'console.log(JSON.stringify({ time: "t1", event: "started", profile: "smoke" }));',
      'console.log("not json, should be ignored");',
      'console.log(JSON.stringify({ time: "t2", event: "heartbeat", actual_rps: 9.5 }));',
      'console.log(JSON.stringify({ time: "t3", event: "finished" }));',
    ].join('\n');

    const received: HeartbeatPayload[] = [];
    runner.onHeartbeat((p) => received.push(p));

    const exitInfo = await new Promise<RunExitInfo>((resolve) => {
      runner.onExit(resolve);
      runner.start(process.execPath, ['-e', script]);
    });

    assert.strictEqual(exitInfo.code, 0);
    assert.strictEqual(received.length, 3);
    assert.strictEqual(received[0].event, 'started');
    assert.strictEqual(received[0].profile, 'smoke');
    assert.strictEqual(received[1].event, 'heartbeat');
    assert.strictEqual(received[1].actual_rps, 9.5);
    assert.strictEqual(received[2].event, 'finished');
    assert.strictEqual(runner.isRunning, false);
  });

  test('isRunning is true while a process is active', async function () {
    this.timeout(5000);
    const runner = new GgRunner();
    const exitPromise = new Promise<void>((resolve) => runner.onExit(() => resolve()));

    runner.start(process.execPath, ['-e', 'console.log("hi")']);
    assert.strictEqual(runner.isRunning, true);

    await exitPromise;
    assert.strictEqual(runner.isRunning, false);
  });

  test('stop() terminates a running process and reports a non-clean exit', async function () {
    this.timeout(5000);
    const runner = new GgRunner();
    const exitPromise = new Promise<RunExitInfo>((resolve) => runner.onExit(resolve));

    runner.start(process.execPath, ['-e', 'setInterval(() => {}, 1000);']);
    await waitFor(() => runner.isRunning);

    runner.stop();
    const info = await exitPromise;

    // A process kept alive by setInterval only ever exits because we killed it.
    assert.ok(info.code !== 0 || info.signal !== null);
  });

  test('starting a new run kills the previous process', async function () {
    this.timeout(8000);
    const runner = new GgRunner();
    const exits: RunExitInfo[] = [];
    runner.onExit((info) => exits.push(info));

    runner.start(process.execPath, ['-e', 'setInterval(() => {}, 1000);']);
    await waitFor(() => runner.isRunning);

    runner.start(process.execPath, ['-e', 'console.log(JSON.stringify({ time: "t", event: "finished" }));']);
    await waitFor(() => exits.length >= 2, 8000);

    // First process never exits on its own — reaching 2 exits at all proves it was killed.
    assert.strictEqual(exits.length, 2);
    assert.strictEqual(exits[1].code, 0);
  });

  test('emits a spawnError when the binary cannot be found', async function () {
    this.timeout(5000);
    const runner = new GgRunner();
    const error = await new Promise<Error>((resolve) => {
      runner.onSpawnError(resolve);
      runner.start('/definitely/not/a/real/gg-binary-xyz', []);
    });
    assert.ok(error.message.length > 0);
    assert.strictEqual(runner.isRunning, false);
  });

  test('captures a stderr tail and includes it in the exit info', async function () {
    this.timeout(5000);
    const runner = new GgRunner();
    const script = 'console.error("boom: something broke"); process.exit(1);';

    const exitInfo = await new Promise<RunExitInfo>((resolve) => {
      runner.onExit(resolve);
      runner.start(process.execPath, ['-e', script]);
    });

    assert.strictEqual(exitInfo.code, 1);
    assert.ok(exitInfo.stderrTail.some((line) => line.includes('boom: something broke')));
  });

  test('unsubscribe functions stop further delivery', async function () {
    this.timeout(5000);
    const runner = new GgRunner();
    let count = 0;
    const unsubscribe = runner.onHeartbeat(() => { count++; });
    unsubscribe();

    await new Promise<void>((resolve) => {
      runner.onExit(() => resolve());
      runner.start(process.execPath, ['-e', 'console.log(JSON.stringify({ time: "t", event: "started" }));']);
    });

    assert.strictEqual(count, 0);
  });
});

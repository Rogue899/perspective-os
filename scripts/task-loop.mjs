import { spawnSync } from 'child_process';

function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[index + 1];
      if (!next || next.startsWith('--')) args[key] = true;
      else {
        args[key] = next;
        index += 1;
      }
    } else {
      args._.push(token);
    }
  }
  return args;
}

function run(command, { silent = false } = {}) {
  const result = spawnSync(command, {
    shell: true,
    encoding: 'utf8',
    stdio: silent ? 'pipe' : 'inherit',
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function claimNext(agent) {
  const result = run(`node scripts/task-queue.mjs next --agent ${agent}`, { silent: true });
  const text = `${result.stdout}\n${result.stderr}`.trim();
  if (text.includes('No unblocked todo tasks available')) return null;
  if (result.code !== 0) {
    throw new Error(`Failed to claim task: ${text || 'unknown error'}`);
  }
  const start = text.indexOf('{');
  if (start < 0) {
    throw new Error(`Unexpected claim output: ${text}`);
  }
  return JSON.parse(text.slice(start));
}

function quote(text) {
  return `"${String(text).replace(/"/g, '\\"')}"`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const agent = String(args.agent || 'copilot').toLowerCase();
  const max = Number(args.max || 10);
  const work = args.work || '';
  const test = args.test || 'npm run typecheck; npm run build';
  const dryRun = Boolean(args['dry-run']);
  const waitMs = Number(args['wait-ms'] || 30000);
  const seedOnEmpty = Boolean(args['seed-on-empty']);
  const maxIdle = Number(args['max-idle'] || 20);
  let idleCount = 0;

  console.log(`[loop] agent=${agent} max=${max} dryRun=${dryRun} waitMs=${waitMs} seedOnEmpty=${seedOnEmpty}`);

  for (let round = 1; round <= max; round += 1) {
    run('node scripts/task-queue.mjs sync', { silent: true });
    const task = claimNext(agent);
    if (!task) {
      idleCount += 1;
      console.log(`[loop] no unblocked tasks (idle ${idleCount}/${maxIdle}).`);

      if (seedOnEmpty) {
        run(`node scripts/task-queue.mjs seed-expansion --agent ${agent}`, { silent: true });
        run(`node scripts/task-queue.mjs message --from ${agent} --to claude --subject auto-seed --body ${quote('Queue empty, seeded expansion tasks. Please pick next from same queue.')}`, { silent: true });
      }

      if (idleCount >= maxIdle) {
        console.log('[loop] reached max idle cycles; exiting.');
        run('node scripts/task-queue.mjs sync', { silent: true });
        return;
      }

      run(`node scripts/task-queue.mjs message --from ${agent} --to claude --subject idle-wait --body ${quote(`No tasks available, waiting ${waitMs}ms for new queue updates.`)}`, { silent: true });
      run(`node -e "setTimeout(()=>{}, ${waitMs})"`, { silent: true });
      round -= 1;
      continue;
    }

    idleCount = 0;

    console.log(`\n[loop] round ${round}: claimed ${task.id} (${task.title})`);

    const startNote = `loop start round=${round}`;
    run(`node scripts/task-queue.mjs note --id ${task.id} --agent ${agent} --note ${quote(startNote)}`, { silent: true });

    if (dryRun) {
      run(`node scripts/task-queue.mjs note --id ${task.id} --agent ${agent} --note ${quote('dry-run: releasing task without work')}`, { silent: true });
      run(`node scripts/task-queue.mjs release --id ${task.id} --agent ${agent} --note ${quote('dry-run release')}`, { silent: true });
      console.log(`[loop] dry-run released ${task.id}`);
      break;
    }

    if (work) {
      console.log(`[loop] work: ${work}`);
      const workRes = run(work);
      if (workRes.code !== 0) {
        run(`node scripts/task-queue.mjs block --id ${task.id} --agent ${agent} --note ${quote(`work failed exit=${workRes.code}`)}`, { silent: true });
        console.log(`[loop] blocked ${task.id} because work command failed.`);
        continue;
      }
    }

    if (test) {
      console.log(`[loop] test: ${test}`);
      const testRes = run(test);
      if (testRes.code !== 0) {
        run(`node scripts/task-queue.mjs block --id ${task.id} --agent ${agent} --note ${quote(`tests failed exit=${testRes.code}`)}`, { silent: true });
        console.log(`[loop] blocked ${task.id} because test command failed.`);
        continue;
      }
    }

    run(`node scripts/task-queue.mjs done --id ${task.id} --agent ${agent} --note ${quote('loop completed with passing tests')}`, { silent: true });
    console.log(`[loop] completed ${task.id}`);
  }

  run('node scripts/task-queue.mjs sync', { silent: true });
}

main();

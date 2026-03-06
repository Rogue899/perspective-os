import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const SYNC_DIR = path.join(ROOT, '.agent-sync');
const QUEUE_FILE = path.join(SYNC_DIR, 'QUEUE.json');
const BOARD_FILE = path.join(SYNC_DIR, 'TASK_BOARD.md');
const AGENTS_FILE = path.join(SYNC_DIR, 'AGENTS.json');

function nowIso() {
  return new Date().toISOString();
}

function ensureFiles() {
  if (!fs.existsSync(SYNC_DIR)) {
    fs.mkdirSync(SYNC_DIR, { recursive: true });
  }
  if (!fs.existsSync(QUEUE_FILE)) {
    const seed = { version: 1, updatedAt: nowIso(), tasks: [] };
    fs.writeFileSync(QUEUE_FILE, JSON.stringify(seed, null, 2), 'utf8');
  }
  if (!fs.existsSync(AGENTS_FILE)) {
    const seed = { version: 1, updatedAt: nowIso(), agents: {} };
    fs.writeFileSync(AGENTS_FILE, JSON.stringify(seed, null, 2), 'utf8');
  }
}

function readQueue() {
  ensureFiles();
  const data = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
  if (!Array.isArray(data.tasks)) data.tasks = [];
  if (!Array.isArray(data.messages)) data.messages = [];
  return data;
}

function findTask(queue, id) {
  return (queue.tasks || []).find(task => task.id === id);
}

function writeQueue(queue) {
  queue.updatedAt = nowIso();
  fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2), 'utf8');
}

function readAgents() {
  ensureFiles();
  const data = JSON.parse(fs.readFileSync(AGENTS_FILE, 'utf8'));
  if (!data.agents || typeof data.agents !== 'object') data.agents = {};
  return data;
}

function writeAgents(data) {
  data.updatedAt = nowIso();
  fs.writeFileSync(AGENTS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function setAgentWorking(agent, payload = {}) {
  const id = String(agent || 'unknown').toLowerCase();
  const agents = readAgents();
  agents.agents[id] = {
    ...(agents.agents[id] || {}),
    agent: id,
    state: payload.state || 'working',
    taskId: payload.taskId ?? agents.agents[id]?.taskId ?? null,
    note: payload.note ?? agents.agents[id]?.note ?? '',
    files: Array.isArray(payload.files) ? payload.files : (agents.agents[id]?.files || []),
    session: payload.session || agents.agents[id]?.session || null,
    updatedAt: nowIso(),
  };
  writeAgents(agents);
}

function clearAgentWorking(agent, note = '') {
  const id = String(agent || 'unknown').toLowerCase();
  const agents = readAgents();
  if (!agents.agents[id]) {
    agents.agents[id] = { agent: id };
  }
  agents.agents[id] = {
    ...agents.agents[id],
    state: 'idle',
    taskId: null,
    note,
    files: [],
    updatedAt: nowIso(),
  };
  writeAgents(agents);
}

function getOpenTasks(queue) {
  return (queue.tasks || []).filter(task => ['todo', 'in_progress', 'blocked'].includes(task.status));
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[index + 1];
      if (!next || next.startsWith('--')) out[key] = true;
      else {
        out[key] = next;
        index += 1;
      }
    } else {
      out._.push(token);
    }
  }
  return out;
}

function isUnblocked(task, tasks) {
  const blockers = task.blockedBy || [];
  if (blockers.length === 0) return true;
  const done = new Set(tasks.filter(t => t.status === 'done').map(t => t.id));
  return blockers.every(id => done.has(id));
}

function taskSort(a, b) {
  if ((b.priority || 0) !== (a.priority || 0)) return (b.priority || 0) - (a.priority || 0);
  return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
}

function toLine(task) {
  return `- [${task.status === 'done' ? 'x' : ' '}] ${task.id} | p${task.priority || 0} | ${task.title} | owner: ${task.owner || 'unassigned'}`;
}

function messageLine(message) {
  const status = message.read ? 'read' : 'new';
  return `- ${message.at} | ${message.from} → ${message.to} | ${message.subject || 'no-subject'} | ${status} | ${message.body}`;
}

function renderBoard(queue) {
  const tasks = queue.tasks || [];
  const messages = queue.messages || [];
  const agentData = readAgents();
  const agentEntries = Object.values(agentData.agents || {});
  const todo = tasks.filter(t => t.status === 'todo').sort(taskSort);
  const progress = tasks.filter(t => t.status === 'in_progress').sort(taskSort);
  const blocked = tasks.filter(t => t.status === 'blocked').sort(taskSort);
  const done = tasks.filter(t => t.status === 'done').sort(taskSort);

  const lines = [
    '# Agent Task Board (Local Only)',
    '',
    'Machine-backed queue for Claude + Copilot handoff.',
    'Source of truth: `.agent-sync/QUEUE.json`.',
    '',
    '## Protocol',
    '- Claim next: `npm run tasks:next` (Copilot default) or `npm run tasks:next:claude`',
    '- Complete: `npm run tasks:done -- --id <TASK_ID> --agent <copilot|claude> --note "what was done"`',
    '- Add task: `npm run tasks:add -- --id <TASK_ID> --title "..." --priority 1-5 --agent <copilot|claude>`',
    '- Add note (handoff): `npm run tasks:note -- --id <TASK_ID> --agent <copilot|claude> --note "..."`',
    '- Block task: `npm run tasks:block -- --id <TASK_ID> --agent <copilot|claude> --note "reason"`',
    '- Release blocked: `npm run tasks:release -- --id <TASK_ID> --agent <copilot|claude> --note "..."`',
    '- Agent working heartbeat: `npm run tasks:working -- --agent <copilot|claude> --task <TASK_ID> --note "..." --files "src/a.ts,src/b.ts"`',
    '- Agent status snapshot: `npm run tasks:status`',
    '- Sync board: `npm run tasks:sync`',
    '',
    `Last sync: ${new Date().toISOString()}`,
    '',
    '## Agent Presence',
    ...(agentEntries.length
      ? agentEntries
          .sort((a, b) => String(a.agent || '').localeCompare(String(b.agent || '')))
          .map(entry => `- ${entry.agent || 'unknown'} | ${entry.state || 'unknown'} | task: ${entry.taskId || '-'} | files: ${Array.isArray(entry.files) && entry.files.length ? entry.files.join(', ') : '-'} | note: ${entry.note || '-'} | ${entry.updatedAt || '-'}`)
      : ['- (none)']),
    '',
    '## In Progress',
    ...(progress.length ? progress.map(toLine) : ['- (none)']),
    '',
    '## Todo (Unblocked)',
    ...(todo.filter(t => isUnblocked(t, tasks)).length
      ? todo.filter(t => isUnblocked(t, tasks)).map(toLine)
      : ['- (none)']),
    '',
    '## Blocked',
    ...(blocked.length ? blocked.map(toLine) : ['- (none)']),
    '',
    '## Done',
    ...(done.length ? done.map(toLine) : ['- (none)']),
    '',
    '## Comms',
    ...(messages.slice(-20).length ? messages.slice(-20).map(messageLine) : ['- (none)']),
    ''
  ];

  fs.writeFileSync(BOARD_FILE, lines.join('\n'), 'utf8');
}

function claimNext(queue, agent) {
  const tasks = queue.tasks || [];
  const candidates = tasks
    .filter(t => t.status === 'todo')
    .filter(t => isUnblocked(t, tasks))
    .sort(taskSort);

  const candidate = candidates[0];

  if (!candidate) return null;
  candidate.status = 'in_progress';
  candidate.owner = agent;
  candidate.updatedAt = nowIso();
  candidate.notes = candidate.notes || [];
  candidate.notes.push(`${nowIso()} | ${agent} | claimed`);
  return candidate;
}

function claimPlusOne(queue, agent, leader) {
  const tasks = queue.tasks || [];
  const candidates = tasks
    .filter(t => t.status === 'todo')
    .filter(t => isUnblocked(t, tasks))
    .sort(taskSort);

  if (candidates.length === 0) return null;

  const claimedByLeader = tasks.some(
    t => t.status === 'in_progress' && String(t.owner || '').toLowerCase() === String(leader || '').toLowerCase()
  );

  const index = claimedByLeader ? 0 : (candidates.length > 1 ? 1 : 0);
  const candidate = candidates[index] || candidates[0];

  candidate.status = 'in_progress';
  candidate.owner = agent;
  candidate.updatedAt = nowIso();
  candidate.notes = candidate.notes || [];
  candidate.notes.push(`${nowIso()} | ${agent} | claimed+1 | leader=${leader || 'unknown'}`);
  return candidate;
}

function addMessage(queue, { from, to, subject, body }) {
  queue.messages = queue.messages || [];
  queue.messages.push({
    id: `msg-${Date.now()}`,
    at: nowIso(),
    from: String(from || 'unknown').toLowerCase(),
    to: String(to || 'all').toLowerCase(),
    subject: subject || '',
    body: body || '',
    read: false,
  });
}

function markInboxRead(queue, agent) {
  const target = String(agent || '').toLowerCase();
  (queue.messages || []).forEach(message => {
    if (message.to === target || message.to === 'all') {
      message.read = true;
    }
  });
}

function seedExpansionTasks(queue, agent) {
  const open = getOpenTasks(queue);
  if (open.length > 0) return [];

  const seeds = [
    {
      id: `EXP-${Date.now()}-1`,
      title: 'Implement story history timeline UI',
      description: 'Add HistoryTimeline panel and wire to GDELT timeline endpoint with sparkline rendering.',
      priority: 3,
      status: 'todo',
      owner: null,
      blockedBy: [],
      tags: ['history', 'ui', 'gdelt'],
      acceptance: ['History tab renders', 'Timeline fetch works', 'Typecheck/build pass'],
      createdAt: nowIso(),
      updatedAt: nowIso(),
      notes: [`${nowIso()} | ${agent} | auto-seeded on empty queue`],
    },
    {
      id: `EXP-${Date.now()}-2`,
      title: 'Add GDELT topic tabs in feed',
      description: 'Implement Military/Cyber/Nuclear/Maritime/Sanctions feed tabs with GDELT doc API queries.',
      priority: 3,
      status: 'todo',
      owner: null,
      blockedBy: [],
      tags: ['gdelt', 'feed', 'topics'],
      acceptance: ['Tabs visible', 'Topic queries return items', 'No regressions in default feed'],
      createdAt: nowIso(),
      updatedAt: nowIso(),
      notes: [`${nowIso()} | ${agent} | auto-seeded on empty queue`],
    },
    {
      id: `EXP-${Date.now()}-3`,
      title: 'Add opinion generator panel',
      description: 'Build OpinionPanel with four-lens AI perspective simulation and cache keying.',
      priority: 2,
      status: 'todo',
      owner: null,
      blockedBy: [],
      tags: ['ai', 'opinion', 'ui'],
      acceptance: ['Generate opinions works', 'Lenses labeled clearly as simulation', 'Typecheck/build pass'],
      createdAt: nowIso(),
      updatedAt: nowIso(),
      notes: [`${nowIso()} | ${agent} | auto-seeded on empty queue`],
    },
  ];

  queue.tasks.push(...seeds);
  addMessage(queue, {
    from: agent,
    to: 'claude',
    subject: 'auto-seeded-expansion',
    body: `Queue was empty. Seeded ${seeds.length} expansion tasks; pick next as usual.`,
  });
  return seeds;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || 'list';
  const queue = readQueue();

  if (command === 'list') {
    console.log(JSON.stringify(queue, null, 2));
    return;
  }

  if (command === 'status') {
    const agents = readAgents();
    console.log(JSON.stringify(agents, null, 2));
    return;
  }

  if (command === 'inbox') {
    const agent = String(args.agent || 'copilot').toLowerCase();
    const inbox = (queue.messages || []).filter(message => message.to === agent || message.to === 'all');
    console.log(JSON.stringify(inbox, null, 2));
    if (args.markRead) {
      markInboxRead(queue, agent);
      writeQueue(queue);
      renderBoard(queue);
    }
    return;
  }

  if (command === 'sync') {
    renderBoard(queue);
    console.log('Synced TASK_BOARD.md from QUEUE.json');
    return;
  }

  if (command === 'next') {
    const agent = String(args.agent || 'copilot').toLowerCase();
    const claimed = claimNext(queue, agent);
    if (!claimed) {
      renderBoard(queue);
      console.log('No unblocked todo tasks available.');
      return;
    }
    writeQueue(queue);
    setAgentWorking(agent, { state: 'working', taskId: claimed.id, note: 'claimed via next' });
    renderBoard(queue);
    console.log(JSON.stringify(claimed, null, 2));
    return;
  }

  if (command === 'next-plus-one') {
    const agent = String(args.agent || 'copilot').toLowerCase();
    const leader = String(args.leader || 'claude').toLowerCase();
    const claimed = claimPlusOne(queue, agent, leader);
    if (!claimed) {
      renderBoard(queue);
      console.log('No unblocked todo tasks available.');
      return;
    }
    writeQueue(queue);
    setAgentWorking(agent, { state: 'working', taskId: claimed.id, note: `claimed via next-plus-one (leader=${leader})` });
    renderBoard(queue);
    console.log(JSON.stringify(claimed, null, 2));
    return;
  }

  if (command === 'working') {
    const agent = String(args.agent || 'unknown').toLowerCase();
    const taskId = args.task || null;
    const note = args.note || '';
    const session = args.session || null;
    const files = String(args.files || '')
      .split(',')
      .map(item => item.trim())
      .filter(Boolean);
    setAgentWorking(agent, { state: 'working', taskId, note, files, session });
    renderBoard(queue);
    console.log(`Updated working heartbeat for ${agent}`);
    return;
  }

  if (command === 'clear-working') {
    const agent = String(args.agent || 'unknown').toLowerCase();
    const note = args.note || 'idle';
    clearAgentWorking(agent, note);
    renderBoard(queue);
    console.log(`Cleared working heartbeat for ${agent}`);
    return;
  }

  if (command === 'message') {
    const from = String(args.from || 'copilot').toLowerCase();
    const to = String(args.to || 'claude').toLowerCase();
    const subject = String(args.subject || 'sync');
    const body = String(args.body || '');
    if (!body) {
      console.error('Missing required flag: --body');
      process.exit(1);
    }
    addMessage(queue, { from, to, subject, body });
    writeQueue(queue);
    renderBoard(queue);
    console.log(`Message queued: ${from} -> ${to}`);
    return;
  }

  if (command === 'seed-expansion') {
    const agent = String(args.agent || 'copilot').toLowerCase();
    const seeded = seedExpansionTasks(queue, agent);
    writeQueue(queue);
    renderBoard(queue);
    console.log(`Seeded expansion tasks: ${seeded.length}`);
    return;
  }

  if (command === 'done') {
    const id = args.id;
    const agent = String(args.agent || 'unknown').toLowerCase();
    const note = args.note || 'completed';
    if (!id) {
      console.error('Missing --id');
      process.exit(1);
    }
    const task = findTask(queue, id);
    if (!task) {
      console.error(`Task not found: ${id}`);
      process.exit(1);
    }
    task.status = 'done';
    task.owner = agent;
    task.updatedAt = nowIso();
    task.notes = task.notes || [];
    task.notes.push(`${nowIso()} | ${agent} | done | ${note}`);
    writeQueue(queue);
    clearAgentWorking(agent, `done ${id}`);
    renderBoard(queue);
    console.log(`Marked done: ${id}`);
    return;
  }

  if (command === 'add') {
    const id = args.id;
    const title = args.title;
    const agent = args.agent ? String(args.agent).toLowerCase() : null;
    const priority = Number(args.priority || 3);
    const description = args.description || '';

    if (!id || !title) {
      console.error('Missing required flags: --id and --title');
      process.exit(1);
    }
    if (queue.tasks.some(t => t.id === id)) {
      console.error(`Task already exists: ${id}`);
      process.exit(1);
    }

    queue.tasks.push({
      id,
      title,
      description,
      priority,
      status: 'todo',
      owner: agent,
      blockedBy: [],
      tags: [],
      acceptance: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
      notes: agent ? [`${nowIso()} | ${agent} | added`] : []
    });

    writeQueue(queue);
    renderBoard(queue);
    console.log(`Added task: ${id}`);
    return;
  }

  if (command === 'note') {
    const id = args.id;
    const agent = String(args.agent || 'unknown').toLowerCase();
    const note = args.note || '';
    if (!id || !note) {
      console.error('Missing required flags: --id and --note');
      process.exit(1);
    }
    const task = findTask(queue, id);
    if (!task) {
      console.error(`Task not found: ${id}`);
      process.exit(1);
    }
    task.updatedAt = nowIso();
    task.notes = task.notes || [];
    task.notes.push(`${nowIso()} | ${agent} | note | ${note}`);
    writeQueue(queue);
    setAgentWorking(agent, { state: 'working', taskId: id, note });
    renderBoard(queue);
    console.log(`Added note to ${id}`);
    return;
  }

  if (command === 'block') {
    const id = args.id;
    const agent = String(args.agent || 'unknown').toLowerCase();
    const note = args.note || 'blocked';
    if (!id) {
      console.error('Missing --id');
      process.exit(1);
    }
    const task = findTask(queue, id);
    if (!task) {
      console.error(`Task not found: ${id}`);
      process.exit(1);
    }
    task.status = 'blocked';
    task.owner = agent;
    task.updatedAt = nowIso();
    task.notes = task.notes || [];
    task.notes.push(`${nowIso()} | ${agent} | blocked | ${note}`);
    writeQueue(queue);
    setAgentWorking(agent, { state: 'blocked', taskId: id, note });
    renderBoard(queue);
    console.log(`Marked blocked: ${id}`);
    return;
  }

  if (command === 'release') {
    const id = args.id;
    const agent = String(args.agent || 'unknown').toLowerCase();
    const note = args.note || 'released';
    if (!id) {
      console.error('Missing --id');
      process.exit(1);
    }
    const task = findTask(queue, id);
    if (!task) {
      console.error(`Task not found: ${id}`);
      process.exit(1);
    }
    task.status = 'todo';
    task.owner = null;
    task.updatedAt = nowIso();
    task.notes = task.notes || [];
    task.notes.push(`${nowIso()} | ${agent} | release | ${note}`);
    writeQueue(queue);
    clearAgentWorking(agent, `released ${id}`);
    renderBoard(queue);
    console.log(`Released task to todo: ${id}`);
    return;
  }

  console.error(`Unknown command: ${command}`);
  process.exit(1);
}

main();
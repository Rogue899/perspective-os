#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const TASK_FILE = path.join(ROOT, '.agent-sync', 'tasks.json');

function nowIso() {
  return new Date().toISOString();
}

function readTasks() {
  if (!fs.existsSync(TASK_FILE)) {
    throw new Error(`Task file not found: ${TASK_FILE}`);
  }
  const raw = fs.readFileSync(TASK_FILE, 'utf8');
  const data = JSON.parse(raw);
  if (!Array.isArray(data.tasks)) throw new Error('Invalid task file: tasks must be an array');
  return data;
}

function writeTasks(data) {
  data.updatedAt = nowIso();
  fs.writeFileSync(TASK_FILE, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function getArg(name, fallback = null) {
  const idx = process.argv.findIndex((a) => a === `--${name}`);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] ?? fallback;
}

function listTasks(data, status) {
  const tasks = status ? data.tasks.filter((t) => t.status === status) : data.tasks;
  const sorted = [...tasks].sort((a, b) => (a.priority - b.priority) || a.id.localeCompare(b.id));
  for (const t of sorted) {
    const owner = t.owner ?? '-';
    console.log(`${t.id} | p${t.priority} | ${t.status.padEnd(11)} | ${owner.padEnd(10)} | ${t.title}`);
  }
}

function nextTask(data, agent) {
  const candidates = data.tasks
    .filter((t) => t.status === 'todo')
    .filter((t) => (t.blockedBy ?? []).every((dep) => data.tasks.some((x) => x.id === dep && x.status === 'done')))
    .sort((a, b) => (a.priority - b.priority) || a.id.localeCompare(b.id));

  if (candidates.length === 0) {
    console.log('No available todo tasks (all blocked or complete).');
    return false;
  }

  const task = candidates[0];
  task.status = 'in_progress';
  task.owner = agent;
  task.startedAt = nowIso();
  writeTasks(data);
  console.log(`CLAIMED ${task.id} -> ${task.title}`);
  return true;
}

function doneTask(data, id, note) {
  const task = data.tasks.find((t) => t.id === id);
  if (!task) throw new Error(`Task not found: ${id}`);
  task.status = 'done';
  task.completedAt = nowIso();
  if (note) task.result = note;
  writeTasks(data);
  console.log(`DONE ${task.id}`);
}

function blockTask(data, id, note) {
  const task = data.tasks.find((t) => t.id === id);
  if (!task) throw new Error(`Task not found: ${id}`);
  task.status = 'blocked';
  task.blockedReason = note || 'blocked';
  task.blockedAt = nowIso();
  writeTasks(data);
  console.log(`BLOCKED ${task.id}`);
}

function usage() {
  console.log('Usage:');
  console.log('  node scripts/agent-tasks.mjs list [--status todo|in_progress|done|blocked]');
  console.log('  node scripts/agent-tasks.mjs next --agent copilot|claude');
  console.log('  node scripts/agent-tasks.mjs done --id POS-001 [--note "..."]');
  console.log('  node scripts/agent-tasks.mjs block --id POS-001 [--note "..."]');
}

function main() {
  const cmd = process.argv[2];
  if (!cmd) return usage();
  const data = readTasks();

  if (cmd === 'list') {
    listTasks(data, getArg('status'));
    return;
  }

  if (cmd === 'next') {
    const agent = getArg('agent', 'copilot');
    nextTask(data, agent);
    return;
  }

  if (cmd === 'done') {
    const id = getArg('id');
    if (!id) throw new Error('--id is required for done');
    doneTask(data, id, getArg('note'));
    return;
  }

  if (cmd === 'block') {
    const id = getArg('id');
    if (!id) throw new Error('--id is required for block');
    blockTask(data, id, getArg('note'));
    return;
  }

  usage();
}

try {
  main();
} catch (err) {
  console.error(`[agent-tasks] ${err.message}`);
  process.exitCode = 1;
}

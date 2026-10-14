import type { Board, Step, Task, TaskStatus } from '../types'

// The board's own logic, pure: each function takes the board and answers a new
// one, so the hooks module only decides when to call them.

// The tools that write the plan; they are the board's input, not steps on it.
export const PLAN_TOOLS = new Set(['TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet'])
const AGENT_TOOLS = new Set(['Agent', 'Task'])
const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])
// Steps kept per task; the count of the rest is kept in `dropped`.
const MAX_STEPS = 60
const LABEL_WIDTH = 60

export const EMPTY: Board = { tasks: [], loose: 0 }

type Args = Record<string, unknown>
const str = (v: unknown) => (typeof v === 'string' ? v : '')
const lineCount = (text: string) => (text === '' ? 0 : text.split('\n').length)

export function cut(text: string, width: number) {
  const chars = [...text]
  return chars.length <= width ? text : `${chars.slice(0, width - 1).join('')}…`
}

// A path as the person reads it: under the project, relative to it.
export function shortPath(path: string, root: string) {
  if (root !== '' && path.startsWith(`${root}/`)) return path.slice(root.length + 1)
  return path
}

// One line saying what a call did: the file, the command, the pattern.
export function labelOf(tool: string, args: Args, root: string) {
  const path = str(args.file_path) || str(args.notebook_path) || str(args.path)
  let label: string
  if (path !== '' && tool !== 'Grep' && tool !== 'Glob') label = shortPath(path, root)
  else if (tool === 'Bash' || tool === 'PowerShell') label = str(args.description) || str(args.command).split('\n')[0]!
  else if (tool === 'Grep' || tool === 'Glob') label = str(args.pattern)
  else if (tool === 'WebFetch') label = str(args.url).replace(/^https?:\/\//, '').split('/')[0]!
  else if (tool === 'WebSearch') label = str(args.query)
  else if (AGENT_TOOLS.has(tool)) label = str(args.description) || str(args.subagent_type)
  else label = str(args.description) || str(args.query) || str(args.url) || str(args.command)

  return cut(label.trim(), LABEL_WIDTH)
}

// Lines an edit adds and removes, as near as its arguments say.
export function linesOf(tool: string, args: Args) {
  if (tool === 'Write') return { added: lineCount(str(args.content)), removed: 0 }
  if (tool === 'NotebookEdit') return { added: lineCount(str(args.new_source)), removed: 0 }
  const edits = tool === 'MultiEdit' && Array.isArray(args.edits) ? (args.edits as Args[]) : [args]
  let added = 0
  let removed = 0
  for (const one of edits) {
    added += lineCount(str(one.new_string))
    removed += lineCount(str(one.old_string))
  }

  return { added, removed }
}

export function shortTool(tool: string) {
  return tool.startsWith('mcp__') ? tool.split('__').pop()! : tool
}

// The task a call goes under: the one most recently set in progress.
export function current(board: Board) {
  let found: Task | undefined
  for (const task of board.tasks) {
    if (task.status !== 'in_progress') continue
    if (found === undefined || (task.startedAt ?? 0) >= (found.startedAt ?? 0)) found = task
  }

  return found
}

function moved(task: Task, status: TaskStatus, now: number): Task {
  if (status === task.status) return task
  const next = { ...task, status }
  if (status === 'in_progress') {
    next.startedAt = task.startedAt ?? now
    next.endedAt = undefined
  }
  if (status === 'completed') {
    next.startedAt = task.startedAt ?? now
    next.endedAt = now
  }
  if (status === 'pending') next.endedAt = undefined

  return next
}

function fresh(id: string, subject: string, activeForm: string): Task {
  return { id, subject, activeForm, status: 'pending', steps: [], dropped: 0, files: [], agents: 0 }
}

function started(board: Board, now: number): Board {
  return board.startedAt !== undefined || board.tasks.length === 0 ? board : { ...board, startedAt: now }
}

// TodoWrite: the whole list each time, matched to the board by its text so a
// task keeps its steps. A list sharing no task with the board is a new plan.
export function fromTodos(board: Board, todos: readonly { content: string; status: TaskStatus; activeForm?: string }[], now: number): Board {
  const known = new Map(board.tasks.map(task => [task.id, task]))
  const isNew = todos.every(todo => !known.has(`todo:${todo.content}`))
  const base = isNew ? EMPTY : board
  const tasks = todos.map(todo => {
    const id = `todo:${todo.content}`
    const was = isNew ? undefined : known.get(id)
    const task = was ?? fresh(id, todo.content, todo.activeForm ?? todo.content)

    return moved({ ...task, activeForm: todo.activeForm ?? task.activeForm }, todo.status, now)
  })

  return started({ ...base, tasks, startedAt: isNew ? undefined : base.startedAt }, now)
}

// TaskCreate: one task added, under the id the tool answered.
export function created(board: Board, id: string, subject: string, activeForm: string, now: number): Board {
  if (board.tasks.some(task => task.id === id)) return board

  return started({ ...board, tasks: [...board.tasks, fresh(id, subject, activeForm || subject)] }, now)
}

// TaskUpdate: a status, a new subject, or `deleted`.
export function updated(board: Board, id: string, change: { status?: string; subject?: string; activeForm?: string }, now: number): Board {
  if (change.status === 'deleted') return { ...board, tasks: board.tasks.filter(task => task.id !== id) }
  const tasks = board.tasks.map(task => {
    if (task.id !== id) return task
    let next = { ...task, subject: change.subject || task.subject, activeForm: change.activeForm || task.activeForm }
    if (change.status === 'pending' || change.status === 'in_progress' || change.status === 'completed') {
      next = moved(next, change.status, now)
    }

    return next
  })

  return started({ ...board, tasks }, now)
}

// A call starting: a step on the task in progress, or one more loose call.
export function stepStarted(board: Board, step: Step, args: Args, root: string): Board {
  const task = current(board)
  if (task === undefined) return { ...board, loose: board.loose + 1 }

  return withTask(board, task.id, one => {
    let steps = [...one.steps, step]
    let dropped = one.dropped
    if (steps.length > MAX_STEPS) {
      dropped += steps.length - MAX_STEPS
      steps = steps.slice(-MAX_STEPS)
    }
    let files = one.files
    if (EDIT_TOOLS.has(step.tool)) {
      const path = shortPath(str(args.file_path) || str(args.notebook_path), root)
      const { added, removed } = linesOf(step.tool, args)
      const was = files.find(file => file.path === path)
      files = was
        ? files.map(file => (file.path === path ? { ...file, added: file.added + added, removed: file.removed + removed } : file))
        : [...files, { path, added, removed }]
    }
    const agents = one.agents + (AGENT_TOOLS.has(step.tool) ? 1 : 0)

    return { ...one, steps, dropped, files, agents }
  })
}

// A call ending: its step is marked done, or failed, wherever it sits.
export function stepEnded(board: Board, id: string, now: number, isError: boolean): Board {
  const owner = board.tasks.find(task => task.steps.some(step => step.id === id))
  if (owner === undefined) return board

  return withTask(board, owner.id, task => ({
    ...task,
    steps: task.steps.map(step => (step.id === id ? { ...step, endedAt: now, isError: isError || undefined } : step)),
  }))
}

function withTask(board: Board, id: string, fn: (task: Task) => Task): Board {
  return { ...board, tasks: board.tasks.map(task => (task.id === id ? fn(task) : task)) }
}

// Seconds to `45s`, `4m 05s`, `1h 12m`.
export function duration(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`

  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

export function taskTime(task: Task, now: number) {
  if (task.startedAt === undefined) return ''

  return duration((task.endedAt ?? now) - task.startedAt)
}

export function changeOf(task: Task) {
  const added = task.files.reduce((n, file) => n + file.added, 0)
  const removed = task.files.reduce((n, file) => n + file.removed, 0)

  return { files: task.files.length, added, removed }
}

export function progress(board: Board) {
  const done = board.tasks.filter(task => task.status === 'completed').length

  return { done, total: board.tasks.length }
}

const MARKS: Record<TaskStatus, string> = { completed: '[x]', in_progress: '[~]', pending: '[ ]' }

// The board as Markdown, for an MR description or a note.
export function toMarkdown(board: Board, now: number) {
  const { done, total } = progress(board)
  const took = board.startedAt === undefined ? '' : ` · ${duration(now - board.startedAt)}`
  const out = [`## Plan · ${done}/${total} done${took}`, '']
  for (const task of board.tasks) {
    const time = taskTime(task, now)
    const change = changeOf(task)
    const facts = [
      time,
      change.files > 0 ? `${change.files} file${change.files === 1 ? '' : 's'} +${change.added} −${change.removed}` : '',
      task.agents > 0 ? `${task.agents} agent${task.agents === 1 ? '' : 's'}` : '',
    ].filter(one => one !== '')
    out.push(`- ${MARKS[task.status]} **${task.subject}**${facts.length > 0 ? ` — ${facts.join(', ')}` : ''}`)
    for (const file of task.files) out.push(`  - \`${file.path}\` +${file.added} −${file.removed}`)
    if (task.dropped > 0) out.push(`  - … ${task.dropped} earlier steps`)
    for (const step of task.steps) {
      if (EDIT_TOOLS.has(step.tool)) continue
      out.push(`  - ${shortTool(step.tool)}${step.label === '' ? '' : ` \`${step.label}\``}${step.isError ? ' (failed)' : ''}`)
    }
  }
  if (board.loose > 0) out.push('', `_${board.loose} calls ran outside any task._`)

  return out.join('\n')
}

// The tasks a short board shows: all of them while they fit; past that the
// done ones fold into one line, then the rest in order, as many as fit, and
// a count of those left out.
export function shownTasks(board: Board, limit: number) {
  if (board.tasks.length <= limit) return { tasks: board.tasks, folded: 0, more: 0 }
  const open = board.tasks.filter(task => task.status !== 'completed')
  const folded = board.tasks.length - open.length
  const room = Math.max(1, limit - (folded > 0 ? 1 : 0) - 1)
  const tasks = open.slice(0, room)

  return { tasks, folded, more: open.length - tasks.length }
}

export function isFinished(board: Board) {
  return board.tasks.length > 0 && board.tasks.every(task => task.status === 'completed')
}

// The plugin's own planning tool, for sessions with no TodoWrite or TaskCreate:
// the model sends the whole list each time, as with TodoWrite.
export const PLAN_TOOL = 'plan'
const STATUSES = new Set(['pending', 'in_progress', 'completed'])

export const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    tasks: {
      type: 'array',
      description: 'The whole plan, in order. Send every task each time, not only the ones that changed.',
      items: {
        type: 'object',
        properties: {
          subject: { type: 'string', description: 'The task, in the imperative: "Add the refresh endpoint"' },
          status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
          activeForm: { type: 'string', description: 'The task as it runs: "Adding the refresh endpoint"' },
        },
        required: ['subject', 'status'],
      },
    },
  },
  required: ['tasks'],
} as const

type Todo = { content: string; status: TaskStatus; activeForm?: string }

// The tool's input as TodoWrite's list, or why it cannot be one.
export function todosFromPlan(input: unknown): { todos: Todo[] } | { error: string } {
  const tasks = (input as { tasks?: unknown } | undefined)?.tasks
  if (!Array.isArray(tasks)) return { error: '`tasks` must be a list of { subject, status }.' }
  const todos: Todo[] = []
  for (const [i, one] of tasks.entries()) {
    const task = one as { subject?: unknown; status?: unknown; activeForm?: unknown }
    const subject = typeof task.subject === 'string' ? task.subject.trim() : ''
    if (subject === '') return { error: `Task ${i + 1} has no subject.` }
    if (typeof task.status !== 'string' || !STATUSES.has(task.status)) {
      return { error: `Task ${i + 1} ("${subject}") needs a status of pending, in_progress or completed.` }
    }
    const activeForm = typeof task.activeForm === 'string' && task.activeForm.trim() !== '' ? task.activeForm.trim() : undefined
    todos.push({ content: subject, status: task.status as TaskStatus, activeForm })
  }

  return { todos }
}

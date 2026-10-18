import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Board, Step, Task } from '../types'
import {
  EMPTY, PLAN_SCHEMA, PLAN_TOOL, PLAN_TOOLS, changeOf, created, current, cut, duration, fromTodos, isFinished,
  labelOf, progress, shortTool, shownTasks, stepEnded, stepStarted, taskTime, todosFromPlan, toMarkdown, updated,
} from './board'

const PANE = 'tasks'
const TITLE = 'Tasks'
const COMMAND = 'board'
const OWN_TOOL = 'mcp__clawd-tasks__plan'
// The session's own task tools; with one of them, the plan tool waits behind
// tool search so the model is not offered two ways to keep one plan.
const NATIVE_TASK_TOOLS = ['TodoWrite', 'TaskCreate']
const PLAN_DESCRIPTION = [
  "Keeps the plan of the current work on the person's task board, under the prompt.",
  'Use it for work of three or more steps: send the plan as you start, then again',
  'each time a task starts (status in_progress, one at a time) or is done (completed).',
  'Send the whole list every time, in order, not only the tasks that changed.',
  'If you have TodoWrite or TaskCreate, use those instead: the board reads them too.',
].join(' ')
// How often a running task's clock moves on the board.
const TICK_MS = 1000
const TOOL_WIDTH = 6
// In the pane: steps under the task in progress, as many as it has room for
// within these.
const PANE_MIN_STEPS = 3
const PANE_MAX_STEPS = 12
// Under the prompt the board shares the screen with the conversation: the
// tasks it lists, and the steps under the one in progress.
const PROMPT_TASKS = 6
const PROMPT_STEPS = 3
// The row under the prompt as clawd-statusbar sizes its frame: the engine's
// two-column indent at the left and the room it keeps at the right, so the
// two frames line up when both are installed.
const INDENT = 2
const TRAIL = 4
const FRAME = 4
const FALLBACK_COLUMNS = 80

const board = atom({ plugin: 'clawd-tasks', key: 'board' } as const, EMPTY)
const clock = atom({ plugin: 'clawd-tasks', key: 'now' } as const, 0)
const hidden = atom({ plugin: 'clawd-tasks', key: 'isHidden' } as const, false)

type Placement = 'prompt' | 'pane'
let config: { placement: Placement; isAutoOpen: boolean } = { placement: 'prompt', isAutoOpen: true }
// The plan's size when last seen, so a new plan opens the pane once.
let seenTasks = 0
let root = ''

async function now($: EngineInterface) {
  return $.clock.now()
}

async function change($: EngineInterface, fn: (one: Board) => Board) {
  await update($, board, one => fn(one ?? EMPTY))
  const after = await read($, board)
  if (config.placement === 'pane' && config.isAutoOpen && seenTasks < 2 && after.tasks.length >= 2) {
    void $.ui.open({ id: PANE, title: TITLE }).catch(() => {})
  }
  // A new plan shows under the prompt even if the last one was hidden.
  if (config.placement === 'prompt' && seenTasks === 0 && after.tasks.length > 0) await update($, hidden, () => false)
  seenTasks = after.tasks.length
}

// The plan tools' calls change the board once they have run.
async function planned($: EngineInterface, tool: string, args: Record<string, unknown>, result: unknown) {
  const at = await now($)
  if (tool === 'TodoWrite' && Array.isArray(args.todos)) {
    await change($, one => fromTodos(one, args.todos as never, at))
  } else if (tool === 'TaskCreate') {
    const id = (result as { task?: { id?: string } } | undefined)?.task?.id
    if (typeof id === 'string') {
      await change($, one => created(one, id, String(args.subject ?? ''), String(args.activeForm ?? ''), at))
    }
  } else if (tool === 'TaskUpdate' && typeof args.taskId === 'string') {
    const id = args.taskId
    await change($, one => updated(one, id, args as never, at))
  }
}

// Marks as clawd-git drew the plan: done, running, waiting.
const STATUS = {
  completed: { mark: '✓', color: 'green' },
  in_progress: { mark: '●', color: 'yellow' },
  pending: { mark: '○', color: 'gray' },
} as const

function stepTime(step: Step, at: number) {
  return step.endedAt === undefined ? 'running' : duration(step.endedAt - step.startedAt)
}

type Elements = { Box: any; Text: any }

// The board's rows, for the pane and the frame under the prompt alike: the
// header, a progress bar, the tasks with their time and line counts on the
// right, and the latest steps under the task in progress.
function rows({ Box, Text }: Elements, one: Board, at: number, width: number, limits: { tasks: number; steps: number }) {
  const { done, total } = progress(one)
  const took = one.startedAt === undefined ? '' : duration(at - one.startedAt)
  const running = current(one)
  const shown = shownTasks(one, limits.tasks)
  const barWidth = Math.max(10, width)
  const filled = total === 0 ? 0 : Math.round((done / total) * barWidth)
  const out = [
    <Text key="head" wrap="truncate-end">
      <Text bold>Plan</Text>
      <Text dimColor> · </Text>
      <Text color={done === total ? 'green' : 'yellow'}>{`${done}/${total} done`}</Text>
      {took !== '' && <Text dimColor>{` · ${took}`}</Text>}
    </Text>,
    <Text key="bar">
      <Text color="green">{'━'.repeat(filled)}</Text>
      <Text dimColor>{'━'.repeat(barWidth - filled)}</Text>
    </Text>,
  ]
  if (shown.folded > 0) out.push(<Text key="folded" dimColor><Text color="green">✓ </Text>{`${shown.folded} done`}</Text>)
  for (const task of shown.tasks) {
    const status = STATUS[task.status]
    const isRunning = task.id === running?.id
    const { files, added, removed } = changeOf(task)
    const time = taskTime(task, at)
    const steps = isRunning ? task.steps.slice(-limits.steps) : []
    const earlier = isRunning ? task.dropped + task.steps.length - steps.length : 0
    out.push(
      <Box key={`t:${task.id}`} flexDirection="row">
        <Text color={status.color}>{`${status.mark} `}</Text>
        <Box flexGrow={1} flexShrink={1}>
          <Text bold={isRunning} color={task.status === 'completed' ? 'gray' : undefined} wrap="truncate-end">
            {isRunning ? task.activeForm || task.subject : task.subject}
          </Text>
        </Box>
        {time !== '' && <Text color={isRunning ? 'yellow' : 'gray'}>{`  ${time}`}</Text>}
        {files > 0 && <Text color="green">{`  +${added}`}</Text>}
        {files > 0 && <Text color={removed > 0 ? 'red' : undefined} dimColor={removed === 0}>{` −${removed}`}</Text>}
        {task.agents > 0 && <Text dimColor>{`  ${task.agents} agent${task.agents > 1 ? 's' : ''}`}</Text>}
      </Box>,
    )
    if (earlier > 0) out.push(<Text key={`e:${task.id}`} dimColor>{`  │ ${earlier} earlier steps`}</Text>)
    for (const step of steps) {
      const label = cut(step.label, Math.max(8, width - TOOL_WIDTH - 20))
      out.push(
        <Box key={`s:${step.id}`} flexDirection="row">
          <Text dimColor>{'  │ '}</Text>
          <Text color={step.isError ? 'red' : step.endedAt === undefined ? 'yellow' : 'cyan'}>
            {shortTool(step.tool).slice(0, TOOL_WIDTH).padEnd(TOOL_WIDTH)}
          </Text>
          <Box flexGrow={1} flexShrink={1}>
            <Text color={step.endedAt === undefined ? undefined : 'gray'} wrap="truncate-end">{` ${label}${step.agentId ? ' (agent)' : ''}`}</Text>
          </Box>
          <Text color={step.isError ? 'red' : 'gray'}>{`  ${step.isError ? 'failed' : stepTime(step, at)}`}</Text>
        </Box>,
      )
    }
  }
  if (shown.more > 0) out.push(<Text key="more" dimColor>{`○ ${shown.more} more`}</Text>)
  if (one.loose > 0) out.push(<Text key="loose" dimColor>{`${one.loose} calls outside any task`}</Text>)

  return out
}

export const register: Register = (on, options) => {
  config = {
    placement: options.placement === 'pane' ? 'pane' : 'prompt',
    isAutoOpen: options.autoOpen !== false,
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Show or hide the task board: the plan, and the steps under each task',
      argumentHint: '[export | clear | close]',
    }).catch(() => {}) // a refused name must not cost the plan tool below (0.3 asked for the built-in /tasks)
    root = await $.session.root().catch(() => '')
    const tools = await $.tool.list().catch(() => [])
    const hasNative = tools.some(tool => NATIVE_TASK_TOOLS.includes(tool.name))
    await $.tool.register({ name: PLAN_TOOL, description: PLAN_DESCRIPTION, inputSchema: PLAN_SCHEMA, isDeferred: hasNative })
    seenTasks = (await read($, board)).tasks.length
    // The engine keeps a plugin's panes open across reloads and updates: one an
    // earlier version opened (0.1 drew the board in a pane) goes, now that the
    // board is under the prompt.
    if (config.placement === 'prompt') {
      const panes = await $.ui.panes().catch(() => [])
      if (panes.some(pane => pane.id === PANE)) await $.ui.close({ id: PANE }).catch(() => {})
    }
    // A running task's clock moves on; nothing is written while none runs.
    $.clock.every(TICK_MS, () => {
      void (async () => {
        const one = await read($, board)
        if (current(one) !== undefined) {
          const at = await now($)
          await update($, clock, () => at)
        }
      })().catch(() => {})
    })

    return next(e)
  })

  // A /clear starts a new conversation: the old plan goes with it.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await update($, board, () => EMPTY)
      seenTasks = 0
    }
    return next(e)
  })

  // The plugin's own plan tool: nothing beneath answers it, so this hook does.
  on('tool.call', { tool: OWN_TOOL }, async ($, e) => {
    const parsed = todosFromPlan(e)
    if ('error' in parsed) return { result: `The plan was not changed: ${parsed.error}` }
    const at = await now($)
    await change($, one => fromTodos(one, parsed.todos, at))
    const { done, total } = progress(await read($, board))
    return { result: `Plan saved: ${done}/${total} done. It shows on the task board under the prompt.` }
  }).catch(() => ({ result: 'The plan could not be saved; the task board is unchanged.' }))

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const args = e as unknown as Record<string, unknown>
    if (tool === OWN_TOOL) return next(e)
    if (PLAN_TOOLS.has(tool)) {
      const ran = await next(e)
      if (ran.deny === undefined && ran.isError !== true) void planned($, tool, args, ran.result).catch(() => {})
      return ran
    }

    const id = e.tool_use_id
    const step: Step = { id, tool, label: labelOf(tool, args, root), startedAt: await now($), agentId: e.agentId }
    await change($, one => stepStarted(one, step, args, root)).catch(() => {})
    let isError = true
    try {
      const ran = await next(e)
      isError = ran.deny !== undefined || ran.isError === true
      return ran
    } finally {
      const at = await now($)
      void update($, board, one => stepEnded(one ?? EMPTY, id, at, isError)).catch(() => {})
    }
  }).catch(($, e, next) => next(e))

  on('command.run', { command: COMMAND }, async ($, e) => {
    const word = e.args.trim().toLowerCase()
    if (word === 'export') {
      const markdown = toMarkdown(await read($, board), await now($))
      const copied = await $.ui.copy({ text: markdown }).catch(() => ({ isCopied: false }))
      return { text: `${markdown}\n\n${copied.isCopied ? '(Copied to the clipboard.)' : ''}`.trim() }
    }
    if (word === 'clear') {
      await update($, board, () => EMPTY)
      seenTasks = 0
      return { text: 'Task board cleared.' }
    }
    if (word === 'close') {
      if (config.placement === 'pane') await $.ui.close({ id: PANE })
      else await update($, hidden, () => true)
      return { text: 'Task board hidden. /board shows it again.' }
    }
    if (word !== '') return { text: `Unknown option "${word}". Use /board, /board export, /board clear or /board close.` }

    const { done, total } = progress(await read($, board))
    const plan = total === 0 ? 'no plan yet' : `${done}/${total} done`
    if (config.placement === 'pane') {
      const opened = await $.ui.open({ id: PANE, title: TITLE })
      return { text: opened.isPlaced ? `Task board open (${plan}).` : `Task board: ${plan}. It opens when there is room for it.` }
    }
    const isHidden = !(await read($, hidden))
    await update($, hidden, () => isHidden)
    if (isHidden) return { text: 'Task board hidden. /board shows it again.' }
    return { text: total === 0 ? 'Task board on: it shows under the prompt once Claude makes a plan.' : `Task board shown (${plan}).` }
  }).catch(() => ({ text: 'The task board could not be switched; see the debug log.' }))

  // Under the prompt, in a frame the width of clawd-statusbar's: whichever of
  // the two draws first, the board sits right above or right below the bar.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    if (config.placement !== 'prompt') return next(e)
    const [below, one, isHidden, ticked, clockNow] = await Promise.all([
      next(e), read($, board), read($, hidden), read($, clock), now($),
    ])
    if (isHidden || one.tasks.length === 0) return below

    // A finished plan leaves the screen; the next plan brings the board back.
    if (isFinished(one)) return below

    const { Box, Text } = $.ui.resolve(e)
    const at = Math.max(ticked, clockNow)
    // Sized as clawd-statusbar sizes its frame: the text to the conversation's
    // column, the frame itself stretched across the row (the footer spans the
    // whole terminal while a pane is docked).
    const width = (e.viewport?.columns ?? FALLBACK_COLUMNS) - INDENT - TRAIL
    const frame = { borderStyle: 'round', borderDimColor: true, paddingX: 1 } as const
    return (
      <Box flexDirection="column">
        {below}
        <Box {...frame} flexDirection="column">
          {rows({ Box, Text }, one, at, width - FRAME, { tasks: PROMPT_TASKS, steps: PROMPT_STEPS })}
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const [one, ticked, clockNow] = await Promise.all([read($, board), read($, clock), now($)])
    const at = Math.max(ticked, clockNow)

    if (one.tasks.length === 0) {
      return (
        <Box flexDirection="column">
          <Text dimColor>No plan yet.</Text>
          <Text dimColor wrap="wrap">When Claude makes a task list, each task shows here with the steps it took.</Text>
          {one.loose > 0 && <Text dimColor>{`${one.loose} calls so far`}</Text>}
        </Box>
      )
    }

    const room = e.props.scroll.bodyRows - one.tasks.length - 3
    const steps = Math.min(PANE_MAX_STEPS, Math.max(PANE_MIN_STEPS, room))
    return (
      <Box flexDirection="column">
        {rows({ Box, Text }, one, at, Math.max(20, e.props.bodyColumns), { tasks: Number.MAX_SAFE_INTEGER, steps })}
      </Box>
    )
  })
}

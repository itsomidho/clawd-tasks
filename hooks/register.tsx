import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Board, Step, Task } from '../types'
import {
  EMPTY, PLAN_TOOLS, changeOf, created, current, cut, duration, fromTodos, labelOf, progress,
  shortTool, stepEnded, stepStarted, taskTime, toMarkdown, updated,
} from './board'

const PANE = 'tasks'
const TITLE = 'Tasks'
const COMMAND = 'tasks'
// How often a running task's clock moves on the board.
const TICK_MS = 1000
// Steps shown under the task in progress: as many as the pane has room for,
// within these.
const MIN_STEPS = 3
const MAX_STEPS = 12
const TOOL_WIDTH = 6

const board = atom({ plugin: 'clawd-tasks', key: 'board' } as const, EMPTY)
const clock = atom({ plugin: 'clawd-tasks', key: 'now' } as const, 0)

let config = { isAutoOpen: true }
// The plan's size when last seen, so a new plan opens the board once.
let seenTasks = 0
let root = ''

async function now($: EngineInterface) {
  return $.clock.now()
}

async function change($: EngineInterface, fn: (one: Board) => Board) {
  await update($, board, one => fn(one ?? EMPTY))
  const after = await read($, board)
  if (config.isAutoOpen && seenTasks < 2 && after.tasks.length >= 2) void $.ui.open({ id: PANE, title: TITLE }).catch(() => {})
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

const COLORS = { completed: 'green', in_progress: 'yellow', pending: undefined } as const
const MARKS = { completed: '✓', in_progress: '▶', pending: '○' } as const

function facts(task: Task, at: number) {
  const { files, added, removed } = changeOf(task)
  return [
    taskTime(task, at),
    files > 0 ? `${files}f +${added} −${removed}` : '',
    task.agents > 0 ? `${task.agents}ag` : '',
  ].filter(one => one !== '').join('  ')
}

function stepTime(step: Step, at: number) {
  return step.endedAt === undefined ? 'running…' : duration(step.endedAt - step.startedAt)
}

export const register: Register = (on, options) => {
  config = { isAutoOpen: options.autoOpen !== false }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Show the task board: the plan, and the steps under each task',
      argumentHint: '[export | clear | close]',
    })
    root = await $.session.root().catch(() => '')
    seenTasks = (await read($, board)).tasks.length
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

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const args = e as unknown as Record<string, unknown>
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
      await $.ui.close({ id: PANE })
      return { text: 'Task board closed. /tasks opens it again.' }
    }
    if (word !== '') return { text: `Unknown option "${word}". Use /tasks, /tasks export, /tasks clear or /tasks close.` }

    const opened = await $.ui.open({ id: PANE, title: TITLE })
    const { done, total } = progress(await read($, board))
    const plan = total === 0 ? 'no plan yet' : `${done}/${total} done`
    return { text: opened.isPlaced ? `Task board open (${plan}).` : `Task board: ${plan}. It opens when there is room for it.` }
  }).catch(() => ({ text: 'The task board could not be opened; see the debug log.' }))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const [one, ticked, clockNow] = await Promise.all([read($, board), read($, clock), now($)])
    const at = Math.max(ticked, clockNow)
    const width = Math.max(20, e.props.bodyColumns)

    if (one.tasks.length === 0) {
      return (
        <Box flexDirection="column">
          <Text dimColor>No plan yet.</Text>
          <Text dimColor wrap="wrap">When Claude makes a task list, each task shows here with the steps it took.</Text>
          {one.loose > 0 && <Text dimColor>{`${one.loose} calls so far`}</Text>}
        </Box>
      )
    }

    const { done, total } = progress(one)
    const took = one.startedAt === undefined ? '' : ` · ${duration(at - one.startedAt)}`
    const running = current(one)
    const room = e.props.scroll.bodyRows - one.tasks.length - 3
    const shown = Math.min(MAX_STEPS, Math.max(MIN_STEPS, room))

    return (
      <Box flexDirection="column">
        <Text>
          <Text bold>Plan</Text>
          <Text dimColor>{` · ${done}/${total} done${took}`}</Text>
        </Text>
        {one.tasks.map(task => {
          const info = facts(task, at)
          const isRunning = task.id === running?.id
          const steps = isRunning ? task.steps.slice(-shown) : []
          const hidden = isRunning ? task.dropped + task.steps.length - steps.length : 0
          const subject = isRunning ? task.activeForm || task.subject : task.subject

          return (
            <Box key={`t:${task.id}`} flexDirection="column">
              <Box flexDirection="row">
                <Text color={COLORS[task.status]}>{`${MARKS[task.status]} `}</Text>
                <Box flexGrow={1} flexShrink={1}>
                  <Text bold={isRunning} dimColor={task.status === 'completed'} wrap="truncate-end">{subject}</Text>
                </Box>
                {info !== '' && <Text dimColor>{`  ${info}`}</Text>}
              </Box>
              {hidden > 0 && <Text dimColor>{`   ┆ ${hidden} earlier`}</Text>}
              {steps.map((step, i) => {
                const isLast = i === steps.length - 1
                const label = cut(step.label, Math.max(8, width - TOOL_WIDTH - 22))
                return (
                  <Box key={`s:${step.id}`} flexDirection="row">
                    <Text dimColor>{`   ${isLast ? '└' : '├'} `}</Text>
                    <Text color={step.isError ? 'red' : step.endedAt === undefined ? 'yellow' : undefined}>
                      {shortTool(step.tool).slice(0, TOOL_WIDTH).padEnd(TOOL_WIDTH)}
                    </Text>
                    <Box flexGrow={1} flexShrink={1}>
                      <Text dimColor={step.endedAt !== undefined} wrap="truncate-end">{` ${label}${step.agentId ? ' (agent)' : ''}`}</Text>
                    </Box>
                    <Text dimColor>{`  ${step.isError ? 'failed' : stepTime(step, at)}`}</Text>
                  </Box>
                )
              })}
            </Box>
          )
        })}
        {one.loose > 0 && <Text dimColor>{`${one.loose} calls outside any task`}</Text>}
      </Box>
    )
  })
}

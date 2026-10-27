import { expect, mock, test } from 'claude-code/testing'

const HINT = {
  component: 'PromptHint',
  props: { isDraft: false, isWorking: true, hint: 'esc to interrupt' },
  viewport: { columns: 100, rows: 40 },
} as const

// /board as the person types it at the prompt.
const run = (args: string) => ({
  command: 'board', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 },
}) as const

const PLAN = [
  { content: 'Read the auth flow', activeForm: 'Reading the auth flow', status: 'completed' },
  { content: 'Add the endpoint', activeForm: 'Adding the endpoint', status: 'in_progress' },
  { content: 'Write tests', activeForm: 'Writing tests', status: 'pending' },
] as const

test('the board shows under the prompt once there is a plan, and /board hides it', async ($, on) => {
  // The engine's side: every tool answers, and the hint line is a line of text.
  const clock = mock.clock(on, { now: 1_000 })
  on('tool.call', () => ({ result: {} }))
  on('ui.render', { component: 'PromptHint' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text dimColor>{e.props.hint}</Text>
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'clawd-tasks', surface, ...HINT })
    expect(await ui.find({ type: 'Text', text: /Plan/ })).toBeUndefined()

    await $.tool.call({ tool: 'TodoWrite', todos: PLAN.map(one => ({ ...one })) })
    await clock.advance(0)
    await $.tool.call({ tool: 'Read', file_path: '/tmp/a.ts' })
    await clock.advance(0)
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: /1\/3 done/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Adding the endpoint/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /a\.ts/ })).toBeDefined()

    await $.command.run(run('close'))
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: /Plan/ })).toBeUndefined()

    await $.command.run(run('clear'))
    await $.command.run(run(''))
    await ui.unmount()
  }
})

test('the plan tool fills the board, and turns a bad plan away', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  on('ui.render', { component: 'PromptHint' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text dimColor>{e.props.hint}</Text>
  })

  const ui = await $.ui.mount({ plugin: 'clawd-tasks', surface: 'terminal', ...HINT })
  const bad = await $.tool.call({ tool: 'mcp__clawd-tasks__plan', tasks: [{ subject: 'X', status: 'done' }] })
  expect(String(bad.result)).toContain('The plan was not changed')

  const saved = await $.tool.call({
    tool: 'mcp__clawd-tasks__plan',
    tasks: [
      { subject: 'Update the README', status: 'in_progress', activeForm: 'Updating the README' },
      { subject: 'Check the links', status: 'pending' },
    ],
  })
  await clock.advance(0)
  expect(String(saved.result)).toBe('Plan saved: 0/2 done. It shows on the task board under the prompt.')
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /Updating the README/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /0\/2 done/ })).toBeDefined()
  await ui.unmount()
})

// The session's start registers and tidies in the background: wait (a
// second at most) for what a test checks to land.
async function until(isDone: () => boolean) {
  for (let i = 0; i < 200 && !isDone(); i++) await new Promise(resolve => setTimeout(resolve, 5))
}

test('a pane left open by an earlier version is closed when the board is under the prompt', async ($, on) => {
  mock.clock(on, { now: 1_000 })
  on('ui.render', { component: 'Pane' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>pane</Text>
  })
  // What 0.1 left behind: the board's pane, still open.
  let closed = ''
  on('ui.close', ($, e, next) => {
    closed = e.id
    return next(e)
  })
  on('ui.panes', () => ({ value: [{ id: 'tasks', title: 'Tasks', isShown: true, isFocused: false, isPlaced: true }] }))
  // The rest of a session's start, as the engine answers it.
  on('command.register', () => ({ value: { command: 'board' } }))
  on('tool.list', () => ({ value: [] }))
  on('tool.register', () => ({ value: { tool: 'mcp__clawd-tasks__plan' } }))
  on('session.root', () => ({ value: '/repo' }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await until(() => closed !== '')
  expect(closed).toBe('tasks')
})

test('the plan tool is registered even when the command name is refused', async ($, on) => {
  mock.clock(on, { now: 1_000 })
  // 0.3 asked for /tasks, which is built in: the refusal stopped the session's start.
  on('command.register', () => { throw new Error('"/board" refused: it is built in') })
  let registered = ''
  on('tool.register', ($, e) => {
    registered = e.name
    return { value: { tool: `mcp__clawd-tasks__${e.name}` } }
  })
  on('tool.list', () => ({ value: [] }))
  on('ui.panes', () => ({ value: [] }))
  on('session.root', () => ({ value: '/repo' }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await until(() => registered !== '')
  expect(registered).toBe('plan')
})

test('the board draws the plan with a bar and marks, and leaves once it is done', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  on('tool.call', () => ({ result: {} }))
  on('ui.render', { component: 'PromptHint' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text dimColor>{e.props.hint}</Text>
  })
  const ui = await $.ui.mount({ plugin: 'clawd-tasks', surface: 'terminal', ...HINT })
  await $.tool.call({ tool: 'TodoWrite', todos: PLAN.map(one => ({ ...one })) })
  await clock.advance(0)
  await ui.redraw()
  // The bar, the running task's dot, the done task's tick.
  expect(await ui.find({ type: 'Text', text: /━/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /●/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /✓/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /▶/ })).toBeUndefined()

  // Every task done: the board is gone, the hint line stays.
  await $.tool.call({ tool: 'TodoWrite', todos: PLAN.map(one => ({ ...one, status: 'completed' })) })
  await clock.advance(0)
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /Plan/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /esc to interrupt/ })).toBeDefined()
  await ui.unmount()
})

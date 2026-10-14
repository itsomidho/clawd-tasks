import { expect, mock, test } from 'claude-code/testing'

const HINT = {
  component: 'PromptHint',
  props: { isDraft: false, isWorking: true, hint: 'esc to interrupt' },
  viewport: { columns: 100, rows: 40 },
} as const

// /tasks as the person types it at the prompt.
const run = (args: string) => ({
  command: 'tasks', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 },
}) as const

const PLAN = [
  { content: 'Read the auth flow', activeForm: 'Reading the auth flow', status: 'completed' },
  { content: 'Add the endpoint', activeForm: 'Adding the endpoint', status: 'in_progress' },
  { content: 'Write tests', activeForm: 'Writing tests', status: 'pending' },
] as const

test('the board shows under the prompt once there is a plan, and /tasks hides it', async ($, on) => {
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

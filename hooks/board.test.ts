import { expect, test } from 'claude-code/testing'

import { EMPTY, created, current, fromTodos, labelOf, shownTasks, stepEnded, stepStarted, toMarkdown, updated } from './board'

const ROOT = '/repo'
const todos = (...status: ('pending' | 'in_progress' | 'completed')[]) =>
  ['Read the auth flow', 'Add the refresh endpoint', 'Write tests'].map((content, i) => ({
    content, activeForm: `Doing ${i}`, status: status[i] ?? 'pending',
  }))

test('a TodoWrite plan files each call under the task in progress', async () => {
  let board = fromTodos(EMPTY, todos('in_progress'), 1000)
  board = stepStarted(board, { id: 'a', tool: 'Read', label: 'src/auth.php', startedAt: 1000 }, { file_path: '/repo/src/auth.php' }, ROOT)
  board = stepEnded(board, 'a', 3000, false)
  board = fromTodos(board, todos('completed', 'in_progress'), 5000)
  board = stepStarted(board, { id: 'b', tool: 'Edit', label: 'src/api.php', startedAt: 5000 },
    { file_path: '/repo/src/api.php', old_string: 'a', new_string: 'a\nb\nc' }, ROOT)

  const [first, second] = board.tasks
  expect(first?.steps.map(step => step.id)).toEqual(['a'])
  expect(first?.endedAt).toBe(5000)
  expect(second?.steps.map(step => step.id)).toEqual(['b'])
  expect(second?.files).toEqual([{ path: 'src/api.php', added: 3, removed: 1 }])
  expect(current(board)?.subject).toBe('Add the refresh endpoint')
})

test('a call with no task in progress counts as loose', async () => {
  const board = stepStarted(fromTodos(EMPTY, todos(), 0), { id: 'x', tool: 'Bash', label: 'ls', startedAt: 0 }, {}, ROOT)
  expect(board.loose).toBe(1)
})

test('a new list that shares no task replaces the plan', async () => {
  const board = fromTodos(fromTodos(EMPTY, todos('completed'), 0), [{ content: 'Other', status: 'pending', activeForm: 'Other' }], 10)
  expect(board.tasks.map(task => task.subject)).toEqual(['Other'])
})

test('TaskCreate and TaskUpdate build the board too', async () => {
  let board = created(EMPTY, '1', 'Ship it', 'Shipping it', 0)
  board = updated(board, '1', { status: 'in_progress' }, 100)
  expect(current(board)?.id).toBe('1')
  board = updated(board, '1', { status: 'deleted' }, 200)
  expect(board.tasks).toEqual([])
})

test('labels name the file, the command or the pattern', async () => {
  expect(labelOf('Read', { file_path: '/repo/a/b.ts' }, ROOT)).toBe('a/b.ts')
  expect(labelOf('Bash', { command: 'npm test\nmore', description: '' }, ROOT)).toBe('npm test')
  expect(labelOf('Grep', { pattern: 'TODO', path: '/repo' }, ROOT)).toBe('TODO')
})

test('the export lists tasks with their files', async () => {
  let board = fromTodos(EMPTY, todos('in_progress'), 0)
  board = stepStarted(board, { id: 'w', tool: 'Write', label: 'x.md', startedAt: 0 }, { file_path: '/repo/x.md', content: 'a\nb' }, ROOT)
  const markdown = toMarkdown(board, 65_000)
  expect(markdown).toContain('## Plan · 0/3 done · 1m 05s')
  expect(markdown).toContain('- [~] **Read the auth flow** — 1m 05s, 1 file +2 −0')
  expect(markdown).toContain('`x.md` +2 −0')
})

test('a long plan folds its done tasks and counts the rest', async () => {
  let board = EMPTY
  const todos = Array.from({ length: 9 }, (_, i) => ({
    content: `Task ${i}`, activeForm: `Doing ${i}`, status: (i < 4 ? 'completed' : i === 4 ? 'in_progress' : 'pending') as never,
  }))
  board = fromTodos(board, todos, 0)
  const shown = shownTasks(board, 5)
  expect(shown.folded).toBe(4)
  expect(shown.tasks.map(task => task.subject)).toEqual(['Task 4', 'Task 5', 'Task 6'])
  expect(shown.more).toBe(2)
  expect(shownTasks(board, 20).tasks.length).toBe(9)
})

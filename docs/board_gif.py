"""Render docs/board.gif: the task board through one plan.

Claude writes a plan of four tasks, then works through them: each tool call
lands under the task in progress, the task's clock runs, and its files and
agents add up. The board sits under the prompt, as the PromptHint hook in
hooks/register.tsx draws it: same marks, colours, columns and limits; once
every task is done it folds to one line. The long stretches are time-lapsed. Needs Pillow
and the DejaVu fonts (paths below are Debian/Ubuntu).

    python3 docs/board_gif.py docs/board.gif
"""
import sys
from PIL import Image, ImageDraw, ImageFont

OUT = sys.argv[1]
MONO = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
SIZE = 22

BG = (30, 30, 34)
TEXT = (220, 220, 220)
DIM = (120, 120, 128)
BORDER = (90, 90, 98)
YELLOW = (229, 192, 123)
GREEN = (120, 200, 120)
RED = (224, 108, 117)

mono = ImageFont.truetype(MONO, SIZE)
bold = ImageFont.truetype(MONO.replace("SansMono.ttf", "SansMono-Bold.ttf"), SIZE)
asc, desc = mono.getmetrics()
CW = round(mono.getlength("M"))
CH = asc + desc

BOX = 72              # the frame's width in cells, as on a 78-column terminal
INNER = BOX - 4       # less border and padding
INDENT = 2            # the engine's indent under the prompt
CANVAS = 15           # rows on screen: the prompt, its hint, the tallest board
TOOL = 6
STEPS = 3             # steps shown under the task in progress
PAD = 18

MARKS = {"completed": ("✓", GREEN), "in_progress": ("▶", YELLOW), "pending": ("○", None)}


def duration(s):
    s = max(0, round(s))
    if s < 60:
        return f"{s}s"
    m = s // 60
    return f"{m}m {s % 60:02d}s" if m < 60 else f"{m // 60}h {m % 60:02d}m"


def cut(text, width):
    return text if len(text) <= width else text[: width - 1] + "…"


def task_facts(task, now):
    out = []
    if task["started"] is not None:
        out.append(duration((task["ended"] if task["ended"] is not None else now) - task["started"]))
    if task["files"]:
        added = sum(a for a, _ in task["files"].values())
        removed = sum(r for _, r in task["files"].values())
        out.append(f"{len(task['files'])}f +{added} −{removed}")
    if task["agents"]:
        out.append(f"{task['agents']}ag")
    return "  ".join(out)


def lines(board, now):
    """The board's rows as [(text, colour, is_bold)] runs, as the Pane hook draws them."""
    tasks = board["tasks"]
    done = sum(1 for t in tasks if t["status"] == "completed")
    if done == len(tasks):
        return [[("✓ ", GREEN, False), ("Plan done", TEXT, True),
                 (f" · {done}/{done} · {duration(now - board['started'])}", DIM, False)]]
    rows = [[("Plan", TEXT, True), (f" · {done}/{len(tasks)} done · {duration(now - board['started'])}", DIM, False)]]
    for task in tasks:
        mark, colour = MARKS[task["status"]]
        running = task["status"] == "in_progress"
        facts = task_facts(task, now)
        facts = f"  {facts}" if facts else ""
        subject = task["active"] if running else task["subject"]
        room = INNER - 2 - len(facts)
        rows.append([(mark + " ", colour, False),
                     (cut(subject, room).ljust(room), DIM if task["status"] == "completed" else TEXT, running),
                     (facts, DIM, False)])
        if not running:
            continue
        steps = task["steps"][-STEPS:]
        hidden = len(task["steps"]) - len(steps)
        if hidden:
            rows.append([(f"   ┆ {hidden} earlier", DIM, False)])
        for i, step in enumerate(steps):
            tool, label, started, ended, failed = step
            time = "failed" if failed else "running…" if ended is None else duration(ended - started)
            time = f"  {time}"
            branch = "└" if i == len(steps) - 1 else "├"
            room = INNER - 5 - TOOL - 1 - len(time)
            colour = RED if failed else YELLOW if ended is None else TEXT
            rows.append([(f"   {branch} ", DIM, False), (tool[:TOOL].ljust(TOOL), colour, False),
                         ((" " + cut(label, room - 1)).ljust(room), DIM if ended is not None else TEXT, False),
                         (time, DIM, False)])
    return rows


# Box-drawing glyphs drawn as lines across the whole cell, as a terminal joins
# them: the font's own stop short of the line height and leave gaps.
LINES = {"│": "ns", "─": "we", "├": "nse", "└": "ne", "╭": "se", "╮": "sw", "╰": "ne", "╯": "nw"}


def box(draw, ch, x, top, colour):
    mx, my = x + CW // 2, top + CH // 2
    ends = {"n": (mx, top), "s": (mx, top + CH - 1), "w": (x, my), "e": (x + CW - 1, my)}
    for side in LINES[ch]:
        (x0, y0), (x1, y1) = sorted([ends[side], (mx, my)])
        # A filled box, not a line: PIL puts a 2-wide line's second pixel on
        # either side by direction, which breaks the stroke between cells.
        draw.rectangle([x0, y0, x1 + 1, y1 + 1], fill=colour)


def frame(board, now):
    body = lines(board, now)
    working = any(t["status"] != "completed" for t in board["tasks"])
    # The prompt between its rules, the hint line, then the board's frame.
    rule = [("─" * (INDENT + BOX + 2), BORDER, False)]
    rows = [rule, [("> ", TEXT, False)], rule,
            [(" " * INDENT + ("esc to interrupt" if working else "? for shortcuts"), DIM, False)]]
    rows.append([(" " * INDENT + "╭" + "─" * (BOX - 2) + "╮", BORDER, False)])
    for line in body:
        used = sum(len(t) for t, _, _ in line)
        rows.append([(" " * INDENT + "│ ", BORDER, False)] + line
                    + [(" " * (INNER - used), TEXT, False), (" │", BORDER, False)])
    rows.append([(" " * INDENT + "╰" + "─" * (BOX - 2) + "╯", BORDER, False)])

    img = Image.new("RGB", ((INDENT + BOX + 2) * CW + 2 * PAD, CANVAS * CH + 2 * PAD), BG)
    draw = ImageDraw.Draw(img)
    for r, line in enumerate(rows):
        col = 0
        for text, colour, is_bold in line:
            for ch in text:
                x, top = PAD + col * CW, PAD + r * CH
                if ch in LINES:
                    box(draw, ch, x, top, colour or TEXT)
                elif ch != " ":
                    draw.text((PAD + col * CW, PAD + r * CH + asc), ch, font=bold if is_bold else mono,
                              fill=colour or TEXT, anchor="ls")
                col += 1
    return img


frames, durations = [], []


def add(ms, board, now):
    frames.append(frame(board, now))
    durations.append(ms)


def task(subject, active):
    return dict(subject=subject, active=active, status="pending", started=None, ended=None,
                steps=[], files={}, agents=0)


board = dict(started=0, tasks=[
    task("Read the existing auth flow", "Reading the existing auth flow"),
    task("Add the token refresh endpoint", "Adding the token refresh endpoint"),
    task("Write tests for refresh", "Writing tests for refresh"),
    task("Update the README", "Updating the README"),
])
now = 0
add(1600, board, now)

# Each task: (the steps it takes, as (tool, label, seconds, lines added, removed, fails)).
WORK = [
    [("Grep", "refresh_token", 2, 0, 0, False), ("Read", "src/Auth/Session.php", 1, 0, 0, False),
     ("Read", "src/Auth/TokenStore.php", 1, 0, 0, False), ("Agent", "Map where tokens expire", 38, 0, 0, False)],
    [("Read", "routes/api.php", 1, 0, 0, False), ("Edit", "src/Auth/TokenStore.php", 2, 14, 3, False),
     ("Write", "src/Http/RefreshController.php", 3, 31, 0, False), ("Edit", "routes/api.php", 1, 3, 0, False),
     ("Bash", "Run the PHP linter", 4, 0, 0, False)],
    [("Write", "tests/RefreshTest.php", 3, 48, 0, False), ("Bash", "Run the refresh tests", 9, 0, 0, True),
     ("Edit", "src/Http/RefreshController.php", 2, 2, 1, False), ("Bash", "Run the refresh tests", 7, 0, 0, False)],
    [("Read", "README.md", 1, 0, 0, False), ("Edit", "README.md", 2, 9, 1, False)],
]

for t, steps in zip(board["tasks"], WORK):
    t["status"], t["started"] = "in_progress", now
    add(700, board, now)
    for tool, label, seconds, added, removed, fails in steps:
        step = [tool, label, now, None, False]
        t["steps"].append(step)
        if tool in ("Edit", "Write"):
            a, r = t["files"].get(label, (0, 0))
            t["files"][label] = (a + added, r + removed)
        if tool == "Agent":
            t["agents"] += 1
        # The step runs; its clock and the task's move on, time-lapsed.
        for _ in range(3):
            add(260, board, now)
            now += seconds / 3
        step[3], step[4] = now, fails
        add(420 if not fails else 1100, board, now)
        now += 2
    t["status"], t["ended"] = "completed", now
    add(900, board, now)

add(3000, board, now)

# Each frame to its own palette with no dithering: dithered grey turns the
# frame's lines into dashes.
frames = [f.quantize(colors=128, dither=Image.Dither.NONE) for f in frames]
frames[0].save(OUT, save_all=True, append_images=frames[1:], duration=durations, loop=0,
               optimize=True, disposal=1)
print(OUT, frames[0].size, len(frames), "frames", sum(durations) / 1000, "s")

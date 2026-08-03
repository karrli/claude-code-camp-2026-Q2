# Step 11 — A Terminal UI (macOS)

Boukensha now ships a full terminal UI (TUI) built on the [`charm`](https://github.com/charm-ruby/charm) gem (bubbletea + lipgloss + bubbles). The plain REPL from step 10 is still there and can be selected with `tui: false`.

This is the **macOS port** of `../11_tui`, which was built and documented against x86_64 Linux (WSL2). The Ruby/TUI code is identical and fully portable — only the native-gem platform pins, the `bubbletea` patch's rebuild tooling, and the setup commands below differ. See `patches/bubbletea/README.md` for the macOS-specific rebuild notes.

## What's new

### `Boukensha::Tui`

New class. Wraps a `Repl` instance and replaces its raw `puts`/`gets` I/O with a structured four-zone display:

```
┌──────────────────────────────────────────────┐
│  conversation viewport (scrollable)           │
├──────────────────────────────────────────────┤
│  ⟳ live progress line (hidden when idle)     │
├──────────────────────────────────────────────┤
│  boukensha> input box                         │
├──────────────────────────────────────────────┤
│  status line (always-on)                      │
└──────────────────────────────────────────────┘
```

The **progress line** shows a spinner, current action, iteration counter (`n/MAX`), elapsed seconds, token counts (↑ in / ↓ out), and tool call count while the agent is running. When idle it shows context usage and turn count.

The **status line** always shows: version · model · context tokens used/max · registered tool count · wall-clock time.

**Keyboard shortcuts:**

| Key | Action |
|-----|--------|
| `Enter` | Submit input or slash command |
| `Esc` | Interrupt the running agent turn |
| `Ctrl+L` | Clear conversation history |
| `PgUp` / `PgDn` | Scroll conversation viewport |
| `Ctrl+C` / `Ctrl+D` | Quit |

The agent runs in a background thread so the UI stays responsive during long turns.

### `Boukensha.repl` — new `tui:` keyword

```ruby
Boukensha.repl(tui: true)   # default — launches charm TUI
Boukensha.repl(tui: false)  # falls back to plain terminal REPL
```

The `--no-tui` CLI flag sets `tui: false` from the command line.

### `Repl` refactored for composability

`Repl` no longer hard-codes `puts`/`gets`. Three methods are now public so `Tui` (or any other front-end) can drive it:

| Method | Purpose |
|--------|---------|
| `on_output(&block)` | Route all REPL output through a callback instead of stdout |
| `handle_command(input)` | Process a slash command; returns `:quit`, `:command`, or `nil` |
| `run_turn(input)` | Run one agent turn and route the result through `on_output` |

`banner`, `logger`, `context`, `model`, and `version` are also exposed as readers.

### `Logger#subscribe`

```ruby
logger.subscribe { |event| ... }
```

Every structured log event (`:iteration`, `:tool_call`, `:tool_result`, `:response`, etc.) is now broadcast to all registered subscribers as well as being written to the JSONL file. `Tui` uses this to update the live progress line in real time without polling.

## Run Example

The TUI is interactive, so it's run via the global `boukensha` executable
rather than `examples/example.rb` (that file is the step 10 MUD demo, carried
over unchanged — it doesn't exercise the TUI).

### Prerequisites (macOS-specific)

- **Xcode Command Line Tools** — needed to build the native gems and, if you
  apply it, the `bubbletea` input-burst patch: `xcode-select --install`.
- This step's `Gemfile.lock` is pinned to the `arm64-darwin` and
  `x86_64-darwin` platform gems (covers Apple Silicon and Intel Macs). Run
  `bundle install` from this directory first.

```sh
bundle install

# Build and install this step's gem. If a later step's gem is already
# installed, `boukensha` will keep launching that version's loader instead —
# remove it first:
gem uninstall boukensha

gem build boukensha.gemspec
gem install boukensha-0.11.0.gem

# launches the charm TUI (uses the default ~/.boukensha config dir):
BOUKENSHA_PATH=~/Sites/Claude-Code-Camp/week1_baseline/ruby/11_tui_MacOS boukensha

# plain REPL (no charm dependency required):
BOUKENSHA_PATH=~/Sites/Claude-Code-Camp/week1_baseline/ruby/11_tui_MacOS boukensha --no-tui
```

Or, without installing the gem globally:

```sh
bundle exec bin/boukensha
```
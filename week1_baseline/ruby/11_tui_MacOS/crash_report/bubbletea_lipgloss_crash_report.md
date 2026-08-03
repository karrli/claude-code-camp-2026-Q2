## `Bubbletea::Program.new` + any `lipgloss` call crashes with `fatal error: bad sweepgen in refill` on macOS

### Environment

- macOS 26.6 (BuildVersion 25G72), Darwin 25.6.0, x86_64
- Ruby 4.0.6 (2026-07-14 revision 03b6d3f889) +PRISM [x86_64-darwin23]
- `bubbletea` 0.1.4 (x86_64-darwin), also reproduced on 0.1.0 (x86_64-darwin)
- `lipgloss` 0.2.2 (x86_64-darwin), also reproduced on 0.2.0 (x86_64-darwin)
- Both native extensions embed Go 1.23.0 (confirmed via `strings *.bundle | grep '^go1\.'`)
- Xcode Command Line Tools installed (clang 21.0.0)

### Minimal reproduction

No terminal I/O, no rendering, no threads of my own — just constructing a `Bubbletea::Program` and then making any call into `lipgloss`:

```ruby
require "bubbletea"
require "lipgloss"

program = Bubbletea::Program.new   # crash trigger is here, before any other call
style = Lipgloss::Style.new.foreground("#00ffff")
puts style.render("boom")
```

Running this aborts the Ruby process:

```
fatal error: bad sweepgen in refill

goroutine 17 gp=... m=1 mp=... [running, locked to thread]:
runtime.throw(...)
	/usr/local/go/src/runtime/panic.go:1067 +0x48
runtime.(*mcache).refill(...)
	/usr/local/go/src/runtime/mcache.go:157 +0x20d
runtime.(*mcache).nextFree(...)
	/usr/local/go/src/runtime/malloc.go:945 +0x85
runtime.mallocgc(...)
	/usr/local/go/src/runtime/malloc.go:1161 +0x4cd
runtime.newobject(...)
	/usr/local/go/src/runtime/malloc.go:1386
runtime.mapassign(...)
	/usr/local/go/src/runtime/map.go:714 +0x438
main.allocStyle(...)
	/home/runner/work/lipgloss-ruby/lipgloss-ruby/go/style.go:15 +0x85
main.lipgloss_new_style(...)
	/home/runner/work/lipgloss-ruby/lipgloss-ruby/go/style.go:29
_cgoexp_...lipgloss_new_style(...)
runtime.cgocallbackg1 / cgocallbackg / cgocallback
...
[BUG] Aborted (Ruby-level SIGABRT via rb_bug_for_fatal_signal)
```

### What I've ruled out

- **Not a frequency/GC-pressure issue** — crashes on the very first `Lipgloss::Style.new`, even before any `bubbletea` rendering or input polling happens. Just the constructor (`Bubbletea::Program.new`, which calls `tea_terminal_init` internally) is enough to put the process in a bad state for any subsequent `lipgloss` call.
- **`GODEBUG=asyncpreemptoff=1`** (the usual mitigation for cross-runtime signal-preemption issues) — no effect, crashes identically.
- **Version regression** — tested `bubbletea` 0.1.0 + `lipgloss` 0.2.0 (oldest cleanly-installable darwin-native combo; `lipgloss` 0.1.0's darwin platform gem appears to be missing its prebuilt Go archive and fails to build from source) — identical crash.
- **`lipgloss` alone, no `bubbletea` calls** — works fine. The crash requires both runtimes to be *active* (not just loaded/required — `require`ing both with no calls is also fine).

### Suspected root cause

`bubbletea` and `lipgloss` are each independently-compiled cgo extensions, and each statically links its **own copy of the Go runtime**. Go does not support multiple independently-linked runtime copies coexisting safely in one process (each installs its own signal handlers, GC pacer, sysmon thread, etc.). The moment `bubbletea`'s runtime is initialized (`Program.new`) and `lipgloss`'s runtime is then entered via cgo, the two appear to corrupt each other's heap bookkeeping (`mcache`/`mspan` sweep generation counters), causing the Go GC assertion to fire.

This is what makes it especially painful for `charm` (the umbrella gem): it requires both, and `bubbles`' own `Viewport`/`TextArea`/etc. (`lib/bubbles/viewport.rb`, `lib/bubbles/text_area.rb`) call into `lipgloss` directly for styling, so there's no way to use `bubbles` widgets alongside `bubbletea` without hitting this.

I did not reproduce this on Linux (x86_64-linux-gnu) — a `charm`-based TUI using the same three gems (`bubbletea`+`lipgloss`+`bubbles`) runs there without this crash, which suggests the underlying multi-runtime hazard exists but doesn't reliably manifest until Darwin's signal/thread handling triggers it.

### Ask

Is this a known limitation of combining `bubbletea-ruby` and `lipgloss-ruby` (or `charm-ruby` more broadly) in one process? If there's a supported way to make these coexist on macOS (e.g. a single merged Go archive, or a build flag), pointers would be appreciated — happy to help test.

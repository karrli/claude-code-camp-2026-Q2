# bubbletea native-extension patch (pending-input buffer)

The `bubbletea` gem ships as a **precompiled platform gem**, and this fix lives
in its C extension — i.e. *outside* this repo, under wherever RubyGems installs
gems for your Ruby (e.g. `$(gem env gemdir)/gems/bubbletea-0.1.4-<platform>/`,
typically `/usr/local/lib/ruby/gems/<abi>/gems/...` for a Homebrew Ruby, or
`~/.rbenv/versions/<version>/lib/ruby/gems/<abi>/gems/...` under rbenv). That
copy is **lost whenever the gem is reinstalled** (e.g. `bundle install`
re-downloading the native gem).

These files are the versioned source of truth so the fix is reproducible:

This directory is **self-contained** — the patched sources and the apply
script all live here:

| file | what it is |
|------|------------|
| `program.c`, `extension.h` | the **patched** extension sources (authoritative; copied into the installed gem by the script) |
| `bubbletea-pending-input.patch` | unified diff vs pristine upstream, for review / upstreaming to `marcoroth/bubbletea-ruby` |
| `patch_bubbletea.rb` | the apply script (re-applies the sources to the installed gem and rebuilds) |

## What the patch does

`program_poll_event` did one `read()` of up to 256 bytes, parsed a **single**
key event from the front, and **discarded the rest**. When more than one byte
arrived in a single `read()` — routine for pastes and for fast typing on WSL2
ptys — every byte after the first was lost (often including `Enter`).

The patch adds a `pending_buf` / `pending_len` to the program struct. After
parsing one event, any unconsumed bytes are stashed and drained on the next
`poll_event` call *before* reading stdin again, so multi-byte chunks yield all
their key events. Verified: a single-burst write of 43 chars now produces 43
key events (was 1).

## Re-applying after a gem reinstall

Requires Xcode Command Line Tools (`xcode-select --install`) to compile the C
glue — no Go toolchain needed.

From anywhere inside the `12_context` project (bundler finds the Gemfile up
the tree):

```sh
bundle exec ruby patches/bubbletea/patch_bubbletea.rb
```

…or from this directory directly:

```sh
cd patches/bubbletea && bundle exec ruby patch_bubbletea.rb
```

This copies the patched sources into the installed gem, rebuilds the C glue
against the gem's **prebuilt `libbubbletea.a`** (no Go toolchain needed),
strips debug info, installs the rebuilt extension (`.bundle` on macOS, `.so` on
Linux — the script detects this via `RbConfig::CONFIG["DLEXT"]`) for the
current Ruby ABI, and load-checks it. To revert to the pristine gem:
`gem pristine bubbletea`.

## Related, but separate

This is **only** the burst-discard fix. A second, independent issue — `lipgloss`
and `bubbletea` each embedding their own Go runtime, which corrupts memory when
both are active in one process on macOS — is fixed repo-side in
`lib/boukensha/tui.rb` (require `bubbletea` only, with styling/viewport/input
hand-rolled in pure Ruby instead of `lipgloss`/`bubbles`/`charm`) and needs no
rebuild. See `crash_report/bubbletea_lipgloss_crash_report.md`.

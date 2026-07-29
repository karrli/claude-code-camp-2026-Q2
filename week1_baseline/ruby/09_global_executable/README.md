# Step 9 — Global Executable

Package BOUKENSHA as a gem so the `boukensha` command works from anywhere on your machine.

## What this step adds

- `boukensha.gemspec` — declares the gem: name, version, which files to include, and the `bin/boukensha` executable
- `bin/boukensha` — the shebang script that becomes the global command
- `lib/boukensha_loader.rb` — resolves *which step folder* to load from, then boots the REPL
- `lib/boukensha.rb` + `lib/boukensha/` — step 7's lib, bundled as the default

## Install

```bash
cd 09_global_executable
gem build boukensha.gemspec
gem install boukensha-0.9.0.gem
```

After that, `boukensha` is on your `$PATH` and works from any directory.

## Configuring the global executable

Two things are configurable: which **step** to load (`BOUKENSHA_PATH`) and which **config
directory** to use for `settings.yaml` / `.env` / prompts (`BOUKENSHA_DIR`). Each resolves
independently, env var first:

| Priority | `BOUKENSHA_PATH` (which step) | `BOUKENSHA_DIR` (which config dir) |
|----------|--------------------------------|-------------------------------------|
| 1 | `BOUKENSHA_PATH` env var | `BOUKENSHA_DIR` env var |
| 2 | `path:` in `~/.boukensharc` | `dir:` in `~/.boukensharc` |
| 3 | Bundled default | `~/.boukensha` |

`BOUKENSHA_PATH` must point to a step folder that contains `lib/boukensha.rb`.

`~/.boukensharc` is a small YAML file:

```yaml
path: ~/Sites/boukensha/07_the_repl_loop
dir: ~/projects/mybot/.boukensha
```

Either key is optional. For backwards compatibility, a `~/.boukensharc` containing just a bare
path (no YAML keys) is still accepted and treated as `path:`.

## Running a specific step

```bash
# step 7 (interactive REPL)
BOUKENSHA_PATH=~/Sites/boukensha/07_the_repl_loop boukensha

# step 6 doesn't have a REPL — loader tells you how to run it
BOUKENSHA_PATH=~/Sites/boukensha/06_the_run_dsl boukensha
# => boukensha: the step at .../06_the_run_dsl does not support the interactive REPL
#    Run its examples directly, e.g.: ruby .../06_the_run_dsl/examples/*.rb
```

## Debug mode

```bash
BOUKENSHA_DEBUG=1 boukensha
# => [boukensha] loading from: /path/to/step
```

## The key idea

The gem is just a **wrapper and a default**. All the teaching material stays in the numbered step folders exactly as it was. The gem doesn't copy or symlink anything — it just knows where to look.

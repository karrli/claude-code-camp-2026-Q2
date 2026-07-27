# Boukensha Log Viewer

A dependency-free frontend that renders `.jsonl` session logs (written by
`Boukensha::Logger`, see `week1_baseline/ruby/06_the_logger`) as a
human-readable, live-updating timeline — instead of raw grep/tail output.

It loads and updates fully automatically: point a browser at it and it
immediately starts following whatever session is newest under
`.boukensha/sessions`, streaming in new lines as the agent writes them. There
is no folder or file to pick.

## Usage

```sh
./week1_baseline/bin/log_viewer
```

This starts `server.rb` (Ruby stdlib only, no gems) and opens
`http://localhost:8934` for you. Or run it manually:

```sh
cd week1_baseline/log-viewer
ruby server.rb
# then open http://localhost:8934
```

The page polls the server every ~800ms, always following the newest session
file unless you turn off **Follow latest** to inspect an older one from the
dropdown. Nothing to grant, connect, or reconnect — reloading the page just
picks up wherever the logs currently are.

## Why a server is needed

A page can't automatically load arbitrary local files — browsers require an
explicit, per-visit user gesture (a file/folder picker) before JS may touch
the filesystem, and that permission can't be granted silently or in advance.
Routing reads through a tiny local server sidesteps that entirely: `server.rb`
reads `.boukensha/sessions` on the machine it runs on and exposes it over a
minimal HTTP API, so the browser is just fetching from `localhost` like any
other page — no picker, no permission dialog, ever.

- `GET /api/sessions` — list of session files, newest first
- `GET /api/sessions/<name>/tail?offset=N` — bytes appended since `offset`,
  plus an `X-File-Size` header the client uses as the next offset

## What it shows

Each log line is rendered as a color-coded card based on its `phase`
(`session_start`, `iteration`, `prompt`, `tool_call`, `tool_result`,
`response`, `turn_end`, `raw`), with markdown-lite formatting for text and
pretty-printed JSON for arguments/results. Long content collapses behind a
"show more" toggle.

A stats bar tracks iteration progress, elapsed time, tool call count, token
usage, and running cost. Phase chips and a search box filter the timeline;
`prompt` and `raw` are hidden by default since they're the noisiest/most
duplicative phases.

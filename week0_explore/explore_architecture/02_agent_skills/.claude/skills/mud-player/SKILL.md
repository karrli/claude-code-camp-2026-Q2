---
name: mud-player
description: Plays a tbaMUD/CircleMUD text-based MUD over a telnet connection on behalf of the user, using a bundled connection-management script that keeps a persistent background session open. Use this skill whenever the user asks to play, log into, explore, or automate actions in a MUD (Multi-User Dungeon), mentions a telnet game on localhost:4000, or names tbaMUD or CircleMUD directly. Also use it for in-game goals that don't say "MUD" explicitly, such as "explore the game world", "find the bakery", "level up my character", "go fight something", "check my inventory", or "log in as dummy and look around" -- these all mean driving the MUD through this skill's script rather than trying raw telnet/nc commands by hand.
---

# Playing a MUD (tbaMUD / CircleMUD)

## Why a script is needed

An interactive telnet session is stateful: the character's location, HP, and
combat status live on one open TCP connection. A plain shell tool call runs a
command and exits, closing any socket it opened -- so naive `telnet` or `nc`
invocations can't hold a MUD session open across turns.

`scripts/mud_client.py` solves this by spawning a small background daemon
that owns the live connection to the MUD server, and exposing `connect` /
`send` / `read` / `status` / `disconnect` subcommands that talk to that
daemon. Because the daemon keeps running between invocations, you can send
one command at a time -- exactly as a player would -- and see the response
before deciding the next move.

## Connection details

- Host: `localhost`
- Port: `4000`
- Game: tbaMUD (a CircleMUD variant)
- Existing character: username `dummy`, password `helloworld`

These are the script's defaults, so nothing needs to be passed explicitly.
Override with `--host`/`--port` flags or `MUD_HOST`/`MUD_PORT` env vars if
ever pointed at a different server.

## Using the script

Run it with `python3` from this skill's `scripts/` directory (use the
absolute path to `mud_client.py` shown for this skill). Each call prints
whatever text the server produced in response.

```
python3 scripts/mud_client.py connect          # open the connection, see the banner/login prompt
python3 scripts/mud_client.py send "dummy"      # send the character name
python3 scripts/mud_client.py send "helloworld" # send the password
python3 scripts/mud_client.py send ""           # press enter through a "*** PRESS RETURN ***" screen
python3 scripts/mud_client.py send "look"       # any normal in-game command
python3 scripts/mud_client.py read --wait 3     # just wait and read (e.g. mid-combat, or a slow screen)
python3 scripts/mud_client.py status            # confirm a session is live
python3 scripts/mud_client.py disconnect        # close the connection and stop the daemon
```

`send` and `read` wait for output to go quiet (default: stop after 1s of
silence, or 4-5s total) before returning, which is normally enough. If a
screen is still filling in (long room descriptions, a `who` list, combat
spam), call `read --wait 5` again rather than assuming the first response was
complete.

Raw session logs (including telnet negotiation bytes and ANSI color codes,
which the normal output has already stripped for readability) are kept at
`/tmp/mud_client_<host>_<port>.log` -- useful if a session seems stuck and
you need to see exactly what the server sent.

## Playing the game

1. `connect`, then read the banner/login prompt carefully -- tbaMUD's exact
   login flow (whether it asks for name then password directly, shows a
   "new character" confirmation, has a menu screen, or detects an existing
   connection and asks to reconnect) can vary by server configuration.
   **Don't assume a fixed script of prompts** -- read what actually comes
   back after each `send` and respond to it, the same way a human player
   reading their terminal would. Note that `connect` itself can take a few
   seconds: tbaMUD runs client-protocol autodetection (MXP/MSDP/ATCP/...)
   before showing the login prompt, and anything sent while that's still in
   progress is silently discarded by the server -- the script already waits
   this out, so just use its output as-is rather than sending input early.
2. Log in with the credentials above. Common prompts you may see and how to
   answer them generically:
   - `*** PRESS RETURN ***` / "Press Enter" -> `send ""` (empty line)
   - A yes/no confirmation ("Do you wish to enter the game?", "reconnect?")
     -> `send "y"` or `send "n"` depending on what's being asked
   - A numbered menu -> `send` the number for the relevant option
     ("enter the game" is usually what you want)
3. Once in the game world, drive it one command at a time: `look`/`l`,
   `north`/`n`, `south`/`s`, `east`/`e`, `west`/`w`, `up`/`u`, `down`/`d`,
   `inventory`/`i`, `score`/`sc`, `who`, `say <text>`, `tell <name> <text>`,
   `get <item>`, `drop <item>`, `kill <target>`, `save`, `quit`. Always look
   at the output before deciding the next command -- movement can fail, an
   item might not be there, combat changes the room state.
4. `save` periodically and always before ending a session, so progress
   survives a disconnect. Then `send "quit"`, read the confirmation, and run
   `disconnect` to stop the background daemon cleanly.

## Tracking state across turns and sessions

Keep `data/player.md` and `data/world.md` (in this skill's folder) updated as
you play -- they're your memory of what's already been discovered, since the
MUD itself won't summarize that for you:

- `data/player.md`: character name, current HP/status, current location, and
  the active goal.
- `data/world.md`: rooms visited so far (name, exits, notable NPCs/items) and
  a running list of unexplored exits, so a later session can pick up
  exploration where a previous one left off instead of re-treading ground.

Update these after meaningful events (moving to a new room, finding
something noteworthy, finishing or changing a goal) rather than only at the
very end -- if the session is interrupted, the files should still reflect
real progress.

## Troubleshooting

- `connect` fails with a "could not connect" error: the MUD server likely
  isn't running on `localhost:4000`. Let the user know rather than retrying
  in a loop.
- `send`/`read`/`status`/`disconnect` say "Not connected": run `connect`
  first -- the background daemon isn't running (or was already stopped).
- A session seems stuck or output looks garbled: check the raw log at
  `/tmp/mud_client_<host>_<port>.log`, and consider `disconnect` followed by
  a fresh `connect` -- reconnecting logs the same character back in at
  wherever it last was (or wherever the server puts a fresh login).

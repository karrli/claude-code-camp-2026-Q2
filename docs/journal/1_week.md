## Technical Goal
Understand the architecture of a Baseline Agent and how the parts interact. I will follow the Ruby path.

## Technical Uncertainty
I'm uncertain about the agent’s interaction with the MUD since playing involves many instructions that translate into strategies to accomplish a goal in the game. e.g. Sleeping, resting, eating, drinking, considering opponents, mapping, etc.
I think the agent will be able to play the MUD under restricted conditions.

## Technical Observerations
While implementing your technical experiements what key observsations can you share which would be useful for someone to know trying to replicate your experience.

It is important to note that tasks are agents/subagents, the agent implemented in week 1 is the Player (multi task) so it’s interesting how in the step 12 Context the class Boukensha::Tasks::Base and Boukensha::Tasks::Player change in the file config.rb to allow context-window management.

The log-viewer I implemented is in javascript and renders `.jsonl` session logs, it’s not static so it’s automatically updated but only follows the news session. The server is started by running week1_baseline/bin/log_viewer.

I did not see much value implementing the TUI since ‘bubbletea’ and any `lipgloss` call crashed with `fatal error: bad sweepgen in refill’
on macOS x86_64; I opened an issue on github, it is also documented at 11_tui/crash_report/bubbletea_lipgloss_crash_report.md. I worked around the error by using bubbletea only but noticed a log viewer would be more helpful by showing more session information. 

Context notably improved the efficiency by knowing the model's context window and running token usage; however, the agent was not able to complete some simple goals such as “Finding the Swordsmen Guild” or just to practice the kick since it lacks long-term memory and has no access to  previous conversations. I also noticed that the agent was less likely to accomplish the goal if you asked it to go somewhere far from where it was.  In that case the agent will just start following random roads and the context limit would be reached without the agent accomplishing the goal.

## Technical Conclusions
The agent needs more tools to allow it to interact programmatically with the MUD, just like a human player would do, based on a strategy. It also needs long term memory.

## Key Takeaway
There was a huge advancement on building a baseline agent this week; however, the agent needs a strategy according to the situation in which is playing. It needs to know what to do in each step such as looking, finding exist, mapping so to get a truly capable agent more tools and observability is needed.
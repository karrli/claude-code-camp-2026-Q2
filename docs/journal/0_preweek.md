## Technical Goal
Explore agent architectures using the same goal  at tbaMUD.
Understand it’s use and if the responsibilities overlap.

[Ref 1] Examples of Agent Architectures That Scale With Effort:
1. An agent file with referenced files eg. AGENT.md, @~/docs/*.MD
2. Agent Skills driven by main agent eg. ~/.skill
3. Filesystem Subagent driven by a coding harness or Coding Agent SDK eg. ~/subagents
4. AI workflow automation platform eg. n8n

## Technical Uncertainty
1. Agent file with referenced files eg. AGENT.md, @~/docs/*.MD
I’m uncertain if Claude han accomplish the goal mantaining a persistent session.
I’m uncertain if Claude will follow thoroughly the instructions in the files/skills.
I’m uncertain of which measures can I take to guarantee that the coding harness follows the instructions and does not try to deviate by taking prohibited/unsafe shortcuts.
I’m uncertain about how will the agent manage persistent memory.

2. Agent Skills driven by main agent eg. ~/.skill
I’m uncertain about how will the skill manage  memory, if it will update the files at every iteration only with the newest goal or whether it will keep a track of every goal.
I'm uncertain if the skill is useful for completing a big goal.
I'm uncertain about the observability of the skill, cost, toke usage and reasoning.

## Technical Hypotheses
1.I think the coding harness will have trouble maintaining a persistent session and accomplishing the goal without using an MCP that allows it to connect to external tools and data sources, I think it will need constant user interaction.

2. Agent Skills driven by main agent eg. ~/.skill
I think the coding harness will be able to complete simple goals but fail with big goals, since a strategy will be needed. The reasoning will be unclear and without a player strategy.


## 1. An agent file with referenced files eg. AGENT.md, @~/docs/*.MD
We should attempt to create an agent file and see if it can connect to the MUD and complete a simple goal: eg. "Find the bakery and list the menu."

## 2. Agent Skills driven by main agent eg. ~/.skill
A very common way to drive specific functionality is via Agent Skills which is an open format for agents adopted by many coding harnesses and agent SDKs.

We should create a skill that has its own script to help it connect to a MUD, we should attempt to have it manage its own data.

## Technical Observations
Haiku on high effort successfully connected  to the MUD but I specified it to use telnet.
The coding harness tries to access other folders to accomplish the goal. It tried to access preview data/world/shp folder but I denied and ask it to follow the instructions. 
 The connection was not persistent. Even with Sonnet  the agent  was reconnecting and creating a new throwaway character each time, losing state. It  explored systematically the area but after failure to find the bakery in an area asked for permission to explore another each time.
Either with Haiku or Sonnet the coding harness skipped CLAUDE.md instructions and didn’t update the memory files until I asked why wasn’t it updating the files. 

2. Agent Skills driven by main agent eg. ~/.skill
The skill can complete simple goals, it was succesful for finding the Swordsman Guild. 
The skill can mantain a telnet reliable connection using the script.
Big goals seem imposible to compleate without adecquate break down of the strategy, subtasks, reasoning and very limited visibility on progress and memory. 

## Technical Conclusions
The coding harness tries to access other folders even when the intructions are clear at the CLAUDE.md file. It's not clear the hierarchy order of instructions that the agent follows as it's supposed to check the intructions in the file first. Still to be defined if asking for a plan first could help.
Better prompts and more information help the agent but is not time and cost efficient to keep providing it at each iteration.

2. Agent Skills driven by main agent eg. ~/.skill
Complex goals are very hard to accomplish since there is no control over execution and planning. You need to provide a clear strategy to the agent, goals need to be decomposed; however, memory management is limited.Observability is limted as well.
Claude code's agentic loop is useful for simple goals but a custom agentic loop would provide more control over execution, planning, and memory.


## Key Takeaway
A  customized agentic loop is necesary for an agent to perform the goal efficiently. Mere instructions are not sufficient.

2. Agent Skills driven by main agent eg. ~/.skill
A custom agent loop is needed for planning,memory and observability.


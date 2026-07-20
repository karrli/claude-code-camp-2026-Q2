## Technical Goal
Explore agent architectures using the same goal  at tbaMUD.
Understand it’s use and if the responsibilities overlap.

[Ref 1] Examples of Agent Architectures That Scale With Effort:
1. An agent file with referenced files eg. AGENT.md, @~/docs/*.MD
2. Agent Skills driven by main agent eg. ~/.skill
3. Filesystem Subagent driven by a coding harness or Coding Agent SDK eg. ~/subagents
4. AI workflow automation platform eg. n8n
5. Use a generic AI Agent SDK that leverages plug and plays generic AI packages.
6. Use low level first-party LLM SDKs and write our own agentic loop
7. Use REST APIs directly, write our own agentic loop:
The agentic loop is model-driven orchestration with middleware programmatic guidance
The agentic loop is code-driven orchestration


## Technical Uncertainty
I’m uncertain if Claude han accomplish the goal mantaining a persistent session.
I’m uncertain if Claude will follow thoroughly the instructions in the files/skills.
I’m uncertain of which measures can I take to guarantee that the coding harness follows the instructions and does not try to deviate by taking prohibited/unsafe shortcuts.
I’m uncertain about how will the agent manage persistent memory.

## Technical Hypotheses
I think the coding harness will have trouble maintaining a persistent session and accomplishing the goal without using an MCP that allows it to connect to external tools and data sources, I think it will need constant user interaction.

## 1. An agent file with referenced files eg. AGENT.md, @~/docs/*.MD
We should attempt to create an agent file and see if it can connect to the MUD and complete a simple goal: eg. "Find the bakery and list the menu."

## Technical Observations
Haiku on high effort successfully connected  to the MUD but I specified it to use telnet.
The coding harness tries to access other folders to accomplish the goal. It tried to access preview data/world/shp folder but I denied and ask it to follow the instructions. 
 The connection was not persistent. Even with Sonnet  the agent  was reconnecting and creating a new throwaway character each time, losing state. It  explored systematically the area but after failure to find the bakery in an area asked for permission to explore another each time.
Either with Haiku or Sonnet the coding harness skipped CLAUDE.md instructions and didn’t update the memory files until I asked why wasn’t it updating the files. 

## Technical Conclusions
The coding harness tries to access other folders even when the intructions are clear at the CLAUDE.md file. It's not clear the hierarchy order of instructions that the agent follows as it's supposed to check the intructions in the file first. Still to be defined if asking for a plan first could help.
Better prompts and more information help the agent but is not time and cost efficient to keep providing it at each iteration.


## Key Takeaway
A  customized agentic loop is necesary for an agent to perform the goal efficiently. Mere instructions are not sufficient.


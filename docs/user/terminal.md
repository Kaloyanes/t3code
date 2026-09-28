# Terminals

Use **New Terminal** to open a shell for the current thread. **Workspace runs**
contains project actions shared by threads using the same checkout. Closing a
workspace run view leaves its process running; select the run to reopen its output.
Use **Stop workspace run** to end it and **Start workspace run** to restart it.
Workspace runs cannot be split.

## Terminal history

Each thread terminal keeps up to 5,000 lines and 8 MiB of scrollback on its environment
server. T3 Code removes the oldest output when either limit is reached. A long
line can be shortened at the start. New terminal output is not truncated.

These limits apply when you reconnect and when T3 Code restores saved terminal
history. A client can show less scrollback than the server keeps.

# Server-owned, isolated scheduled agent runs

Time-based automations should be durable state owned by the environment server, and each scheduled run should create an independent thread in a dedicated Git worktree. This keeps execution with the environment's credentials and filesystem, survives client disconnects, avoids context and workspace collisions, and makes lifecycle changes and missed-run recovery observable. Runs must not fall back to the main checkout or silently switch providers.

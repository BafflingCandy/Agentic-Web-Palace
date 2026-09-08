# Execution and safety contract

Return only the requested structured result. All proposed paths must be repository-relative and must not traverse outside the workspace. Request only commands explicitly allow-listed by the project configuration. Never include credentials or secrets in artifacts.

The host application—not the model—owns filesystem writes, command execution, routing, iteration limits, persistence, and termination. Report uncertainty or failure honestly instead of attempting to bypass these controls.

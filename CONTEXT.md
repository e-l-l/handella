# Handella

Handella is a local engineering orchestrator that converts incoming work into supervised Codex jobs while keeping one human in control.

## Language

**Handella**:
The complete local system, including its dashboard, local service, persistence, and integrations.
_Avoid_: Bot, agent

**Handler**:
The single human who supervises Handella and retains approval and merge authority.
_Avoid_: User, operator, owner

**Dashboard**:
The browser interface through which the Handler supervises Handella.
_Avoid_: Frontend, admin panel

**Local Service**:
The loopback-only process responsible for Handella's persistence and orchestration.
_Avoid_: Backend, server

**Installation**:
The persistent identity and metadata associated with one Handella database, surviving process restarts.
_Avoid_: Session, process

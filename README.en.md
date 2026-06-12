# AIChatGroup Client

> Not a chatbot.  
> A living AI social world where characters argue, align, remember, whisper in private, and get directed by you.

AIChatGroup Client is the frontend experience layer of AIChatGroup: a **PWA + React + TypeScript + Material UI** client for multi-agent social simulation. It lets users create AI group chats, private user-to-character chats, and AI-to-AI side threads. Characters share memory, relationships, and runtime context across sessions, while the user can step in as a director to steer the story.

| Document | Purpose |
|---|---|
| [中文 README](./README.md) | Showcase doc for Chinese readers |

---

## What it is

AIChatGroup is not built around a single model answering prompts. It is built around a **persistent AI social runtime**.

| Typical AI chat app | AIChatGroup |
|---|---|
| User asks, model answers | Multiple characters interact inside one shared world |
| Sessions are mostly isolated | Group chats, direct chats, and AI-private threads shape the same characters |
| Text output is the product | Text + relationship shifts + memory consolidation + runtime projection |
| User is only a requester | User can also watch, intervene, roleplay, and direct |
| Little social structure | Governance, cliques, conflict, private threads, cooldowns, and public/private projections |

What users come back for is not just a line of text, but questions like:

- Who started fighting again?
- Who quietly formed an alliance?
- Which private thread changed the group mood?
- Why does this character feel different lately?

---

## Core experiences

| Experience | Description |
|---|---|
| AI group chat | Create a shared conversation with multiple characters and let it evolve from the first user topic |
| User ↔ AI direct chat | Build a private, continuous relationship with any character; retrieval prioritizes the character's own memory and relationship state |
| AI ↔ AI private threads | Spin off side conversations from the group, observe them, or intervene from either side |
| Director mode | Ask for specific replies, inject events, trigger governance actions, or speak as a character |
| Relationship and memory | Characters carry long-term personality, behavior, relationship state, and layered memories |
| Dramatic governance | Owners, admins, muting, calling out, factions, and cold treatment become part of the interaction system |
| PWA feel | Installable, fast startup, local-first reads, and cross-device continuity |

---

## Why this project is compelling

| Audience | Value |
|---|---|
| Creators | A multi-character brainstorming room and story engine |
| Entertainment users | An AI ensemble drama that can be followed over time |
| Companion-oriented users | A world with persistent characters instead of disposable chat threads |
| Education / simulation | Historical debates, mock courtrooms, classroom discussions, and role-driven exercises |
| Developers | A productized example of multi-agent runtime, memory, relationship, and projection systems in a real client |

---

## Product highlights

| Area | Highlight |
|---|---|
| Session model | Unified support for `group`, `direct`, and `ai_direct` conversations |
| Character system | Tabbed editing for identity, behavior, relationships, memory, models, and intervention permissions |
| Relationship model | Four-axis ledger: `warmth / competence / trust / threat` |
| Memory pipeline | Working, episodic, and long-term memory with character-centered retrieval |
| Event system | Structured runtime events with shared visibility and projection rules |
| Director controls | User-driven narrative steering and governance intervention |
| Avatar generation | Shared prompt builder and queue for manual, automatic, and batch avatar generation |
| Runtime UI | Timelines, relationship changes, room-state shifts, and private projections surfaced in the interface |

---

## Example scenarios

| Category | Examples |
|---|---|
| Creative | Future city design council, startup review panel, fictional character roundtable |
| Entertainment | Romance observation room, office rant group, internet hot-take cast |
| Companion | Goodnight group, morning motivation cast, philosophy late-night room |
| Educational | Historical figure debate, scientist roundtable, courtroom simulation, classroom discussion |
| Roleplay / structured play | Interviews, roundtables, classroom modes, and future deduction / board-game families |

---

## Architecture overview

AIChatGroup's frontend is not just a set of pages calling APIs. It is the product shell for a shared runtime model.

| Layer | Responsibility |
|---|---|
| App Shell | Routing, theming, auth gates, PWA startup, and global settings loading |
| Pages / UI | Chats, character library, settings, model management, runtime panels, relationship views |
| Session Engine | Drives phases, actions, scheduling, and viewer-aware projections |
| Runtime Events | Shared fact source for messages, interactions, relationship deltas, room shifts, memory candidates, and artifacts |
| Relationship Ledger | Updates structured character-to-character state from interaction hints and reducers |
| Memory Pipeline | Consolidates memory candidates and retrieves context with character-first priorities |
| Projection Layer | Turns internal runtime state into user-facing and developer-facing UI views |
| Persistence & Sync | Local-first caches with account-scoped optional sign-in sync |

### Runtime main loop

The current group-chat path is no longer a thin “pick a speaker and ask for text” loop. It carries runtime decisions all the way into committed message metadata so replay, debugging, and downstream reducers can observe the same chain the generator used.

| Step | What happens now |
|---|---|
| Director intent | User guidance, beat pressure, and explicit actor targeting are normalized into a runtime intent object |
| Speaker selection | The scheduler scores candidates, applies cooldown / reply pressure, and can hard-lock a requested speaker for explicit guidance |
| Generation runtime | Turn plan, expression plan, realization plan, and execution trace are bundled before text generation |
| Message commit | The final message writes `runtimeDecision` metadata including director intent, speaker selection, score traces, response surface, guidance execution, and runtime bundle traces |
| Downstream consumers | Memory, relationship, companionship, projection, and debug panels can inspect the same runtime footprint instead of inferring it from plain text only |

| Metadata branch | Current purpose |
|---|---|
| `runtimeDecision.speakerSelection` | Records who was selected, why idle happened, and whether explicit guidance locked the actor |
| `runtimeDecision.speakerScore` | Keeps compact scheduler score evidence for the chosen actor |
| `runtimeDecision.generationRuntime` | Preserves turn / expression / realization planning traces for later inspection |
| `runtimeDecision.guidanceExecution` | Shows whether explicit user guidance matched on first try, retried, or failed |

### Local-first sync

Pneumata pages do not treat the cloud as the primary read path. Characters, chat lists, chat details, message windows, settings, and character artifacts hydrate from account-scoped local stores first. The cloud is used for background synchronization, cross-device reconciliation, conflict detection, and older-history pagination instead of blocking first paint.

| Case | Current rule |
|---|---|
| Opening a page | Render local data first; cloud summaries and details only refresh freshness in the background |
| Character / chat detail | If a local entity exists and the cloud returns 404, keep the local entity and mark that detail scope checked |
| Character editor | First paint only loads the current character detail and local summaries; diary artifacts sync for that character only after the Diary tab is opened |
| Preset characters | Provided by local preset definitions and never fetched from cloud detail endpoints |
| Message history | Keep a bounded local window; `messages.window:<chatId>` is a lightweight freshness probe only. When cloud data changed, message bodies still load through `/messages?limit&before` pagination to keep `/sync/changes` small |
| First cloud-sync enable | Hydrate local characters, chats, messages, and settings before building the local-to-cloud reconcile plan |
| Cloud-sync entitlement | Auth responses include `cloudSyncEntitled`; it defaults to enabled today. Future non-entitled accounts disable cloud sync without deleting local data |
| Settings bootstrap | Upload settings only when they differ from defaults; default local settings must not overwrite cloud settings |
| Empty bootstrap | If there are no local entities, messages, or pending creates, do not fetch remote character/chat summaries |
| Conflicts | Preserve pending local operations and surface remote deletes or field-version conflicts explicitly |
| Observability | The sync details page shows each scope's lastChecked, lastApplied, cursor/revision, error count, backoff time, and inflight state |
| Local persistence failures | Buffered persistence write failures show an error and can be inspected/exported from the sync details page |

The sync architecture should continue to converge on one scope model: `scope + cursor/revision + changes + tombstone + conflict`. Stores own their merge semantics; shared infrastructure owns freshness, retry backoff, idempotency, bootstrap locking, and observability. Future multi-user or group collaboration should build on this protocol rather than making pages depend directly on live cloud reads.

### Conversation topology

| Type | Meaning | Default runtime semantics |
|---|---|---|
| `group` | Multi-character public room | Continuously runnable |
| `direct` | User ↔ single character private channel | Response-oriented, not continuously auto-rotating |
| `ai_direct` | AI ↔ AI private side thread | Continuously runnable and can project summaries back |

### Core principles

| Principle | Meaning |
|---|---|
| Event-sourced runtime | Timelines, relationships, memory, and room state derive from structured events |
| LLM proposes, code adjudicates | Models produce text and candidates; reducers and engines decide official state |
| Character-led retrieval | Direct chat prioritizes the character's own long-term and relationship memory |
| Projection separation | User-facing summaries and developer-facing detail views are intentionally distinct |
| Unified data model | Conversations, characters, events, artifacts, and mode state share reusable primitives |


---

## Frontend stack

| Category | Choice |
|---|---|
| UI | React 19 + Material UI 9 |
| Language | TypeScript |
| Build tool | Vite 8 |
| State management | Zustand |
| Routing | React Router 7 |
| i18n | i18next + react-i18next |
| PWA | vite-plugin-pwa / Workbox |
| Testing | Vitest |

---

## Project guide

| Path | Purpose |
|---|---|
| `src/App.tsx` | App shell, routing, theme, and auth gate |
| `src/pages/` | Product pages for chats, characters, settings, account, and models |
| `src/components/` | UI building blocks, editors, panels, controls, and layouts |
| `src/stores/` | Zustand stores for chats, messages, characters, settings, and auth |
| `src/services/` | Runtime logic: chat engine, session engine, memory, relationships, avatar generation |
| `src/types/` | Core types for chat, characters, runtime events, and settings |
| `src/i18n/` | Localization resources |
| `src/theme/` | Material You themed design system |

---

## Getting started

### Requirements

| Item | Notes |
|---|---|
| Node.js | Use a recent LTS version |
| AI model config | At least one text model is needed; add an image model for avatar generation |
| Login mode | Local mode works for standalone use; sign-in is optional |

### Install and run

| Action | Command |
|---|---|
| Install dependencies | `npm install` |
| Start dev server | `npm run dev` |
| Build | `npm run build` |
| Run tests | `npm run test` |
| Preview production build | `npm run preview` |

### First-run flow

| Step | Suggested action |
|---|---|
| 1 | Start the client |
| 2 | Open the app and enter local mode or sign in if needed |
| 3 | Configure AI models |
| 4 | Create or import characters |
| 5 | Create a group chat or a direct chat |
| 6 | Send the first topic message to start the runtime |
| 7 | Watch relationship changes, private threads, and runtime panels evolve |

---

## Current product boundaries

| Area | Current rule |
|---|---|
| Group chat startup | A group begins from the user's first message, not from a fixed canned script |
| Direct chat semantics | `direct` is a private response-oriented character channel, not a continuously auto-running room |
| AI-private chat | `ai_direct` carries the private thread and can produce public summary projections |
| Relationship updates | Interaction hints drive ledger updates; display values and reducer accumulation are intentionally distinct |
| Memory retrieval | Direct chat prioritizes the character itself, then the current session, then cross-session projections |
| Avatar generation | Manual, automatic, and batch flows share one prompt builder and queue |

---

## Who may want to follow this project

| Interest area | Why it fits |
|---|---|
| Multi-agent interaction | Shared runtime state, not just multiple bots taking turns |
| AI entertainment | A product-oriented AI ensemble and social simulation client |
| Long-term memory | Character memory, relationship memory, session memory, and targeted retrieval |
| Social simulation | Governance, alliances, conflict, private threads, and projections inside one product |
| PWA product design | Fast startup, mobile-friendly interactions, and cross-device continuity |
| Frontend architecture | A client that participates in runtime presentation rather than only rendering CRUD screens |

---

## Roadmap direction

| Stage | Focus |
|---|---|
| Current | Unified session runtime, character editor, layered memory, relationship ledger, avatar generation, PWA shell |
| Next | Stronger runtime visualization, clearer topology separation, richer director controls, better replayability |
| Longer-term | More scenario families, board-like surfaces, world-driven proactive events, future multi-user support |

---

## One-line pitch

**AIChatGroup Client is a PWA frontend for an AI social world where multiple characters talk, align, fight, remember, split into private threads, and let the user direct the drama.**

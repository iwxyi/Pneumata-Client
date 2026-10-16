# Sense Murmur

**AI characters who carry their experiences, relationships, and traces of everyday life across conversations.**

Sense Murmur is an AI interaction app built around persistent character lives. Create characters and spend time with them in group conversations, private chats, stories, and learning rooms. Their identities are shaped by memories, relationships, emotions, and what happens around them. Beyond chat, they can leave diaries, letters, moments, plans, and work you make together.

[Try It Online](https://sense.lyixi.com) · QQ community: 571886312 · [简体中文](./README.md)

## At a Glance

| Capability | What you can experience |
|---|---|
| Multi-character rooms | Characters respond to one another, argue, hold back, or form rapport; you can direct a speaker or introduce an event |
| Persistent characters | Identity, memory, relationships, emotion, and the current room influence each response |
| Layered memory | Personal history, impressions of others, shared room history, and significant events are stored and recalled in context |
| Relationships and companionship | Closeness, trust, caution, and short-lived emotion affect tone, stance, addressing, and care |
| Life records | Birth letters, diaries, farewell letters, social moments, and calendar activities |
| Multimedia | Image input and generation, character visuals, voice input and playback, rich messages, files, and reference images |
| Assistant and Agent | Create and revise documents, code, diagrams, tables, images, and interactive pages |
| Different rooms | Group chat, story, deliberation, learning, one-to-one chat, and private character threads |
| Personal control | Choose models and preferences, keep local data first, and enable account sync when needed |

## What “Digital Life” Means Here

A digital life in Sense Murmur is **your persistent character instance**. The term makes no claim that AI is conscious. You define a character's identity, personality, appearance, habits, and boundaries; your shared experiences then become part of that character's history.

Two people can begin with the same character concept and arrive at different relationships. A promise, an argument, or a moment of support can affect what the character remembers and how they respond. When the character moves to another room, their longer-term history remains relevant, while the new room supplies its own roles and circumstances.

Before a response, the runtime assembles the character's current situation:

```text
Identity and growth
  + layered memories and shared experiences
  + relationship with the current person
  + recent emotion and unfinished concerns
  + room topic, rules, and group dynamics
  -> current perspective and expression context
  -> a reply, an action, or a choice to stay silent
  -> new messages, events, and validated state changes
```

This involves character records, memory retrieval, relationship updates, speaker scheduling, generation protocols, and state commits. The visible result is a character who may remember an earlier conversation or react differently after a disagreement; the engineering work keeps those changes grounded and available later.

You can see those systems connect in ordinary use:

- A disagreement in a group leaves an interaction event and may affect how characters see each other. A later diary can reflect on it from one character's perspective, and a private chat can carry the aftereffect forward.
- Upload a reference image and a vision-capable model can summarize what it sees. Later, a request to use “this image's style” can resolve the relevant image and send the selected reference to the image service.
- Completing an exercise in a learning room leaves answer and assessment evidence. The room can use its topic state, review needs, and saved materials when you return.

### Character Through Behavior

A character profile includes values, motivations, fears, habits, and speaking style. The current relationship and emotion shape whether they approach, defend, question, avoid, or let somebody else speak. Emotion can change quickly after an interaction, while lasting relationship changes need stronger evidence.

A group room also considers the topic, who has spoken recently, outstanding replies, relationships between members, and the room's social atmosphere. Direct requests and open conversation follow different paths. A character can answer, offer a short reaction, or remain silent.

The runtime supports restraint, bias, care, hesitation, and disagreement while retaining the character's identity. Results still depend on the model; repeated patterns and incorrect references remain areas of active evaluation.

## Memory, Relationships, and Emotion

### Memory With Different Scopes

Sense Murmur handles a character's self knowledge, memories about particular people, shared room history, scenario progress, and important events separately. Observable experiences can become memory candidates, then pass through validation and targeted retrieval for later use.

“You dislike overly sweet drinks” is a preference. “You ordered a sweet drink, left half of it unfinished, and made it a shared joke” is an experience. The character can use that history naturally when recommending a drink later. You can inspect and organize memories in the character view.

Long-term facts such as relationships, promises, and calendar plans need structured results, explicit actions, or traceable events. A stray word in a message should not manufacture shared history.

### Relationships With Different People

Characters have relationships with you and with one another. The system tracks dimensions such as warmth, respect for competence, trust, and perceived threat, alongside the events and impressions behind them. Someone can respect another character's ability while doubting their judgment. A temporary alliance in one room need not erase a long-term bond.

Relationships contribute to who speaks and how: who helps, challenges, yields, or becomes guarded. Context from a private conversation can inform the same character in a group, story, or discussion while respecting visibility rules.

### Emotion and Companionship

Immediate emotion affects attention and expression in the current turn and can leave a short-lived aftereffect. Over time, shared names, habits, promises, and ways of caring become part of a relationship's rhythm.

Private chats can use more detailed personal context. Proactive care and diary generation are controlled by settings, timing, and context. Public rooms receive only what can be shared safely.

## A Life Beyond the Chat Window

**Diaries and letters.** Characters can write birth letters, diaries, and farewell letters. Diaries draw on recent experiences, relationships, emotions, and unfinished thoughts. Read them in the Letters and Diary view, filter by character, and manage deleted entries. Automatic diary generation can be switched on or off.

**Moments and calendar.** Moments show everyday character activity and interaction. The calendar tracks plans and activities. These views give room events a place to echo beyond chat; automatic updates depend on settings, model access, and runtime conditions.

**Visual identity.** Characters can have avatars and visual references, with image generation for new material. Group chats can also have their own avatar and background. Character visuals and message images have separate ownership and storage rules.

## Rooms and Ways to Participate

- **Group chat:** Bring a cast into one conversation. They can follow the topic, respond to one another, or hold back. Pause, direct a reply, speak as a character, or introduce an event.
- **One-to-one and character threads:** Talk privately with a character; characters can also have separate private threads. Each channel has its own visibility rules.
- **Story rooms:** Set the opening, follow narration and dialogue, and make branching choices with characters who already have history together.
- **Deliberation:** Let different viewpoints examine, challenge, and summarize a question.
- **Learning:** Set a goal and teaching style. Topics, exercises, answers, evidence, and review records accumulate over time.

These four group-room families and their presets are available from the standard creation flow. Other training scenarios, deduction games, and world simulation are being validated in developer mode.

## Images, Voice, and Rich Messages

Conversations can contain Markdown, code, images, files, and voice. Upload an image or file and discuss it with a model that supports the appropriate input. Characters and the assistant can generate images on request; images can become references for further variants.

With suitable services configured, use voice input, hear spoken replies, and assign voices to characters. Text, images, and speech can appear in the same interaction. Media tasks show progress and failure states. Availability depends on your selected models and providers.

## Assistant and Agent: Work You Can Keep

The general assistant handles questions, explanations, and writing. Optional Agent capabilities turn a conversation into managed work:

| Artifact | What it supports |
|---|---|
| Documents and code | Reports, plans, tutorials, snippets, and multi-file text projects |
| Diagrams and data | Diagram source, tables, JSON, and CSV that can be queried or revised |
| Interactive pages | Small tools, forms, exercises, and previewable HTML pages |
| Images | Generation from descriptions or references, with subsequent variants and versions |

The Agent identifies the task and target, prepares changes, validates them, and commits new versions. You can revisit, preview, copy, and download artifacts; ambiguous edits ask for clarification. Search, file access, and page execution depend on enabled tools and permissions.

Learning rooms can reuse artifact capabilities for materials and exercises.

## Data, Models, and Access

Characters, rooms, and conversations load from local data first. Configure your own models in local mode or sign in to use available platform models. Current models, pricing, and permissions are shown in the app. An AI gateway and Key management are also available for compatible external tools.

Account sync is optional. Importing guest data into an account requires confirmation, and account data remains separate. Artifact content is local by default; eligible text artifacts can sync when the account has permission and you enable it. Cached content remains viewable offline, while AI generation needs network access.

Use Sense Murmur in a browser or install the PWA. The project also includes desktop and Android packaging.

## Get Started

1. Open [sense.lyixi.com](https://sense.lyixi.com) and choose local mode or sign in.
2. Configure a model or select one available to your account.
3. Choose a preset character or create your own.
4. Start a private chat or create a group, story, deliberation, or learning room.

Begin with a character and a topic, then explore the memories, relationships, diary entries, and artifacts that follow.

## Project Status and Community

Sense Murmur already connects character creation and room interaction with memory, relationships, diaries, letters, multimedia, and Agent artifacts. The quality of long-term character behavior is still being refined: models can repeat themselves, miss a memory, or refer to the past incorrectly. Some features require particular models, account permissions, or device capabilities.

Share feedback and reproducible scenarios in QQ group 571886312. Remove private conversations and credentials before posting.

Developers can read the [full project's technical README](https://github.com/lyixi/Pneumata#readme). The frontend uses React, TypeScript, MUI, and Vite. Run this directory with `npm install` and `npm run dev`; local mode needs a configured model.

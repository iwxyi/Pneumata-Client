# Sense Murmur

Sense Murmur is an AI app for conversations with multiple characters, ongoing companionship, and interactive stories.

Create a cast you enjoy spending time with. Talk about your day, exchange ideas, or step into a story together. Memories, relationships, and shared experiences give the next conversation some history.

**[Try It Online](https://sense.lyixi.com)** · QQ community: 571886312 · [简体中文](./README.md)

## What You Can Do

### Join a Group Conversation

Choose a few characters and start a topic. Each brings a different personality and way of speaking. They can respond to you, talk to each other, disagree, or follow a detail that catches their attention.

Take part or watch for a while. You can request a particular speaker, speak as a character, introduce an event, and pause the room when you need a break.

### Get to Know a Character

Open a private conversation when you want a quieter space.

Give your character a background, personality, voice, and boundaries. Shared experiences and relationship history can become part of future conversations. You can inspect and organize character memories, and familiar characters can draw on that background in other rooms.

An argument, a small promise, or a moment of support can influence how a character responds later. Making that continuity feel convincing is a central focus of the project.

Public rooms, your private conversations, and private threads between characters have separate visibility rules that also govern what can return to a public room.

### Step Into a Story

Set a scene and a direction, then follow narration, character dialogue, and branching choices through a story room.

Read along or take a role yourself. Existing relationships add context to new situations and choices. For original characters, ensemble casts, and interactive fiction, a simple opening is enough to get started: a reunion, a school club, or an unexpected trip.

Edit a message, regenerate a reply, or switch conversation branches to explore another direction.

### Explore an Idea Together

Use a deliberation room to examine a question through different viewpoints, challenges, and summaries. Try it for a creative premise, a choice between plans, or a fresh look at an idea.

### Work Toward a Learning Goal

Choose one character as a learning companion and set a goal. A learning room helps organize topics, generate materials and exercises, and use learning records to guide the next step. Revisit what you have studied and where you need more practice.

Start with a book you want to understand or a technical concept you want to learn. Choose a casual or more demanding teaching style and how exercises should be assessed.

## Get Started

1. Open [sense.lyixi.com](https://sense.lyixi.com) and choose local mode or sign in.
2. Configure an available model or select a platform model your account can use.
3. Choose preset characters or create your own.
4. Create a room and send the first message.

For a quieter start, open a private character chat. For an ensemble, bring a few contrasting personalities into the same room.

## More to Explore

### Assistant and Creative Work

A general assistant is available for questions, writing, and organizing ideas.

Enable optional Agent capabilities to save results as documents, code, diagrams, HTML tools, or structured text. Continue editing, inspect versions, preview, and download your work. A discussion can become a written plan or a small web page you can try.

### Images and Voice

Messages support Markdown, code, and media. With suitable models and services configured, you can generate images and character visuals, use voice input, and play spoken replies.

### Moments and Calendar

Revisit character updates in Moments and activities or plans in the calendar. Automatic posts and activity updates depend on settings and runtime conditions.

### Model Choice

Configure your own model services or use models offered by the platform. An AI gateway and Key management are also available for compatible external tools. Check the app for current models, pricing, and account permissions.

## Continue on Your Devices

Sense Murmur loads existing characters, rooms, and conversations from local data first. It supports installation as a PWA in compatible browsers, and the project includes desktop and Android packaging.

Optional account sync helps you continue across devices. The app asks before importing guest data into an account.

Artifact content is local by default; eligible text artifacts can sync when your account has permission and you explicitly enable it. Check sync status and export important work before switching devices.

Cached content can be viewed offline. AI replies, image generation, and voice services still need network access and suitable providers.

## Project Status

Sense Murmur is in active development. Current work focuses on character differences, memory, relationship continuity, and the story and learning experience.

Other training scenarios, deduction games, and world simulation remain experimental; some are available only in developer mode. Character sharing and a creator ecosystem are future plans.

Conversation quality and memory accuracy depend on the model and context. Repetitive replies, missed memories, and incorrect references still occur. Feedback with a concrete scenario and reproduction steps is useful; remove private conversations and credentials before sharing.

## Development

The frontend uses React, TypeScript, MUI, and Vite. See the [full project's developer documentation](https://github.com/lyixi/Pneumata#readme) for architecture, setup, packaging, and verification commands.

To run a standalone checkout of this client:

```bash
npm install
npm run dev
```

Local mode needs a configured model. Accounts, platform models, and cloud sync require the backend. The full repository uses npm workspaces.

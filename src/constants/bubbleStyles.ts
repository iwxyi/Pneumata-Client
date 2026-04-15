import type { BubbleStyleDefinition } from '../types/bubbleStyle';

export const DEFAULT_AI_BUBBLE_STYLE_ID = 'built-in-classic';

export const BUILT_IN_BUBBLE_STYLES: BubbleStyleDefinition[] = [
  { id: 'built-in-classic', name: 'Classic White', backgroundColor: '#ffffff', textColor: '#111111', borderColor: '#e5e7eb', borderWidth: 1, borderStyle: 'solid', radius: 18, shadow: 'soft', isBuiltIn: true },
  { id: 'built-in-sky', name: 'Sky Blue', backgroundColor: '#eaf4ff', textColor: '#0f2942', borderColor: '#b8d7ff', borderWidth: 1, borderStyle: 'solid', radius: 18, shadow: 'soft', isBuiltIn: true },
  { id: 'built-in-mint', name: 'Mint Cream', backgroundColor: '#e9fbf4', textColor: '#123528', borderColor: '#b7efd6', borderWidth: 1, borderStyle: 'solid', radius: 24, shadow: 'soft', isBuiltIn: true },
  { id: 'built-in-lavender', name: 'Lavender Cloud', backgroundColor: '#f2ecff', textColor: '#342258', borderColor: '#d7c8ff', borderWidth: 1, borderStyle: 'solid', radius: 26, shadow: 'soft', isBuiltIn: true },
  { id: 'built-in-peach', name: 'Peach Note', backgroundColor: '#fff1ea', textColor: '#4d2718', borderColor: '#ffcdb7', borderWidth: 1, borderStyle: 'solid', radius: 14, shadow: 'soft', isBuiltIn: true },
  { id: 'built-in-butter', name: 'Butter Note', backgroundColor: '#fff9d9', textColor: '#4a3a06', borderColor: '#efdb7b', borderWidth: 2, borderStyle: 'dashed', radius: 12, shadow: 'soft', isBuiltIn: true },
  { id: 'built-in-ink', name: 'Ink Gray', backgroundColor: '#2f3338', textColor: '#f6f7f8', borderColor: '#4f5964', borderWidth: 1, borderStyle: 'solid', radius: 8, shadow: 'medium', isBuiltIn: true },
  { id: 'built-in-deepsea', name: 'Deep Sea', backgroundColor: '#16324f', textColor: '#f3fbff', borderColor: '#2f5d87', borderWidth: 1, borderStyle: 'solid', radius: 28, shadow: 'medium', isBuiltIn: true },
  { id: 'built-in-cyber', name: 'Cyber Cyan', backgroundColor: '#0c1d24', textColor: '#aaf8ff', borderColor: '#31d8ee', borderWidth: 2, borderStyle: 'solid', radius: 8, shadow: 'strong', isBuiltIn: true },
  { id: 'built-in-neon', name: 'Neon Violet', backgroundColor: '#1e1430', textColor: '#f7edff', borderColor: '#b379ff', borderWidth: 2, borderStyle: 'dotted', radius: 16, shadow: 'strong', isBuiltIn: true },
  { id: 'built-in-paper', name: 'Journal Paper', backgroundColor: '#f7f1e3', textColor: '#3a2f1f', borderColor: '#cdbfa5', borderWidth: 2, borderStyle: 'dashed', radius: 6, shadow: 'none', isBuiltIn: true },
  { id: 'built-in-rose', name: 'Rose Glow', backgroundColor: '#fff0f5', textColor: '#5a2440', borderColor: '#f3bfd4', borderWidth: 1, borderStyle: 'solid', radius: 30, shadow: 'soft', isBuiltIn: true },
  { id: 'built-in-gradient-dream', name: 'Dream Gradient', backgroundColor: '#f8e1ff', textColor: '#351948', borderColor: '#e5b6ff', borderWidth: 1, borderStyle: 'solid', radius: 30, shadow: 'medium', gradientFrom: '#ffd7f6', gradientTo: '#dbe7ff', gradientDirection: '135deg', isBuiltIn: true },
  { id: 'built-in-gradient-ocean', name: 'Ocean Gradient', backgroundColor: '#d9f5ff', textColor: '#12384a', borderColor: '#94d8ef', borderWidth: 1, borderStyle: 'solid', radius: 22, shadow: 'medium', gradientFrom: '#d7f8ff', gradientTo: '#cfe0ff', gradientDirection: '160deg', isBuiltIn: true },
  { id: 'built-in-gradient-sunset', name: 'Sunset Gradient', backgroundColor: '#ffe3d7', textColor: '#552715', borderColor: '#ffb79d', borderWidth: 1, borderStyle: 'solid', radius: 16, shadow: 'medium', gradientFrom: '#ffe1d2', gradientTo: '#fff0b8', gradientDirection: '160deg', isBuiltIn: true },
  { id: 'built-in-outline', name: 'Outline Minimal', backgroundColor: '#ffffff', textColor: '#1f2937', borderColor: '#94a3b8', borderWidth: 2, borderStyle: 'solid', radius: 18, shadow: 'none', isBuiltIn: true },
  { id: 'built-in-ticket', name: 'Ticket Stub', backgroundColor: '#fffaf0', textColor: '#4a3415', borderColor: '#efc36f', borderWidth: 2, borderStyle: 'dashed', radius: 4, shadow: 'none', isBuiltIn: true },
  { id: 'built-in-comic', name: 'Comic Pop', backgroundColor: '#fff36d', textColor: '#1f1720', borderColor: '#1f1720', borderWidth: 3, borderStyle: 'solid', radius: 10, shadow: 'strong', isBuiltIn: true },
  { id: 'built-in-glass', name: 'Glass Frost', backgroundColor: 'rgba(255,255,255,0.55)', textColor: '#16304a', borderColor: 'rgba(255,255,255,0.9)', borderWidth: 1, borderStyle: 'solid', radius: 24, shadow: 'medium', gradientFrom: 'rgba(255,255,255,0.72)', gradientTo: 'rgba(220,235,255,0.46)', gradientDirection: '180deg', isBuiltIn: true },
  { id: 'built-in-ruby-frame', name: 'Ruby Frame', backgroundColor: '#fff1f3', textColor: '#5b1624', borderColor: '#d9465f', borderWidth: 3, borderStyle: 'solid', radius: 14, shadow: 'medium', isBuiltIn: true },
  { id: 'built-in-forest-chip', name: 'Forest Chip', backgroundColor: '#e7f7ea', textColor: '#17361f', borderColor: '#3d8b4f', borderWidth: 2, borderStyle: 'solid', radius: 999, shadow: 'soft', isBuiltIn: true },
  { id: 'built-in-blueprint', name: 'Blueprint', backgroundColor: '#edf5ff', textColor: '#16365c', borderColor: '#5d8fd6', borderWidth: 2, borderStyle: 'dotted', radius: 8, shadow: 'none', isBuiltIn: true },
  { id: 'built-in-volcano', name: 'Volcano', backgroundColor: '#fff0ea', textColor: '#5a2413', borderColor: '#ff7a45', borderWidth: 3, borderStyle: 'solid', radius: 20, shadow: 'strong', gradientFrom: '#fff1e8', gradientTo: '#ffd3bf', gradientDirection: '160deg', isBuiltIn: true },
  { id: 'built-in-midnight-pill', name: 'Midnight Pill', backgroundColor: '#1b2238', textColor: '#f5f7ff', borderColor: '#7c8ccf', borderWidth: 2, borderStyle: 'solid', radius: 999, shadow: 'medium', isBuiltIn: true },
  { id: 'built-in-candy', name: 'Candy Pop', backgroundColor: '#fff3fb', textColor: '#66264b', borderColor: '#ff8dc7', borderWidth: 2, borderStyle: 'dashed', radius: 28, shadow: 'soft', gradientFrom: '#ffe6f6', gradientTo: '#ffeccf', gradientDirection: '135deg', isBuiltIn: true },
  { id: 'built-in-terminal', name: 'Terminal', backgroundColor: '#111513', textColor: '#8af7a2', borderColor: '#2fa34a', borderWidth: 2, borderStyle: 'solid', radius: 6, shadow: 'none', isBuiltIn: true },
  { id: 'built-in-stamp', name: 'Stamp Edge', backgroundColor: '#fffdf8', textColor: '#5c4521', borderColor: '#d8b46a', borderWidth: 2, borderStyle: 'dotted', radius: 18, shadow: 'none', isBuiltIn: true },
];

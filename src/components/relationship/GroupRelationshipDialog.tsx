import { Avatar, Box, Chip, Dialog, DialogContent, DialogTitle, Stack, Typography } from '@mui/material';
import { useEffect, useRef, useState } from 'react';
import type { AICharacter } from '../../types/character';
import type { GroupChat } from '../../types/chat';
import { projectGroupRelationshipGraphs, type GroupRelationshipGraph, type GroupRelationshipGraphEdge } from '../../services/groupRelationshipGraph';
import { isImageAvatar } from '../../utils/avatar';

interface GroupRelationshipDialogProps {
  open: boolean;
  onClose: () => void;
  chat: GroupChat;
  members: AICharacter[];
  onRefresh?: () => void;
}

const GRAPH_WIDTH = 600;
const GRAPH_HEIGHT = 238;
const STRUCTURE_LABELS: Record<NonNullable<GroupRelationshipGraphEdge['structuralFacts']>[number]['kind'], string> = {
  authority: '上级', duty: '职责', kinship: '亲属', affiliation: '同属', rivalry: '对立', obligation: '约束',
};

function edgeColor(edge: GroupRelationshipGraphEdge) {
  if (edge.axes.threat >= 12 || edge.axes.warmth <= -12 || edge.axes.trust <= -12) return '#D84315';
  if (edge.axes.attachment >= 12) return '#EF6C00';
  if (edge.axes.warmth >= 12 || edge.axes.trust >= 12) return '#2E7D32';
  return '#607D8B';
}

function pairKeyFor(edge: Pick<GroupRelationshipGraphEdge, 'fromId' | 'toId'>) {
  return [edge.fromId, edge.toId].sort().join('|');
}

function nodePosition(index: number, count: number) {
  const layouts: Array<Array<{ x: number; y: number }>> = [
    [{ x: 300, y: 105 }],
    [{ x: 175, y: 105 }, { x: 425, y: 105 }],
    [{ x: 300, y: 44 }, { x: 145, y: 178 }, { x: 455, y: 178 }],
    [{ x: 145, y: 48 }, { x: 455, y: 48 }, { x: 455, y: 178 }, { x: 145, y: 178 }],
  ];
  if (count <= 4) return layouts[count - 1][index];
  const angle = (Math.PI * 2 * index) / count - Math.PI / 2;
  return { x: 300 + Math.cos(angle) * 202, y: 112 + Math.sin(angle) * 78 };
}

function markerId(edge: GroupRelationshipGraphEdge) {
  return `relation-arrow-${edge.key.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

function directionEndpoints(from: { x: number; y: number }, to: { x: number; y: number }) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy) || 1;
  return {
    start: { x: from.x + dx * 29 / distance, y: from.y + dy * 29 / distance },
    end: { x: to.x - dx * 36 / distance, y: to.y - dy * 36 / distance },
  };
}

function formatAxisValue(baseline: number | undefined, adjustment: number | undefined) {
  const base = Number.isFinite(baseline) ? Number(baseline) : 0;
  const delta = Number.isFinite(adjustment) ? Number(adjustment) : 0;
  return `${Math.round(base)} (${delta > 0 ? '+' : ''}${Math.round(delta)})`;
}

function DirectionDetail({ edge, fromName, toName, active, onActiveChange, cardRef }: {
  edge: GroupRelationshipGraphEdge;
  fromName: string;
  toName: string;
  active: boolean;
  onActiveChange: (pairKeys: string[], scrollToCard?: boolean) => void;
  cardRef: (element: HTMLDivElement | null) => void;
}) {
  const axes = [
    ['亲和', edge.baseline.warmth, edge.adjustment.warmth], ['能力', edge.baseline.competence, edge.adjustment.competence], ['信任', edge.baseline.trust, edge.adjustment.trust],
    ['威胁', edge.baseline.threat, edge.adjustment.threat], ['在意', edge.baseline.attachment, edge.adjustment.attachment], ['让位', edge.baseline.deference, edge.adjustment.deference],
  ] as const;
  const pairKey = pairKeyFor(edge);
  return (
    <Box
      ref={cardRef}
      onMouseEnter={() => onActiveChange([pairKey])}
      onMouseLeave={() => onActiveChange([])}
      sx={{ minWidth: 0, p: 0.9, borderRadius: 1, bgcolor: active ? 'action.selected' : 'background.paper', border: '1px solid', borderColor: active ? edgeColor(edge) : 'divider', boxShadow: active ? 1 : 'none', transition: 'background-color 120ms ease, border-color 120ms ease, box-shadow 120ms ease' }}
    >
      <Stack direction="row" spacing={0.55} useFlexGap alignItems="center" flexWrap="wrap">
        <Typography variant="body2" sx={{ fontWeight: 700, color: edgeColor(edge) }}>{fromName} → {toName}</Typography>
        {edge.structuralFacts?.map((fact) => <Chip key={fact.id} size="small" label={STRUCTURE_LABELS[fact.kind]} variant="outlined" />)}
      </Stack>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 0.45, mt: 0.65 }}>
        {axes.map(([label, baseline, adjustment]) => <Typography key={label} variant="caption" sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>{label} {formatAxisValue(baseline, adjustment)}</Typography>)}
      </Box>
      {edge.structuralFacts?.map((fact) => <Typography key={fact.id} variant="caption" sx={{ display: 'block', mt: 0.55, color: 'text.secondary', overflowWrap: 'anywhere' }}>{fact.statement}{fact.evidence ? ` · ${fact.evidence}` : ''}</Typography>)}
      {edge.note && !edge.structuralFacts?.length ? <Typography variant="caption" sx={{ display: 'block', mt: 0.55, color: 'text.secondary', overflowWrap: 'anywhere' }}>{edge.note}</Typography> : null}
    </Box>
  );
}

function RelationshipMap({ graph, highlightedPairs, onHighlightedPairsChange }: {
  graph: GroupRelationshipGraph;
  highlightedPairs: string[];
  onHighlightedPairsChange: (pairKeys: string[], scrollToCard?: boolean) => void;
}) {
  const positions = new Map(graph.nodes.map((node, index) => [node.id, nodePosition(index, graph.nodes.length)]));
  return (
    <Box sx={{ position: 'relative', height: GRAPH_HEIGHT, flexShrink: 0, overflow: 'hidden' }}>
      <svg viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`} preserveAspectRatio="xMidYMid meet" width="100%" height="100%" aria-label="成员关系图" style={{ position: 'absolute', inset: 0 }}>
        <defs>{graph.edges.map((edge) => <marker key={edge.key} id={markerId(edge)} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill={edgeColor(edge)} /></marker>)}</defs>
        {graph.edges.map((edge) => {
          const from = positions.get(edge.fromId)!;
          const to = positions.get(edge.toId)!;
          const pairKey = pairKeyFor(edge);
          const bidirectional = graph.edges.some((item) => item.fromId === edge.toId && item.toId === edge.fromId);
          const { start, end } = directionEndpoints(from, to);
          const dx = end.x - start.x;
          const dy = end.y - start.y;
          const distance = Math.hypot(dx, dy) || 1;
          // Each directed path bends relative to its own direction. Reverse paths
          // therefore occupy the opposite lane instead of collapsing on one curve.
          const bend = bidirectional ? 12 : 0;
          const control = { x: (start.x + end.x) / 2 - dy * bend / distance, y: (start.y + end.y) / 2 + dx * bend / distance };
          const active = highlightedPairs.includes(pairKey);
          const path = `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`;
          return (
            <g key={edge.key} onMouseEnter={() => onHighlightedPairsChange([pairKey], true)} onMouseLeave={() => onHighlightedPairsChange([])} style={{ cursor: 'pointer' }}>
              <path d={path} fill="none" stroke="transparent" strokeWidth="14" />
              <path d={path} fill="none" stroke={active ? edgeColor(edge) : '#90A4AE'} strokeWidth={active ? 2.5 : 1.25} strokeLinecap="round" markerEnd={active ? `url(#${markerId(edge)})` : undefined} opacity={highlightedPairs.length && !active ? 0.18 : active ? 0.94 : 0.48} />
            </g>
          );
        })}
      </svg>
      {graph.nodes.map((node) => {
        const position = positions.get(node.id)!;
        const relatedPairs = Array.from(new Set(graph.edges.filter((edge) => edge.fromId === node.id || edge.toId === node.id).map(pairKeyFor)));
        const nodeActive = relatedPairs.some((pairKey) => highlightedPairs.includes(pairKey));
        return <Box key={node.id} onMouseEnter={() => onHighlightedPairsChange(relatedPairs)} onMouseLeave={() => onHighlightedPairsChange([])} sx={{ position: 'absolute', left: `${position.x / GRAPH_WIDTH * 100}%`, top: `${position.y / GRAPH_HEIGHT * 100}%`, transform: 'translate(-50%, -50%)', display: 'grid', justifyItems: 'center', gap: 0.35, width: 92, textAlign: 'center', cursor: relatedPairs.length ? 'pointer' : 'default' }}>
          <Avatar src={isImageAvatar(node.avatar || '') ? node.avatar : undefined} sx={{ width: 42, height: 42, bgcolor: 'primary.light', border: '2px solid', borderColor: nodeActive ? 'primary.main' : 'background.paper', boxShadow: nodeActive ? 2 : 1 }}>{isImageAvatar(node.avatar || '') ? undefined : node.name.slice(0, 1)}</Avatar>
          <Typography variant="caption" sx={{ maxWidth: '100%', bgcolor: 'background.paper', px: 0.45, borderRadius: 0.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.name}</Typography>
        </Box>;
      })}
    </Box>
  );
}

function RelationshipCards({ graph, highlightedPairs, onHighlightedPairsChange, registerCard }: {
  graph: GroupRelationshipGraph;
  highlightedPairs: string[];
  onHighlightedPairsChange: (pairKeys: string[], scrollToCard?: boolean) => void;
  registerCard: (pairKey: string, element: HTMLDivElement | null) => void;
}) {
  return <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', md: 'repeat(4, minmax(0, 1fr))', xl: 'repeat(6, minmax(0, 1fr))' }, gap: 0.7 }}>
    {graph.edges.map((edge) => <DirectionDetail key={edge.key} edge={edge} fromName={graph.nodes.find((node) => node.id === edge.fromId)?.name || '成员'} toName={graph.nodes.find((node) => node.id === edge.toId)?.name || '成员'} active={highlightedPairs.includes(pairKeyFor(edge))} onActiveChange={onHighlightedPairsChange} cardRef={(element) => registerCard(pairKeyFor(edge), element)} />)}
  </Box>;
}

export default function GroupRelationshipDialog({ open, onClose, chat, members, onRefresh }: GroupRelationshipDialogProps) {
  const projection = projectGroupRelationshipGraphs(chat, members);
  const [highlightedPairs, setHighlightedPairs] = useState<string[]>([]);
  const [refreshRequested, setRefreshRequested] = useState(false);
  const cardRefs = useRef(new Map<string, HTMLDivElement>());
  useEffect(() => {
    if (chat.modeState.initialization?.status !== 'running') setRefreshRequested(false);
  }, [chat.modeState.initialization?.status]);
  const handleHighlightedPairsChange = (pairKeys: string[], scrollToCard = false) => {
    setHighlightedPairs(pairKeys);
    if (!pairKeys.length || !scrollToCard) return;
    window.requestAnimationFrame(() => cardRefs.current.get(pairKeys[0])?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' }));
  };
  const registerCard = (pairKey: string, element: HTMLDivElement | null) => {
    if (element) {
      if (!cardRefs.current.has(pairKey)) cardRefs.current.set(pairKey, element);
    } else cardRefs.current.delete(pairKey);
  };
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xl" fullWidth PaperProps={{ sx: { height: { xs: 'calc(100% - 32px)', sm: 'min(820px, calc(100% - 64px))' }, overflow: 'hidden' } }}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flexShrink: 0 }}>
        群成员关系
        {onRefresh ? <Chip size="small" label={refreshRequested ? '更新中' : '更新关系'} onClick={() => { if (refreshRequested) return; setRefreshRequested(true); onRefresh(); }} clickable={!refreshRequested} variant="outlined" /> : null}
      </DialogTitle>
      <DialogContent dividers sx={{ display: 'flex', minHeight: 0, flexDirection: 'column', overflow: 'hidden', p: 0 }}>
        <Box sx={{ flexShrink: 0, px: 1.5, pt: 1.25, pb: 0.8 }}><Stack spacing={0.75}>{projection.graphs.map((graph) => <RelationshipMap key={graph.key} graph={graph} highlightedPairs={highlightedPairs} onHighlightedPairsChange={handleHighlightedPairsChange} />)}</Stack></Box>
        <Box sx={{ minHeight: 0, flex: 1, overflowY: 'auto', px: 1.5, pb: 1.5 }}>
          <Stack spacing={0.8}>
            {projection.graphs.map((graph) => <RelationshipCards key={graph.key} graph={graph} highlightedPairs={highlightedPairs} onHighlightedPairsChange={handleHighlightedPairsChange} registerCard={registerCard} />)}
            {projection.unconnectedMembers.length ? <Box sx={{ p: 1, borderRadius: 1, border: '1px dashed', borderColor: 'divider' }}><Typography variant="caption" color="text.secondary">暂无关系线</Typography><Stack direction="row" spacing={0.6} useFlexGap flexWrap="wrap" sx={{ mt: 0.6 }}>{projection.unconnectedMembers.map((member) => <Chip key={member.id} size="small" label={member.name} variant="outlined" />)}</Stack></Box> : null}
            {!projection.graphs.length && !projection.unconnectedMembers.length ? <Typography variant="body2" color="text.secondary">当前没有可展示的成员关系。</Typography> : null}
          </Stack>
        </Box>
      </DialogContent>
    </Dialog>
  );
}

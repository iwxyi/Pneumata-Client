import { Avatar, Box, Chip, Dialog, DialogContent, DialogTitle, Stack, Tooltip, Typography } from '@mui/material';
import type { AICharacter } from '../../types/character';
import type { GroupChat } from '../../types/chat';
import { describeGroupRelationshipEdge, projectGroupRelationshipGraphs, type GroupRelationshipGraph, type GroupRelationshipGraphEdge } from '../../services/groupRelationshipGraph';
import { isImageAvatar } from '../../utils/avatar';

interface GroupRelationshipDialogProps {
  open: boolean;
  onClose: () => void;
  chat: GroupChat;
  members: AICharacter[];
}

function edgeColor(edge: GroupRelationshipGraphEdge) {
  if (edge.axes.threat >= 12 || edge.axes.warmth <= -12 || edge.axes.trust <= -12) return '#D84315';
  if (edge.axes.attachment >= 12) return '#EF6C00';
  if (edge.axes.warmth >= 12 || edge.axes.trust >= 12) return '#2E7D32';
  return '#607D8B';
}

function nodePosition(index: number, count: number) {
  if (count === 1) return { x: 50, y: 50 };
  const angle = (Math.PI * 2 * index) / count - Math.PI / 2;
  return { x: 50 + Math.cos(angle) * 34, y: 50 + Math.sin(angle) * 31 };
}

function markerId(edge: GroupRelationshipGraphEdge) {
  return `relation-arrow-${edge.key.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

function directionEndpoints(from: { x: number; y: number }, to: { x: number; y: number }) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy) || 1;
  // Keep both the line and the arrowhead outside the 42px avatar circles.
  const fromOffset = 8;
  const toOffset = 10;
  return {
    start: { x: from.x + dx * fromOffset / distance, y: from.y + dy * fromOffset / distance },
    end: { x: to.x - dx * toOffset / distance, y: to.y - dy * toOffset / distance },
  };
}

function formatAxisValue(value: number) {
  return `${value > 0 ? '+' : ''}${Math.round(value)}`;
}

function DirectionDetail({ edge, fromName, toName }: { edge: GroupRelationshipGraphEdge; fromName: string; toName: string }) {
  const axes = [
    ['亲和', edge.axes.warmth], ['能力', edge.axes.competence], ['信任', edge.axes.trust],
    ['威胁', edge.axes.threat], ['在意', edge.axes.attachment], ['让位', edge.axes.deference],
  ] as const;
  return (
    <Box sx={{ minWidth: 0, p: 0.9, borderRadius: 1, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider' }}>
      <Stack direction="row" spacing={0.55} useFlexGap alignItems="center" flexWrap="wrap">
        <Typography variant="body2" sx={{ fontWeight: 700, color: edgeColor(edge) }}>{fromName} → {toName}</Typography>
        <Chip size="small" label={edge.source === 'room' ? '本群当前' : '角色默认'} variant="outlined" />
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.35 }}>{describeGroupRelationshipEdge(edge)}</Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 0.45, mt: 0.65 }}>
        {axes.map(([label, value]) => <Typography key={label} variant="caption" sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>{label} {formatAxisValue(value)}</Typography>)}
      </Box>
      {edge.note ? <Typography variant="caption" sx={{ display: 'block', mt: 0.55, color: 'text.secondary', overflowWrap: 'anywhere' }}>{edge.note}</Typography> : null}
    </Box>
  );
}

function RelationshipGraph({ graph }: { graph: GroupRelationshipGraph }) {
  const positions = new Map(graph.nodes.map((node, index) => [node.id, nodePosition(index, graph.nodes.length)]));
  const pairs = new Map<string, GroupRelationshipGraphEdge[]>();
  graph.edges.forEach((edge) => {
    const pairKey = [edge.fromId, edge.toId].sort().join('|');
    pairs.set(pairKey, [...(pairs.get(pairKey) || []), edge]);
  });
  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.25, bgcolor: 'action.hover' }}>
      <Box sx={{ position: 'relative', height: 260, minHeight: 220 }}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" width="100%" height="100%" aria-label="成员关系图" style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
          <defs>
            {graph.edges.map((edge) => <marker key={edge.key} id={markerId(edge)} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="4" markerHeight="4" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill={edgeColor(edge)} /></marker>)}
          </defs>
          {graph.edges.map((edge, index) => {
            const from = positions.get(edge.fromId)!;
            const to = positions.get(edge.toId)!;
            const samePairIndex = graph.edges.filter((item) => item.fromId === edge.toId && item.toId === edge.fromId).findIndex((item) => item.key === edge.key);
            const bend = samePairIndex >= 0 ? (index % 2 ? 10 : -10) : 0;
            const { start, end } = directionEndpoints(from, to);
            const midX = (start.x + end.x) / 2 + bend;
            const midY = (start.y + end.y) / 2 - bend;
            const labelY = midY - (bend ? 2 : 1.5);
            return (
              <g key={edge.key}>
                <title>{`${graph.nodes.find((node) => node.id === edge.fromId)?.name || '成员'} → ${graph.nodes.find((node) => node.id === edge.toId)?.name || '成员'}：${describeGroupRelationshipEdge(edge)}${edge.note ? `；${edge.note}` : ''}`}</title>
                <path d={`M ${start.x} ${start.y} Q ${midX} ${midY} ${end.x} ${end.y}`} fill="none" stroke={edgeColor(edge)} strokeWidth="1.25" strokeLinecap="round" markerEnd={`url(#${markerId(edge)})`} opacity="0.88" />
                <text x={midX} y={labelY} textAnchor="middle" dominantBaseline="middle" fill={edgeColor(edge)} fontSize="4" fontWeight="700" stroke="white" strokeWidth="1.8" paintOrder="stroke">{describeGroupRelationshipEdge(edge)}</text>
              </g>
            );
          })}
        </svg>
        {graph.nodes.map((node) => {
          const position = positions.get(node.id)!;
          return (
            <Tooltip key={node.id} title={node.name} arrow>
              <Box sx={{ position: 'absolute', left: `${position.x}%`, top: `${position.y}%`, transform: 'translate(-50%, -50%)', display: 'grid', justifyItems: 'center', gap: 0.4, width: 88, textAlign: 'center' }}>
                <Avatar src={isImageAvatar(node.avatar || '') ? node.avatar : undefined} sx={{ width: 42, height: 42, bgcolor: 'primary.light', border: '2px solid', borderColor: 'background.paper', boxShadow: 2 }}>
                  {isImageAvatar(node.avatar || '') ? undefined : node.name.slice(0, 1)}
                </Avatar>
                <Typography variant="caption" sx={{ maxWidth: '100%', bgcolor: 'background.paper', px: 0.45, borderRadius: 0.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.name}</Typography>
              </Box>
            </Tooltip>
          );
        })}
      </Box>
      <Stack spacing={0.65} sx={{ mt: 1 }}>
        {Array.from(pairs.entries()).map(([pairKey, edges]) => (
          <Box key={pairKey} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 0.65 }}>
            {edges.map((edge) => <DirectionDetail key={edge.key} edge={edge} fromName={graph.nodes.find((node) => node.id === edge.fromId)?.name || '成员'} toName={graph.nodes.find((node) => node.id === edge.toId)?.name || '成员'} />)}
          </Box>
        ))}
      </Stack>
    </Box>
  );
}

export default function GroupRelationshipDialog({ open, onClose, chat, members }: GroupRelationshipDialogProps) {
  const projection = projectGroupRelationshipGraphs(chat, members);
  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>群成员关系</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.25}>
          {projection.graphs.map((graph) => <RelationshipGraph key={graph.key} graph={graph} />)}
          {projection.unconnectedMembers.length ? (
            <Box sx={{ p: 1, borderRadius: 1, border: '1px dashed', borderColor: 'divider' }}>
              <Typography variant="caption" color="text.secondary">暂无关系线</Typography>
              <Stack direction="row" spacing={0.6} useFlexGap flexWrap="wrap" sx={{ mt: 0.6 }}>
                {projection.unconnectedMembers.map((member) => <Chip key={member.id} size="small" label={member.name} variant="outlined" />)}
              </Stack>
            </Box>
          ) : null}
          {!projection.graphs.length && !projection.unconnectedMembers.length ? <Typography variant="body2" color="text.secondary">当前没有可展示的成员关系。</Typography> : null}
        </Stack>
      </DialogContent>
    </Dialog>
  );
}

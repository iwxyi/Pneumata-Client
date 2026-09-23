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

function RelationshipGraph({ graph }: { graph: GroupRelationshipGraph }) {
  const positions = new Map(graph.nodes.map((node, index) => [node.id, nodePosition(index, graph.nodes.length)]));
  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.25, bgcolor: 'action.hover' }}>
      <Box sx={{ position: 'relative', height: 260, minHeight: 220 }}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" width="100%" height="100%" aria-label="成员关系图" style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
          <defs>
            {graph.edges.map((edge) => <marker key={edge.key} id={`arrow-${edge.key}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill={edgeColor(edge)} /></marker>)}
          </defs>
          {graph.edges.map((edge, index) => {
            const from = positions.get(edge.fromId)!;
            const to = positions.get(edge.toId)!;
            const samePairIndex = graph.edges.filter((item) => item.fromId === edge.toId && item.toId === edge.fromId).findIndex((item) => item.key === edge.key);
            const bend = samePairIndex >= 0 ? (index % 2 ? 10 : -10) : 0;
            const midX = (from.x + to.x) / 2 + bend;
            const midY = (from.y + to.y) / 2 - bend;
            return <path key={edge.key} d={`M ${from.x} ${from.y} Q ${midX} ${midY} ${to.x} ${to.y}`} fill="none" stroke={edgeColor(edge)} strokeWidth="1.25" strokeLinecap="round" markerEnd={`url(#arrow-${edge.key})`} opacity="0.88" />;
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
      <Stack spacing={0.45} sx={{ mt: 0.5 }}>
        {graph.edges.map((edge) => {
          const from = graph.nodes.find((node) => node.id === edge.fromId)?.name || '成员';
          const to = graph.nodes.find((node) => node.id === edge.toId)?.name || '成员';
          return <Typography key={edge.key} variant="caption" color="text.secondary"><Box component="span" sx={{ color: edgeColor(edge), fontWeight: 700 }}>{from} → {to}</Box> · {describeGroupRelationshipEdge(edge)}{edge.note ? ` · ${edge.note}` : ''}</Typography>;
        })}
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
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.25 }}>箭头表示单向视角；每张图只包含已有默认关系或本群关系账本中存在关系线的成员。</Typography>
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

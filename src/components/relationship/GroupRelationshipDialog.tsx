import { Avatar, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Stack, TextField, Tooltip, Typography } from '@mui/material';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import { useEffect, useRef, useState } from 'react';
import type { AICharacter } from '../../types/character';
import type { GroupChat, RoomRelationshipSharedFact } from '../../types/chat';
import { projectGroupRelationshipGraphs, type GroupRelationshipGraph, type GroupRelationshipGraphEdge } from '../../services/groupRelationshipGraph';
import { isImageAvatar } from '../../utils/avatar';

interface GroupRelationshipDialogProps {
  open: boolean;
  onClose: () => void;
  chat: GroupChat;
  members: AICharacter[];
  onRefresh?: () => void;
  onUpdateSharedFacts?: (updates: Array<{ fact: RoomRelationshipSharedFact; statement: string }>) => Promise<void>;
}

const GRAPH_WIDTH = 600;
const GRAPH_HEIGHT = 238;
const STRUCTURE_LABELS: Record<RoomRelationshipSharedFact['kind'], string> = {
  authority: '上级', duty: '职责', kinship: '亲属', affiliation: '同属', rivalry: '对立', obligation: '约束',
};

function edgeColor(edge: GroupRelationshipGraphEdge) {
  if (edge.axes.threat >= 12 || edge.axes.warmth <= -12 || edge.axes.trust <= -12) return '#D84315';
  if ((edge.axes.attachment || 0) >= 12) return '#EF6C00';
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

function markerId(pairKey: string) {
  return `relation-arrow-${pairKey.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
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
      <Stack direction="row" spacing={0.55} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography variant="body2" sx={{ fontWeight: 700, color: edgeColor(edge) }}>{fromName} → {toName}</Typography>
      </Stack>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 0.45, mt: 0.65 }}>
        {axes.map(([label, baseline, adjustment]) => <Typography key={label} variant="caption" sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>{label} {formatAxisValue(baseline, adjustment)}</Typography>)}
      </Box>
      {edge.note ? <Typography variant="caption" sx={{ display: 'block', mt: 0.55, color: 'text.secondary', overflowWrap: 'anywhere' }}>{edge.note}</Typography> : null}
    </Box>
  );
}

function RelationshipMap({ graph, highlightedPairs, selectedPairs, onHighlightedPairsChange, onSelectedPairsChange }: {
  graph: GroupRelationshipGraph;
  highlightedPairs: string[];
  selectedPairs: string[];
  onHighlightedPairsChange: (pairKeys: string[], scrollToCard?: boolean) => void;
  onSelectedPairsChange: (pairKeys: string[]) => void;
}) {
  const positions = new Map(graph.nodes.map((node, index) => [node.id, nodePosition(index, graph.nodes.length)]));
  const edgePairs = Array.from(graph.edges.reduce((pairs, edge) => {
    const pairKey = pairKeyFor(edge);
    pairs.set(pairKey, [...(pairs.get(pairKey) || []), edge]);
    return pairs;
  }, new Map<string, GroupRelationshipGraphEdge[]>()).entries());
  const recordedPairs = new Set(edgePairs.map(([pairKey]) => pairKey));
  const missingPairs = graph.nodes.flatMap((from, index) => graph.nodes.slice(index + 1)
    .filter((to) => !recordedPairs.has(pairKeyFor({ fromId: from.id, toId: to.id })))
    .map((to) => ({ fromId: from.id, toId: to.id })));
  return (
    <Box sx={{ position: 'relative' }} onClick={() => onSelectedPairsChange([])}>
    <Box sx={{ position: 'relative', width: '100%', maxWidth: GRAPH_WIDTH, height: GRAPH_HEIGHT, mx: 'auto', overflow: 'hidden' }}>
      <svg viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`} preserveAspectRatio="xMidYMid meet" width="100%" height="100%" aria-label="成员关系图" style={{ position: 'absolute', inset: 0 }}>
        <defs>{edgePairs.map(([pairKey, edges]) => <marker key={pairKey} id={markerId(pairKey)} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill={edgeColor(edges[0])} /></marker>)}</defs>
        {missingPairs.map((pair) => {
          const from = positions.get(pair.fromId)!;
          const to = positions.get(pair.toId)!;
          const { start, end } = directionEndpoints(from, to);
          return <path key={`${pair.fromId}:${pair.toId}`} d={`M ${start.x} ${start.y} L ${end.x} ${end.y}`} fill="none" stroke="#B0BEC5" strokeWidth="1" strokeDasharray="4 5" strokeLinecap="round" opacity="0.58" />;
        })}
        {edgePairs.map(([pairKey, edges]) => {
          const edge = edges[0];
          const from = positions.get(edge.fromId)!;
          const to = positions.get(edge.toId)!;
          const bidirectional = edges.length > 1;
          const { start, end } = directionEndpoints(from, to);
          const active = highlightedPairs.includes(pairKey);
          const path = `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
          return (
            <g key={pairKey} onMouseEnter={() => onHighlightedPairsChange([pairKey], true)} onMouseLeave={() => onHighlightedPairsChange([])} onClick={(event) => { event.stopPropagation(); onSelectedPairsChange(selectedPairs.length === 1 && selectedPairs[0] === pairKey ? [] : [pairKey]); }} style={{ cursor: 'pointer' }}>
              <path d={path} fill="none" stroke="transparent" strokeWidth="14" />
              <path d={path} fill="none" stroke={active ? edgeColor(edge) : '#90A4AE'} strokeWidth={active ? 2.5 : 1.25} strokeLinecap="round" markerStart={active && bidirectional ? `url(#${markerId(pairKey)})` : undefined} markerEnd={active ? `url(#${markerId(pairKey)})` : undefined} opacity={highlightedPairs.length && !active ? 0.18 : active ? 0.94 : 0.48} />
            </g>
          );
        })}
      </svg>
      {graph.nodes.map((node) => {
        const position = positions.get(node.id)!;
        const relatedPairs = Array.from(new Set(graph.edges.filter((edge) => edge.fromId === node.id || edge.toId === node.id).map(pairKeyFor)));
        return <Box key={node.id} sx={{ position: 'absolute', left: `${position.x / GRAPH_WIDTH * 100}%`, top: `${position.y / GRAPH_HEIGHT * 100}%`, transform: 'translate(-50%, -50%)', display: 'grid', justifyItems: 'center', gap: 0.35, width: 92, textAlign: 'center', pointerEvents: 'none' }}>
          <Avatar onMouseEnter={() => onHighlightedPairsChange(relatedPairs)} onMouseLeave={() => onHighlightedPairsChange([])} onClick={(event) => { event.stopPropagation(); onSelectedPairsChange(relatedPairs); }} src={isImageAvatar(node.avatar || '') ? node.avatar : undefined} sx={{ width: 42, height: 42, bgcolor: 'primary.light', border: '2px solid', borderColor: 'background.paper', boxShadow: 1, pointerEvents: relatedPairs.length ? 'auto' : 'none', cursor: relatedPairs.length ? 'pointer' : 'default' }}>{isImageAvatar(node.avatar || '') ? undefined : node.name.slice(0, 1)}</Avatar>
          <Typography variant="caption" sx={{ maxWidth: '100%', bgcolor: 'background.paper', px: 0.45, borderRadius: 0.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.name}</Typography>
        </Box>;
      })}
    </Box>
    </Box>
  );
}

function GroupRelationshipFacts({ facts, members, highlightedPairs, onHighlightedPairsChange, onUpdateSharedFacts }: {
  facts: RoomRelationshipSharedFact[];
  members: AICharacter[];
  highlightedPairs: string[];
  onHighlightedPairsChange: (pairKeys: string[]) => void;
  onUpdateSharedFacts?: GroupRelationshipDialogProps['onUpdateSharedFacts'];
}) {
  const memberNames = new Map(members.map((member) => [member.id, member.name]));
  const [editingFacts, setEditingFacts] = useState<RoomRelationshipSharedFact[] | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const factGroups = Array.from(facts.reduce((groups, fact) => {
    const memberIds = Array.from(new Set(fact.memberIds)).sort();
    const key = memberIds.join('|');
    const group = groups.get(key);
    if (group) group.facts.push(fact);
    else groups.set(key, { memberIds, facts: [fact] });
    return groups;
  }, new Map<string, { memberIds: string[]; facts: RoomRelationshipSharedFact[] }>()).entries());
  if (!facts.length) return null;
  return (
    <Box>
      <Typography variant="body2" sx={{ fontWeight: 700 }}>群体关系</Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 0.7, mt: 0.75 }}>
        {factGroups.map(([groupKey, group]) => {
          const names = group.memberIds.map((memberId) => memberNames.get(memberId)).filter((name): name is string => Boolean(name));
          const factPairs = group.memberIds.flatMap((fromId, index) =>
            group.memberIds.slice(index + 1).map((toId) => pairKeyFor({ fromId, toId })),
          );
          const active = factPairs.some((pairKey) => highlightedPairs.includes(pairKey));
          const kinds = Array.from(new Set(group.facts.flatMap((fact) => fact.kinds?.length ? fact.kinds : [fact.kind])));
          const summaryFact = [...group.facts].sort((left, right) => right.statement.length - left.statement.length)[0];
          return <Box key={groupKey} onMouseEnter={() => onHighlightedPairsChange(factPairs)} onMouseLeave={() => onHighlightedPairsChange([])} sx={{ minWidth: 0, p: 0.9, borderRadius: 1, border: '1px solid', borderColor: active ? 'primary.main' : 'divider', bgcolor: active ? 'action.selected' : 'background.paper', boxShadow: active ? 1 : 'none', cursor: 'pointer', transition: 'background-color 120ms ease, border-color 120ms ease, box-shadow 120ms ease' }}>
            <Stack direction="row" spacing={0.55} useFlexGap sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <Stack direction="row" spacing={0.55} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                <Typography variant="caption" color="text.secondary">{names.join('、')}</Typography>
                {kinds.map((kind) => <Chip key={kind} size="small" label={STRUCTURE_LABELS[kind]} variant="outlined" />)}
              </Stack>
              {onUpdateSharedFacts ? <Tooltip title="编辑关系"><IconButton size="small" onClick={(event) => { event.stopPropagation(); setSaveError(''); setEditingFacts(group.facts); setDraft(summaryFact.statement); }}><EditOutlinedIcon fontSize="small" /></IconButton></Tooltip> : null}
            </Stack>
            <Box sx={{ minWidth: 0, mt: 0.55 }}>
              <Typography variant="body2">{summaryFact.statement}</Typography>
              {summaryFact.evidence ? <Typography variant="caption" color="text.secondary">{summaryFact.evidence}</Typography> : null}
            </Box>
          </Box>;
        })}
      </Box>
      <Dialog open={Boolean(editingFacts)} onClose={() => { if (!saving) setEditingFacts(null); }} maxWidth="sm" fullWidth>
        <DialogTitle>编辑群体关系</DialogTitle>
        <DialogContent>
          <Stack spacing={1.2} sx={{ pt: 0.5 }}>
            <TextField label="关系说明" value={draft} onChange={(event) => setDraft(event.target.value)} multiline minRows={3} fullWidth slotProps={{ htmlInput: { maxLength: 180 } }} />
            {saveError ? <Typography variant="caption" color="error">{saveError}</Typography> : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={saving} onClick={() => setEditingFacts(null)}>取消</Button>
          <Button variant="contained" disabled={saving || !draft.trim()} onClick={async () => {
            if (!editingFacts || !onUpdateSharedFacts) return;
            setSaving(true);
            setSaveError('');
            try {
              await onUpdateSharedFacts(editingFacts.map((fact) => ({ fact, statement: draft.trim() })));
              setEditingFacts(null);
            } catch (error) {
              setSaveError(error instanceof Error ? error.message : '保存失败，请稍后重试');
            } finally {
              setSaving(false);
            }
          }}>保存</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function RelationshipCards({ graph, highlightedPairs, onHighlightedPairsChange, registerCard }: {
  graph: GroupRelationshipGraph;
  highlightedPairs: string[];
  onHighlightedPairsChange: (pairKeys: string[], scrollToCard?: boolean) => void;
  registerCard: (pairKey: string, element: HTMLDivElement | null) => void;
}) {
  return <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 0.7 }}>
    {graph.edges.filter((edge) => edge.source !== 'structural').map((edge) => <DirectionDetail key={edge.key} edge={edge} fromName={graph.nodes.find((node) => node.id === edge.fromId)?.name || '成员'} toName={graph.nodes.find((node) => node.id === edge.toId)?.name || '成员'} active={highlightedPairs.includes(pairKeyFor(edge))} onActiveChange={onHighlightedPairsChange} cardRef={(element) => registerCard(edge.key, element)} />)}
  </Box>;
}

export default function GroupRelationshipDialog({ open, onClose, chat, members, onRefresh, onUpdateSharedFacts }: GroupRelationshipDialogProps) {
  const projection = projectGroupRelationshipGraphs(chat, members);
  const eligibleMemberCount = members.filter((member) => chat.memberIds.includes(member.id) && !member.deletedAt).length;
  const [highlightedPairs, setHighlightedPairs] = useState<string[]>([]);
  const [selectedPairs, setSelectedPairs] = useState<string[]>([]);
  const [refreshRequested, setRefreshRequested] = useState(false);
  const cardRefs = useRef(new Map<string, HTMLDivElement>());
  useEffect(() => {
    if (chat.modeState.initialization?.status !== 'running') setRefreshRequested(false);
  }, [chat.modeState.initialization?.status]);
  const handleHighlightedPairsChange = (pairKeys: string[], scrollToCard = false) => {
    setHighlightedPairs(pairKeys.length ? pairKeys : selectedPairs);
    if (!pairKeys.length || !scrollToCard) return;
    const pairEdges = projection.graphs.flatMap((graph) => graph.edges).filter((edge) => pairKeyFor(edge) === pairKeys[0]);
    window.requestAnimationFrame(() => cardRefs.current.get(pairEdges[0]?.key || '')?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' }));
  };
  const handleSelectedPairsChange = (pairKeys: string[]) => {
    setSelectedPairs(pairKeys);
    setHighlightedPairs(pairKeys);
  };
  const registerCard = (pairKey: string, element: HTMLDivElement | null) => {
    if (element) {
      if (!cardRefs.current.has(pairKey)) cardRefs.current.set(pairKey, element);
    } else cardRefs.current.delete(pairKey);
  };
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xl" fullWidth slotProps={{ paper: { sx: { height: { xs: 'calc(100% - 32px)', sm: 'min(820px, calc(100% - 64px))' }, overflow: 'hidden' } } }}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flexShrink: 0 }}>
        群成员关系
        {onRefresh && eligibleMemberCount >= 2 ? <Chip size="small" label={refreshRequested ? '更新中' : '更新关系'} onClick={() => { if (refreshRequested) return; setRefreshRequested(true); onRefresh(); }} clickable={!refreshRequested} variant="outlined" /> : null}
      </DialogTitle>
      <DialogContent dividers sx={{ display: 'flex', minHeight: 0, flexDirection: 'column', overflow: 'hidden', p: 0 }}>
        <Box sx={{ flexShrink: 0, px: 1.5, pt: 1.25, pb: 0.8 }}><Stack spacing={0.75}>{projection.graphs.map((graph) => <RelationshipMap key={graph.key} graph={graph} highlightedPairs={highlightedPairs} selectedPairs={selectedPairs} onHighlightedPairsChange={handleHighlightedPairsChange} onSelectedPairsChange={handleSelectedPairsChange} />)}</Stack></Box>
        <Box sx={{ minHeight: 0, flex: 1, overflowY: 'auto', px: 1.5, pb: 1.5 }}>
          <Stack spacing={0.8}>
            <GroupRelationshipFacts facts={projection.sharedFacts} members={members} highlightedPairs={highlightedPairs} onHighlightedPairsChange={(pairKeys) => setHighlightedPairs(pairKeys.length ? pairKeys : selectedPairs)} onUpdateSharedFacts={onUpdateSharedFacts} />
            {projection.graphs.map((graph) => <RelationshipCards key={graph.key} graph={graph} highlightedPairs={highlightedPairs} onHighlightedPairsChange={handleHighlightedPairsChange} registerCard={registerCard} />)}
            {projection.unconnectedMembers.length ? <Box sx={{ p: 1, borderRadius: 1, border: '1px dashed', borderColor: 'divider' }}><Typography variant="caption" color="text.secondary">暂无关系线</Typography><Stack direction="row" spacing={0.6} useFlexGap sx={{ mt: 0.6, flexWrap: 'wrap' }}>{projection.unconnectedMembers.map((member) => <Chip key={member.id} size="small" label={member.name} variant="outlined" />)}</Stack></Box> : null}
            {!projection.graphs.length && !projection.unconnectedMembers.length ? <Typography variant="body2" color="text.secondary">当前没有可展示的成员关系。</Typography> : null}
          </Stack>
        </Box>
      </DialogContent>
    </Dialog>
  );
}

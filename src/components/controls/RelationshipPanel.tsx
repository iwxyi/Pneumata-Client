import { alpha } from '@mui/material/styles';
import { Box, Chip, Dialog, DialogContent, DialogTitle, Divider, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import SurfaceCard from '../common/SurfaceCard';
import SectionHeader from '../common/SectionHeader';
import { useMemo, useState, type ReactNode } from 'react';
import type { AICharacter } from '../../types/character';
import type { GroupChat } from '../../types/chat';
import type { RelationshipAxisReason, RelationshipLedgerEntry } from '../../types/runtimeEvent';
import { buildRelationshipDisplaySummary, formatSignedRelationshipNumber, isMeaningfulRelationshipLedgerEntry, normalizeRelationshipLedgerEntry, toRelationshipDisplayDelta } from '../../services/relationshipLedger';
import { buildPresentedRelationshipLedger } from '../../services/relationshipPresentation';

interface RelationshipPanelProps {
  chat: GroupChat;
  members: AICharacter[];
}

const METRIC_META = [
  { key: 'warmth', label: '亲和', color: '#43A047', hint: '表示接纳度、情感温度与靠近倾向。' },
  { key: 'competence', label: '能力判断', color: '#1E88E5', hint: '表示对对方判断力、能力与专业性的评估。' },
  { key: 'trust', label: '信任', color: '#8E24AA', hint: '表示对可靠性、可预期性与合作安全感的判断。' },
  { key: 'threat', label: '威胁感', color: '#E53935', hint: '表示对风险、攻击性与压迫感的知觉。' },
] as const;

type AxisKey = typeof METRIC_META[number]['key'];

function buildMetricPolygon(values: number[], size = 84) {
  const center = size / 2;
  const radius = size / 2 - 8;
  return values.map((value, index) => {
    const angle = (Math.PI * 2 * index) / values.length - Math.PI / 2;
    const scaledRadius = radius * (Math.max(0, Math.min(100, value)) / 100);
    const x = center + Math.cos(angle) * scaledRadius;
    const y = center + Math.sin(angle) * scaledRadius;
    return `${x},${y}`;
  }).join(' ');
}

function buildHexRing(size = 84, scale = 1) {
  const center = size / 2;
  const radius = (size / 2 - 8) * scale;
  return METRIC_META.map((_, index) => {
    const angle = (Math.PI * 2 * index) / METRIC_META.length - Math.PI / 2;
    const x = center + Math.cos(angle) * radius;
    const y = center + Math.sin(angle) * radius;
    return `${x},${y}`;
  }).join(' ');
}

function trendLabel(trend: RelationshipLedgerEntry['trend']) {
  if (trend === 'volatile') return '震荡';
  if (trend === 'up') return '升温';
  if (trend === 'down') return '走低';
  return '持平';
}

function trendHint(trend: RelationshipLedgerEntry['trend']) {
  if (trend === 'volatile') return '最近变化方向反复，关系仍不稳定。';
  if (trend === 'up') return '最近证据整体推动关系升温。';
  if (trend === 'down') return '最近证据整体推动关系走低。';
  return '近期没有新证据推动明显变化。';
}

function summaryHint(summary: string) {
  if (summary === '中性') return '当前没有哪个关系轴足够突出。';
  return `当前最突出的关系轴：${summary}。`;
}

function buildRelationshipStateChips(delta: ReturnType<typeof toRelationshipDisplayDelta>) {
  const chips: Array<{ label: string; color?: 'success' | 'warning' | 'info' | 'default'; hint: string }> = [];
  const warmth = delta.warmth || 0;
  const competence = delta.competence || 0;
  const trust = delta.trust || 0;
  const threat = delta.threat || 0;
  if (warmth >= 12 || trust >= 12) chips.push({ label: '高好感', color: 'success', hint: '亲和或信任较高，表示这一方更愿意靠近或接住对方。' });
  if (threat >= 12 || warmth <= -12 || trust <= -12) chips.push({ label: '有冲突', color: 'warning', hint: '威胁感较高，或亲和/信任明显偏低，表示这一方对对方有防备或摩擦。' });
  if (competence >= 12) chips.push({ label: '认可能力', color: 'info', hint: '能力判断较高，表示这一方更认可对方的判断力或本事。' });
  if (competence <= -12) chips.push({ label: '不太服气', color: 'warning', hint: '能力判断偏低，表示这一方不太认可对方的判断或表现。' });
  return chips.slice(0, 3);
}

function formatSignedDelta(value: number) {
  return formatSignedRelationshipNumber(value);
}

function scalePositiveBiasedRadar(value: number) {
  if (value >= 0) return Math.max(24, Math.min(100, 40 + value * 0.6));
  return Math.max(18, Math.min(44, 40 + value * 0.44));
}

function buildRadarValue(entry: RelationshipLedgerEntry, axis: AxisKey) {
  const delta = toRelationshipDisplayDelta(entry.current);
  const value = delta[axis] || 0;
  return scalePositiveBiasedRadar(value);
}

function cleanRelationshipText(text: string) {
  return text
    .replace(/^[^：:]+[：:]/, '')
    .replace(/^[^↔]+↔[^：:]+[：:]/, '')
    .trim();
}

function buildAxisLabels(delta: ReturnType<typeof toRelationshipDisplayDelta>) {
  return [
    { key: 'warmth' as const, label: '亲和', value: formatSignedDelta(delta.warmth || 0), color: '#43A047', x: 56, y: 16, anchor: 'middle' as const, labelDy: 0, valueDy: 12 },
    { key: 'competence' as const, label: '能力', value: formatSignedDelta(delta.competence || 0), color: '#1E88E5', x: 92, y: 56, anchor: 'start' as const, labelDy: -4, valueDy: 9 },
    { key: 'trust' as const, label: '信任', value: formatSignedDelta(delta.trust || 0), color: '#8E24AA', x: 56, y: 106, anchor: 'middle' as const, labelDy: 0, valueDy: 12 },
    { key: 'threat' as const, label: '威胁', value: formatSignedDelta(delta.threat || 0), color: '#E53935', x: 20, y: 56, anchor: 'end' as const, labelDy: -4, valueDy: 9 },
  ];
}

function AxisReasonDialog({ open, onClose, axisLabel, reasons }: { open: boolean; onClose: () => void; axisLabel: string; reasons: RelationshipAxisReason[] }) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{axisLabel} 变化原因</DialogTitle>
      <DialogContent>
        <Stack spacing={1}>
          {reasons.length ? reasons.map((reason, index) => (
            <Box key={`${reason.axis}-${index}`} sx={{ p: 1, borderRadius: 2, bgcolor: 'action.hover' }}>
              <Typography variant="caption" color="text.secondary">{reason.reason} · {formatSignedDelta(reason.value)}</Typography>
              <Typography variant="body2">{reason.evidence}</Typography>
            </Box>
          )) : <Typography variant="body2" color="text.secondary">暂无单独原因记录</Typography>}
        </Stack>
      </DialogContent>
    </Dialog>
  );
}

function RadarAxisLabels({ delta, onOpenAxis }: { delta: ReturnType<typeof toRelationshipDisplayDelta>; onOpenAxis: (axis: AxisKey) => void }) {
  return (
    <>
      {buildAxisLabels(delta).map((item) => {
        const meta = METRIC_META.find((axis) => axis.key === item.key);
        return (
          <Tooltip key={item.key} title={meta?.hint || item.label} arrow>
            <g transform={`translate(${item.x}, ${item.y})`} style={{ cursor: 'pointer' }} onClick={() => onOpenAxis(item.key)}>
              <text textAnchor={item.anchor} dy={item.labelDy} dominantBaseline="middle" fill="rgba(71, 85, 105, 0.92)" fontSize="11" fontWeight="600">{item.label}</text>
              <text textAnchor={item.anchor} dy={item.valueDy} dominantBaseline="middle" fill={item.color} fontSize="11">{item.value}</text>
            </g>
          </Tooltip>
        );
      })}
    </>
  );
}

export function RelationshipRadar({ entry, onOpenAxis, compact = false }: { entry: RelationshipLedgerEntry; onOpenAxis: (axis: AxisKey) => void; compact?: boolean }) {
  const delta = toRelationshipDisplayDelta(entry.current);
  const scaledValues = METRIC_META.map((item) => buildRadarValue(entry, item.key));
  const size = compact ? 72 : 84;
  const center = size / 2;
  const armRadius = size / 2 - 8;
  const polygon = buildMetricPolygon(scaledValues, size);

  return (
    <Box sx={{ mt: compact ? 0 : 0.25, display: 'grid', placeItems: 'center' }}>
      <svg viewBox={compact ? '0 0 72 72' : '0 0 112 122'} width="100%" height={compact ? 72 : 122} aria-hidden="true" style={{ maxWidth: compact ? 72 : 210, overflow: 'visible' }}>
        <g transform={compact ? 'translate(0, 0)' : 'translate(14, 18)'}>
          {[0.33, 0.66, 1].map((scale) => (
            <polygon key={scale} points={buildHexRing(size, scale)} fill="none" stroke="rgba(148, 163, 184, 0.24)" strokeWidth="1" />
          ))}
          {METRIC_META.map((item, index) => {
            const angle = (Math.PI * 2 * index) / METRIC_META.length - Math.PI / 2;
            const x = center + Math.cos(angle) * armRadius;
            const y = center + Math.sin(angle) * armRadius;
            return <line key={item.key} x1={center} y1={center} x2={x} y2={y} stroke="rgba(148, 163, 184, 0.18)" strokeWidth="1" />;
          })}
          <polygon points={polygon} fill="rgba(124, 58, 237, 0.16)" stroke="rgba(124, 58, 237, 0.7)" strokeWidth="1.75" />
          {METRIC_META.map((item, index) => {
            const angle = (Math.PI * 2 * index) / METRIC_META.length - Math.PI / 2;
            const radius = armRadius * (scaledValues[index] / 100);
            const x = center + Math.cos(angle) * radius;
            const y = center + Math.sin(angle) * radius;
            return <circle key={item.key} cx={x} cy={y} r={compact ? '2' : '2.5'} fill={item.color} />;
          })}
        </g>
        {compact ? null : <RadarAxisLabels delta={delta} onOpenAxis={onOpenAxis} />}
      </svg>
    </Box>
  );
}

function RelationshipDerivedChips({ entry }: { entry: RelationshipLedgerEntry }) {
  if (!entry.derived) return null;
  const semantic = entry.derived.semantic;
  const stability = typeof entry.derived.stability === 'number' ? Math.round(entry.derived.stability) : null;
  const salience = typeof entry.derived.salience === 'number' ? Math.round(entry.derived.salience) : null;
  const reciprocity = typeof entry.derived.reciprocity === 'number' ? Math.round(entry.derived.reciprocity) : null;
  const stabilityLabel = stability === null ? '' : stability >= 70 ? '关系稳定' : stability >= 42 ? '仍在变化' : '容易摇摆';
  const salienceLabel = salience === null ? '' : salience >= 70 ? '证据显著' : salience >= 42 ? '证据增强' : '证据较轻';
  const reciprocityLabel = reciprocity === null ? '' : reciprocity >= 70 ? '双向接近' : reciprocity >= 42 ? '有来有回' : '单向明显';
  return (
    <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap' }} useFlexGap>
      {semantic ? <Tooltip title="根据关系四轴、近期趋势和证据推导的关系语义。" arrow><Chip size="small" color="primary" variant="outlined" label={semantic.stage} /></Tooltip> : null}
      {semantic?.labels?.slice(0, 3).map((label) => <Chip key={label} size="small" variant="outlined" label={label} />)}
      {stability !== null ? <Tooltip title={`关系越高越稳，越低越容易继续变化。当前 ${stability}`} arrow><Chip size="small" variant="outlined" label={stabilityLabel} /></Tooltip> : null}
      {salience !== null ? <Tooltip title={`最近证据密度与强度。当前 ${salience}`} arrow><Chip size="small" variant="outlined" label={salienceLabel} /></Tooltip> : null}
      {reciprocity !== null ? <Tooltip title={`双向关系的一致程度。当前 ${reciprocity}`} arrow><Chip size="small" variant="outlined" label={reciprocityLabel} /></Tooltip> : null}
    </Stack>
  );
}

function RelationshipEvidenceCard({ speakerName, evidence }: { speakerName?: string; evidence: string }) {
  const cleaned = cleanRelationshipText(evidence);
  if (!cleaned) return null;
  return (
    <Box sx={(theme) => ({ p: 1, borderRadius: 2, bgcolor: alpha(theme.palette.common.black, 0.03) })}>
      {speakerName ? <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.35 }}>{speakerName}</Typography> : null}
      <Typography variant="body2">{cleaned}</Typography>
    </Box>
  );
}

function RelationshipCardFrame({ children }: { children: ReactNode }) {
  return (
    <Box
      sx={(theme) => ({
        p: 1.25,
        borderRadius: 2,
        border: `1px solid ${alpha(theme.palette.divider, 0.6)}`,
        bgcolor: alpha(theme.palette.background.default, 0.45),
        transition: 'transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease',
        '&:hover': {
          transform: 'translateY(-1px)',
          boxShadow: theme.shadows[2],
          borderColor: alpha(theme.palette.primary.main, 0.35),
        },
      })}
    >
      {children}
    </Box>
  );
}

function RelationshipLedgerCard({ entry, members, hideSpeakerName = false }: { entry: RelationshipLedgerEntry; members: AICharacter[]; hideSpeakerName?: boolean }) {
  const normalizedEntry = normalizeRelationshipLedgerEntry(entry);
  const presented = buildPresentedRelationshipLedger({ relationshipLedger: [normalizedEntry] } as GroupChat, members)[0];
  const dominantSummary = buildRelationshipDisplaySummary(normalizedEntry);
  const delta = toRelationshipDisplayDelta(normalizedEntry.current);
  const stateChips = buildRelationshipStateChips(delta);
  const [activeAxis, setActiveAxis] = useState<AxisKey | null>(null);
  const axisReasonMap = normalizedEntry.axisReasons || {};
  const activeMeta = useMemo(() => METRIC_META.find((item) => item.key === activeAxis) || null, [activeAxis]);
  const activeReasons = activeAxis ? (axisReasonMap[activeAxis] || []) : [];

  if (!presented) return null;


  return (
    <RelationshipCardFrame>
      <Stack spacing={0.85} sx={{ minWidth: 0 }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.75, px: 0.25, pt: 0.25 }}>
          <Typography variant="body2" sx={{ fontWeight: 700 }}>{presented.actorName} → {presented.targetName}</Typography>
          <Tooltip title={trendHint(normalizedEntry.trend)} arrow>
            <Chip size="small" label={trendLabel(normalizedEntry.trend)} sx={{ height: 22, fontSize: 11 }} />
          </Tooltip>
          <Tooltip title={summaryHint(dominantSummary)} arrow>
            <Chip size="small" variant="outlined" label={dominantSummary} sx={{ height: 22, fontSize: 11 }} />
          </Tooltip>
        </Box>
        {stateChips.length ? (
          <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap' }} useFlexGap>
            {stateChips.map((chip) => (
              <Tooltip key={chip.label} title={chip.hint} arrow>
                <Chip size="small" color={chip.color || 'default'} variant="outlined" label={chip.label} sx={{ height: 22, fontSize: 11 }} />
              </Tooltip>
            ))}
          </Stack>
        ) : null}
        {presented.semanticSummary ? <Typography variant="caption" color="text.secondary" sx={{ px: 0.25 }}>{presented.semanticSummary}</Typography> : null}
        <RelationshipDerivedChips entry={normalizedEntry} />
        <RelationshipEvidenceCard speakerName={hideSpeakerName ? undefined : presented.speakerName} evidence={presented.evidence || '暂无明确证据'} />
        <RelationshipRadar entry={normalizedEntry} onOpenAxis={setActiveAxis} />
      </Stack>
      <AxisReasonDialog open={Boolean(activeAxis)} onClose={() => setActiveAxis(null)} axisLabel={activeMeta?.label || '关系轴'} reasons={activeReasons} />
    </RelationshipCardFrame>
  );
}

function RelationshipFallbackCard({ memberName, targetName, note, relation, updatedAt }: { memberName: string; targetName: string; note?: string; relation: { warmth: number; competence: number; trust: number; threat: number }; updatedAt: number }) {
  const fallbackEvidence = note?.trim() ? `预设备注：${note.trim()}` : '暂无结构化证据';
  const hasMeaningfulFallback = Math.abs(relation.warmth) >= 8 || Math.abs(relation.competence) >= 8 || Math.abs(relation.trust) >= 8 || Math.abs(relation.threat) >= 8 || Boolean(note?.trim());
  const [activeAxis, setActiveAxis] = useState<AxisKey | null>(null);
  const activeMeta = useMemo(() => METRIC_META.find((item) => item.key === activeAxis) || null, [activeAxis]);
  const fallbackEntry: RelationshipLedgerEntry = {
    pairKey: `${memberName}->${targetName}`,
    actorId: memberName,
    targetId: targetName,
    current: relation,
    derived: {},
    axisReasons: {},
    trend: 'flat',
    recentEvents: [],
    lastUpdatedAt: updatedAt,
  };
  const summary = buildRelationshipDisplaySummary(fallbackEntry);
  const normalizedFallbackEntry = normalizeRelationshipLedgerEntry(fallbackEntry);
  const stateChips = buildRelationshipStateChips(toRelationshipDisplayDelta(normalizedFallbackEntry.current));

  if (!hasMeaningfulFallback) return null;

  return (
    <RelationshipCardFrame>
      <Stack spacing={0.85} sx={{ minWidth: 0 }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.75, px: 0.25, pt: 0.25 }}>
          <Typography variant="body2" sx={{ fontWeight: 700 }}>{memberName} → {targetName}</Typography>
          <Tooltip title="近期没有新证据驱动明显变化。" arrow>
            <Chip size="small" label="持平" sx={{ height: 22, fontSize: 11 }} />
          </Tooltip>
          <Tooltip title={summaryHint(summary)} arrow>
            <Chip size="small" variant="outlined" label={summary} sx={{ height: 22, fontSize: 11 }} />
          </Tooltip>
        </Box>
        {stateChips.length ? (
          <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap' }} useFlexGap>
            {stateChips.map((chip) => (
              <Tooltip key={chip.label} title={chip.hint} arrow>
                <Chip size="small" color={chip.color || 'default'} variant="outlined" label={chip.label} sx={{ height: 22, fontSize: 11 }} />
              </Tooltip>
            ))}
          </Stack>
        ) : null}
        <RelationshipDerivedChips entry={normalizedFallbackEntry} />
        <RelationshipEvidenceCard speakerName={memberName} evidence={fallbackEvidence} />
        <RelationshipRadar entry={normalizedFallbackEntry} onOpenAxis={setActiveAxis} />
      </Stack>
      <AxisReasonDialog open={Boolean(activeAxis)} onClose={() => setActiveAxis(null)} axisLabel={activeMeta?.label || '关系轴'} reasons={[]} />
    </RelationshipCardFrame>
  );
}

export default function RelationshipPanel({ chat, members }: RelationshipPanelProps) {
  const isGroupChat = chat.type === 'group';
  const collapseStorageKey = `relationship-panel-collapse:${chat.id}`;
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>(() => {
    try {
      const raw = localStorage.getItem(collapseStorageKey);
      if (!raw) return {};
      const parsed = JSON.parse(raw) as Record<string, boolean>;
      return typeof parsed === 'object' && parsed !== null ? parsed : {};
    } catch {
      return {};
    }
  });

  const persistCollapsedSections = (next: Record<string, boolean>) => {
    setCollapsedSections(next);
    try {
      localStorage.setItem(collapseStorageKey, JSON.stringify(next));
    } catch {
      // ignore persistence errors
    }
  };
  const ledgerEntries = (chat.relationshipLedger || [])
    .filter((entry) => !/^draft-\d+$/i.test(entry.actorId) && !/^draft-\d+$/i.test(entry.targetId))
    .filter(isMeaningfulRelationshipLedgerEntry)
    .slice()
    .sort((a, b) => {
      const aDelta = toRelationshipDisplayDelta(a.current);
      const bDelta = toRelationshipDisplayDelta(b.current);
      const aScore = Math.abs((aDelta.warmth || 0) + (aDelta.competence || 0) + (aDelta.trust || 0) - (aDelta.threat || 0));
      const bScore = Math.abs((bDelta.warmth || 0) + (bDelta.competence || 0) + (bDelta.trust || 0) - (bDelta.threat || 0));
      if (bScore !== aScore) return bScore - aScore;
      return b.lastUpdatedAt - a.lastUpdatedAt;
    });

  const groupedLedgerSections = members
    .map((member) => ({
      member,
      items: ledgerEntries.filter((entry) => entry.actorId === member.id).slice(0, 8),
    }))
    .filter((section) => section.items.length > 0);

  const fallbackSections = members
    .filter((member) => !groupedLedgerSections.some((section) => section.member.id === member.id))
    .map((member) => {
      const items = member.relationships
        .filter((relation) => !/^draft-\d+$/i.test(relation.characterId))
        .filter((relation) => relation.warmth !== 0 || relation.competence !== 0 || relation.trust !== 0 || relation.threat !== 0 || Boolean(relation.note?.trim()))
        .slice(0, 3);
      return { member, items };
    })
    .filter((section) => section.items.length > 0);

  const sectionKeys = [
    ...groupedLedgerSections.map(({ member }) => member.id),
    ...fallbackSections.map(({ member }) => `fallback-${member.id}`),
  ];

  const collapsedCount = sectionKeys.filter((key) => collapsedSections[key]).length;
  const shouldCollapseAll = collapsedCount < sectionKeys.length;

  const toggleSection = (key: string) => {
    persistCollapsedSections({ ...collapsedSections, [key]: !collapsedSections[key] });
  };

  const toggleAllSections = () => {
    const next = { ...collapsedSections };
    sectionKeys.forEach((key) => {
      next[key] = shouldCollapseAll;
    });
    persistCollapsedSections(next);
  };

  return (
    <SurfaceCard>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <SectionHeader title={chat.type === 'group' ? '关系脉络' : '成员信息'} dense />
        {isGroupChat && sectionKeys.length ? (
          <Stack direction="row" spacing={0.5}>
            <Tooltip title={shouldCollapseAll ? '全部折叠' : '全部展开'} arrow>
              <IconButton size="small" onClick={toggleAllSections}>
                {shouldCollapseAll ? <ExpandMoreRoundedIcon fontSize="small" /> : <ChevronRightRoundedIcon fontSize="small" />}
              </IconButton>
            </Tooltip>
          </Stack>
        ) : null}
      </Box>
      {groupedLedgerSections.length ? (
        <Stack spacing={1.25}>
          {groupedLedgerSections.map(({ member, items }) => {
            const sectionKey = member.id;
            const collapsed = Boolean(collapsedSections[sectionKey]);
            return (
              <Box key={member.id}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{member.name} · 对外关系</Typography>
                  <IconButton size="small" onClick={() => toggleSection(sectionKey)}>
                    {collapsed ? <ChevronRightRoundedIcon fontSize="small" /> : <ExpandMoreRoundedIcon fontSize="small" />}
                  </IconButton>
                </Box>
                {!collapsed ? (
                  <Stack spacing={1} sx={{ mt: 0.5 }}>
                    {items.map((entry) => <RelationshipLedgerCard key={entry.pairKey} entry={entry} members={members} hideSpeakerName={false} />)}
                  </Stack>
                ) : null}
                <Divider sx={{ mt: 1 }} />
              </Box>
            );
          })}
        </Stack>
      ) : fallbackSections.length === 0 ? <Typography variant="caption" color="text.secondary">暂无结构化关系数据</Typography> : (
        <Stack spacing={1.25}>
          {fallbackSections.map(({ member, items }) => {
            const sectionKey = `fallback-${member.id}`;
            const collapsed = Boolean(collapsedSections[sectionKey]);
            return (
              <Box key={member.id}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{member.name} · 对外关系</Typography>
                  <IconButton size="small" onClick={() => toggleSection(sectionKey)}>
                    {collapsed ? <ChevronRightRoundedIcon fontSize="small" /> : <ExpandMoreRoundedIcon fontSize="small" />}
                  </IconButton>
                </Box>
                {!collapsed ? (
                  <Stack spacing={1} sx={{ mt: 0.5 }}>
                    {items.map((relation, index) => {
                      const target = members.find((item) => item.id === relation.characterId);
                      const targetName = target?.name || relation.characterId;
                      return (
                        <RelationshipFallbackCard
                          key={`${member.id}-${index}`}
                          memberName={member.name}
                          targetName={targetName}
                          note={relation.note}
                          relation={{
                            warmth: relation.warmth,
                            competence: relation.competence,
                            trust: relation.trust,
                            threat: relation.threat,
                          }}
                          updatedAt={chat.updatedAt}
                        />
                      );
                    })}
                  </Stack>
                ) : null}
                <Divider sx={{ mt: 1 }} />
              </Box>
            );
          })}
        </Stack>
      )}
    </SurfaceCard>
  );
}

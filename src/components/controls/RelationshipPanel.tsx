import { alpha } from '@mui/material/styles';
import { Box, Chip, Dialog, DialogContent, DialogTitle, Divider, Stack, Tooltip, Typography } from '@mui/material';
import SurfaceCard from '../common/SurfaceCard';
import SectionHeader from '../common/SectionHeader';
import { useMemo, useState, type ReactNode } from 'react';
import type { AICharacter } from '../../types/character';
import type { GroupChat } from '../../types/chat';
import type { RelationshipAxisReason, RelationshipLedgerEntry } from '../../types/runtimeEvent';
import { buildRelationshipDisplaySummary, isMeaningfulRelationshipLedgerEntry, normalizeRelationshipLedgerEntry, toRelationshipDisplayDelta } from '../../services/relationshipLedger';
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
  if (summary === '中性') return '当前没有哪个关系轴足够突出。雷达图会适度放大正向关系、压缩轻微负向偏移。';
  return `当前最突出的关系轴：${summary}。雷达图会适度放大正向关系、压缩轻微负向偏移。`;
}

function formatSignedDelta(value: number) {
  if (value > 0) return `+${value}`;
  if (value < 0) return `${value}`;
  return '0';
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

function scaleForRadar(value: number) {
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
          <Tooltip key={item.key} title={`${meta?.hint || item.label} 当前雷达图对正向值做了更大展示，对轻微负向做了压缩。`} arrow>
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

export function RelationshipRadar({ entry, onOpenAxis }: { entry: RelationshipLedgerEntry; onOpenAxis: (axis: AxisKey) => void }) {
  const delta = toRelationshipDisplayDelta(entry.current);
  const scaledValues = METRIC_META.map((item) => buildRadarValue(entry, item.key));
  const polygon = buildMetricPolygon(scaledValues, 84);

  return (
    <Box sx={{ mt: 0.25, display: 'grid', placeItems: 'center' }}>
      <svg viewBox="0 0 112 122" width="100%" height="122" aria-hidden="true" style={{ maxWidth: 210, overflow: 'visible' }}>
        <text x="56" y="10" textAnchor="middle" fill="rgba(100, 116, 139, 0.9)" fontSize="10">统一零点基底</text>
        <g transform="translate(14, 18)">
          {[0.33, 0.66, 1].map((scale) => (
            <polygon key={scale} points={buildHexRing(84, scale)} fill="none" stroke="rgba(148, 163, 184, 0.24)" strokeWidth="1" />
          ))}
          {METRIC_META.map((item, index) => {
            const angle = (Math.PI * 2 * index) / METRIC_META.length - Math.PI / 2;
            const x = 42 + Math.cos(angle) * 34;
            const y = 42 + Math.sin(angle) * 34;
            return <line key={item.key} x1="42" y1="42" x2={x} y2={y} stroke="rgba(148, 163, 184, 0.18)" strokeWidth="1" />;
          })}
          <polygon points={polygon} fill="rgba(124, 58, 237, 0.16)" stroke="rgba(124, 58, 237, 0.7)" strokeWidth="1.75" />
          {METRIC_META.map((item, index) => {
            const angle = (Math.PI * 2 * index) / METRIC_META.length - Math.PI / 2;
            const radius = 34 * (scaledValues[index] / 100);
            const x = 42 + Math.cos(angle) * radius;
            const y = 42 + Math.sin(angle) * radius;
            return <circle key={item.key} cx={x} cy={y} r="2.5" fill={item.color} />;
          })}
        </g>
        <RadarAxisLabels delta={delta} onOpenAxis={onOpenAxis} />
      </svg>
    </Box>
  );
}

function RelationshipDerivedChips({ entry }: { entry: RelationshipLedgerEntry }) {
  if (!entry.derived) return null;
  return (
    <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap' }} useFlexGap>
      {typeof entry.derived.stability === 'number' ? <Tooltip title="关系越高越稳，越低越容易继续变化。" arrow><Chip size="small" variant="outlined" label={`稳定 ${Math.round(entry.derived.stability)}`} /></Tooltip> : null}
      {typeof entry.derived.salience === 'number' ? <Tooltip title="最近证据密度与强度。" arrow><Chip size="small" variant="outlined" label={`显著 ${Math.round(entry.derived.salience)}`} /></Tooltip> : null}
      {typeof entry.derived.reciprocity === 'number' ? <Tooltip title="双向关系的一致程度。" arrow><Chip size="small" variant="outlined" label={`对称 ${Math.round(entry.derived.reciprocity)}`} /></Tooltip> : null}
    </Stack>
  );
}

function RelationshipEvidenceCard({ speakerName, evidence }: { speakerName: string; evidence: string }) {
  const cleaned = cleanRelationshipText(evidence);
  if (!cleaned) return null;
  return (
    <Box sx={(theme) => ({ p: 1, borderRadius: 2, bgcolor: alpha(theme.palette.common.black, 0.03) })}>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.35 }}>{speakerName}</Typography>
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

function RelationshipLedgerCard({ entry, members }: { entry: RelationshipLedgerEntry; members: AICharacter[] }) {
  const normalizedEntry = normalizeRelationshipLedgerEntry(entry);
  const presented = buildPresentedRelationshipLedger({ relationshipLedger: [normalizedEntry] } as GroupChat, members)[0];
  const dominantSummary = buildRelationshipDisplaySummary(normalizedEntry);
  const [activeAxis, setActiveAxis] = useState<AxisKey | null>(null);
  const axisReasonMap = normalizedEntry.axisReasons || {};
  const activeMeta = useMemo(() => METRIC_META.find((item) => item.key === activeAxis) || null, [activeAxis]);
  const activeReasons = activeAxis ? (axisReasonMap[activeAxis] || []) : [];

  if (!presented) return null;


  return (
    <RelationshipCardFrame>
      <Stack spacing={0.85} sx={{ minWidth: 0 }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.75, px: 0.25, pt: 0.25 }}>
          <Typography variant="body2" sx={{ fontWeight: 700 }}>{presented.targetName}</Typography>
          <Tooltip title={trendHint(normalizedEntry.trend)} arrow>
            <Chip size="small" label={trendLabel(normalizedEntry.trend)} sx={{ height: 22, fontSize: 11 }} />
          </Tooltip>
          <Tooltip title={summaryHint(dominantSummary)} arrow>
            <Chip size="small" variant="outlined" label={dominantSummary} sx={{ height: 22, fontSize: 11 }} />
          </Tooltip>
        </Box>
        <RelationshipDerivedChips entry={normalizedEntry} />
        <RelationshipEvidenceCard speakerName={presented.speakerName} evidence={presented.evidence || '暂无明确证据'} />
        <RelationshipRadar entry={normalizedEntry} onOpenAxis={setActiveAxis} />
      </Stack>
      <AxisReasonDialog open={Boolean(activeAxis)} onClose={() => setActiveAxis(null)} axisLabel={activeMeta?.label || '关系轴'} reasons={activeReasons} />
    </RelationshipCardFrame>
  );
}

function RelationshipFallbackCard({ memberName, targetName, note, relation, updatedAt }: { memberName: string; targetName: string; note?: string; relation: { warmth: number; competence: number; trust: number; threat: number }; updatedAt: number }) {
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

  return (
    <RelationshipCardFrame>
      <Stack spacing={0.85} sx={{ minWidth: 0 }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.75, px: 0.25, pt: 0.25 }}>
          <Typography variant="body2" sx={{ fontWeight: 700 }}>{targetName}</Typography>
          <Tooltip title="近期没有新证据驱动明显变化。" arrow>
            <Chip size="small" label="持平" sx={{ height: 22, fontSize: 11 }} />
          </Tooltip>
          <Tooltip title={summaryHint(summary)} arrow>
            <Chip size="small" variant="outlined" label={summary} sx={{ height: 22, fontSize: 11 }} />
          </Tooltip>
        </Box>
        <RelationshipEvidenceCard speakerName={memberName} evidence={note || '暂无备注'} />
        <RelationshipRadar entry={fallbackEntry} onOpenAxis={setActiveAxis} />
      </Stack>
      <AxisReasonDialog open={Boolean(activeAxis)} onClose={() => setActiveAxis(null)} axisLabel={activeMeta?.label || '关系轴'} reasons={[]} />
    </RelationshipCardFrame>
  );
}

export default function RelationshipPanel({ chat, members }: RelationshipPanelProps) {
  const isGroupChat = chat.type === 'group';
  const ledgerEntries = (chat.relationshipLedger || [])
    .filter((entry) => !/^draft-\d+$/i.test(entry.actorId) && !/^draft-\d+$/i.test(entry.targetId))
    .filter(isMeaningfulRelationshipLedgerEntry)
    .slice()
    .sort((a, b) => b.lastUpdatedAt - a.lastUpdatedAt);

  return (
    <SurfaceCard>
      <SectionHeader title={isGroupChat ? '关系账本' : '成员信息'} dense />
      {ledgerEntries.length ? (
        <Stack spacing={1.1}>
          {ledgerEntries.slice(0, 8).map((entry) => <RelationshipLedgerCard key={entry.pairKey} entry={entry} members={members} />)}
        </Stack>
      ) : members.length === 0 ? <Typography variant="body2">暂无成员</Typography> : (
        <Stack spacing={1.25}>
          {members.map((member) => (
            <Box key={member.id}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>{member.name}</Typography>
              {member.relationships.length ? (
                <Stack spacing={1} sx={{ mt: 0.5 }}>
                  {member.relationships.slice(0, 3).map((relation, index) => {
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
              ) : (
                <Typography variant="caption" color="text.secondary">暂无明确关系备注</Typography>
              )}
              <Divider sx={{ mt: 1 }} />
            </Box>
          ))}
        </Stack>
      )}
    </SurfaceCard>
  );
}

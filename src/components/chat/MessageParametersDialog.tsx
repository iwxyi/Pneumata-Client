import { Box, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Button, Divider, Stack, Typography } from '@mui/material';
import type { AICharacter } from '../../types/character';
import type { Message } from '../../types/message';
import { projectMessageAffectDebug } from '../../services/dialogueDebugProjection';

type Snapshot = NonNullable<NonNullable<Message['metadata']>['turnParameters']>;

const axisLabels: Array<[keyof Snapshot['relationships'][number], string]> = [
  ['warmth', '亲和'], ['competence', '能力'], ['trust', '信任'],
  ['threat', '威胁'], ['attachment', '在意'], ['deference', '让位'],
];

function Value({ label, value }: { label: string; value: string | number }) {
  return <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}><Box component="span" sx={{ color: 'text.secondary' }}>{label}：</Box>{value}</Typography>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <Box sx={{ py: 1.25 }}><Typography variant="subtitle2" sx={{ mb: 0.75 }}>{title}</Typography><Stack spacing={0.5}>{children}</Stack></Box>;
}

const toneLabels: Record<string, string> = { casual: '平常', defensive: '防御', teasing: '调侃', serious: '认真', tired: '疲惫', vulnerable: '脆弱' };
const hotspotLabels: Record<string, string> = { clear: '平稳', warm: '升温', hot: '紧张' };

export default function MessageParametersDialog({ message, members = [], open, onClose }: { message: Message; members?: AICharacter[]; open: boolean; onClose: () => void }) {
  const snapshot = message.metadata?.turnParameters;
  const affect = projectMessageAffectDebug(message, members);
  return <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
    <DialogTitle>发言参数 · {message.senderName}</DialogTitle>
    <DialogContent dividers sx={{ maxHeight: 'min(70vh, 700px)' }}>
      {!snapshot ? <Typography variant="body2" color="text.secondary">这条消息没有发言快照。旧消息或关闭开发者模式时生成的消息无法还原当时的参数。</Typography> : <>
        <Typography variant="caption" color="text.secondary">情绪、关系及房间态势为生成前的快照；点名对象为模型返回后的结果。</Typography>
        <Section title="即时情绪">
          <Value label="表达语气" value={toneLabels[snapshot.emotion.tone] || snapshot.emotion.tone} />
          <Value label="发言冲动" value={snapshot.emotion.impulse} />
          <Value label="冲动强度" value={snapshot.emotion.pressure.toFixed(2)} />
          <Value label="心境（愉悦 / 唤醒 / 主导）" value={`${snapshot.emotion.mood.pleasure.toFixed(0)} / ${snapshot.emotion.mood.arousal.toFixed(0)} / ${snapshot.emotion.mood.dominance.toFixed(0)}`} />
          {snapshot.emotion.dominant ? <Value label="突出情绪" value={`${snapshot.emotion.dominant.kind} ${snapshot.emotion.dominant.value}`} /> : null}
          {snapshot.emotion.directed ? <Value label="定向情绪" value={`${snapshot.emotion.directed.role} · ${snapshot.emotion.directed.kind} → ${snapshot.emotion.directed.counterpart} (${snapshot.emotion.directed.pressure.toFixed(2)})`} /> : null}
        </Section>
        <Divider />
        <Section title="发言与点名">
          <Value label="发言动作" value={snapshot.plan.move} />
          <Value label="计划关注" value={snapshot.plan.target || '无特定对象'} />
          <Value label="发言前被点名" value={snapshot.plan.addressedBefore ? '是' : '否'} />
          <Value label="计划回应" value={snapshot.plan.intendedRecipients.join('、') || '未指定'} />
          <Value label="实际点名" value={snapshot.delivery.addressedRecipients.join('、') || '未指定'} />
          <Value label="主要对象" value={snapshot.delivery.primaryRecipient || '未指定'} />
          <Value label="本回合气泡" value={snapshot.delivery.bubbleCount} />
        </Section>
        {snapshot.relationships.length ? <><Divider /><Section title="相关关系（发言者视角）">
          {snapshot.relationships.map((relation) => <Box key={relation.target} sx={{ py: 0.5 }}>
            <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>对 {relation.target}</Typography>
            <Stack direction="row" useFlexGap spacing={0.5} sx={{ flexWrap: 'wrap' }}>
              {axisLabels.map(([key, label]) => <Chip key={key} label={`${label} ${relation[key]}`} size="small" variant="outlined" />)}
            </Stack>
          </Box>)}
        </Section></> : null}
        {snapshot.room ? <><Divider /><Section title="房间态势">
          {snapshot.room.hotspot ? <Value label="当前热度" value={hotspotLabels[snapshot.room.hotspot] || snapshot.room.hotspot} /> : null}
          {snapshot.room.heat !== undefined ? <Value label="紧张度" value={snapshot.room.heat} /> : null}
          {snapshot.room.cohesion !== undefined ? <Value label="凝聚度" value={snapshot.room.cohesion} /> : null}
          {snapshot.room.topicDrift !== undefined ? <Value label="话题偏移" value={snapshot.room.topicDrift} /> : null}
        </Section></> : null}
      </>}
      <Divider />
      <Section title="成稿后的模型判断">
        <Typography variant="caption" color="text.secondary">以下是模型随可见发言返回的即时互动信号，不是本地从文字推测；未提供时不会自动补判。</Typography>
        <Box sx={{ pt: 0.5 }}>
          <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>收到的即时影响</Typography>
          {affect.incoming ? <AffectItem item={affect.incoming} /> : <Typography variant="body2" color="text.secondary">模型未提供即时影响判断。</Typography>}
        </Box>
        <Box sx={{ pt: 0.5 }}>
          <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>发言造成的即时影响</Typography>
          {affect.outgoing.length ? affect.outgoing.map((item, index) => <AffectItem key={`${item.target || 'target'}-${index}`} item={item} />) : <Typography variant="body2" color="text.secondary">模型未提供定向即时影响判断。</Typography>}
        </Box>
      </Section>
    </DialogContent>
    <DialogActions><Button onClick={onClose}>关闭</Button></DialogActions>
  </Dialog>;
}

function AffectItem({ item }: { item: NonNullable<ReturnType<typeof projectMessageAffectDebug>['incoming']> }) {
  if (!item) return null;
  const confidence = item.confidence === null ? null : `${Math.round(item.confidence * 100)}%`;
  return <Box sx={{ borderLeft: '2px solid', borderColor: 'divider', pl: 1, py: 0.5, mb: 0.5 }}>
    <Stack direction="row" useFlexGap spacing={0.5} sx={{ flexWrap: 'wrap', mb: 0.5 }}>
      {item.target ? <Chip size="small" label={item.target} /> : null}
      <Chip size="small" variant="outlined" label={item.kind} />
      <Chip size="small" variant="outlined" label={`${item.tone} · 强度 ${item.intensity}`} />
      {confidence ? <Chip size="small" variant="outlined" label={`置信度 ${confidence}`} /> : null}
    </Stack>
    {item.evidence ? <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>依据：「{item.evidence}」</Typography> : <Typography variant="body2" color="text.secondary">没有成稿证据摘录。</Typography>}
    {item.emotionDeltas.length ? <Value label="对象情绪变化" value={item.emotionDeltas.join('、')} /> : null}
    {item.speakerEmotionDeltas.length ? <Value label="发言者情绪变化" value={item.speakerEmotionDeltas.join('、')} /> : null}
    {item.roomDeltas.length ? <Value label="房间态势变化" value={item.roomDeltas.join('、')} /> : null}
  </Box>;
}

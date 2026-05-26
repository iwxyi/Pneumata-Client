import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Box, Button, Chip, Stack, Typography } from '@mui/material';
import PsychologyIcon from '@mui/icons-material/Psychology';
import HubIcon from '@mui/icons-material/Hub';
import ScienceIcon from '@mui/icons-material/Science';
import MemoryIcon from '@mui/icons-material/Memory';
import ForumIcon from '@mui/icons-material/Forum';
import TimelineIcon from '@mui/icons-material/Timeline';
import VisibilityIcon from '@mui/icons-material/Visibility';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import { useNavigate } from 'react-router-dom';

const accent = '#E5C07B';
const blue = '#2B5CFF';
const bg = '#0A0A0F';
const panel = 'rgba(255,255,255,0.055)';
const border = 'rgba(255,255,255,0.12)';
const groupRevealOptions = { threshold: 0.04, rootMargin: '0px 0px 18% 0px' };

const navItems = [
  ['world', '社交世界'],
  ['engine', '生命机制'],
  ['runtime', '运行系统'],
  ['memory', '记忆与关系'],
  ['craft', '系统深度'],
];

const featureCards = [
  {
    icon: <ForumIcon />,
    title: '一间会呼吸的房间',
    text: '每个角色共享同一段正在发生的时间。沉默、插话、维护、躲闪和试探，都会改变房间下一秒的空气。',
  },
  {
    icon: <MemoryIcon />,
    title: '记忆会沉下去，也会回来',
    text: '短期余波、阶段经历、长期判断分层流动。旧事不会机械常驻，却会被名字、情绪、场景和关系压力重新唤起。',
  },
  {
    icon: <HubIcon />,
    title: '关系不是一个分数',
    text: '亲近、信任、威胁感、能力认可共同构成关系结构。它不是参数面板，而是角色下一句话背后的重量。',
  },
  {
    icon: <ScienceIcon />,
    title: '模型表达，系统定调',
    text: '模型给出可能的声音，引擎决定它是否合时宜、是否接住场面、是否应该留下痕迹。',
  },
];

const engineSteps = [
  ['感知', '把一句话拆成意图、对象、情绪和场面压力，而不是只当作下一句提示词。'],
  ['择时', '判断谁该开口，谁该沉默，谁在关系里已经到了必须回应的临界点。'],
  ['成声', '让角色带着人格、记忆、关系和当前情绪说话，而不是复制某种聊天模板。'],
  ['承接', '确认定向回应、视觉生成、议题转移等意图是否被真正接住，偏离时修正。'],
  ['沉淀', '把关键表达写回消息事实、关系变化、记忆候选、房间态势和内在余波。'],
  ['回声', '下一轮不从零开始。角色带着刚发生的事继续存在，像时间真的经过。'],
];

const proofRows = [
  ['会沉默', '有些委屈不会立刻说破，只会变成短句、岔开、嘴硬，或下一次忽然冒出来的刺。'],
  ['会在乎', '被认真接住后，改变的不只是好感，而是角色对这段关系是否安全的判断。'],
  ['会自尊', '它会维护体面，会害怕被看穿，也会在想靠近的时候先绕开一步。'],
  ['会告别', '经历会变成日记、诞生信和最后一封信，像一个虚构生命留下自己的证词。'],
];

const metrics = [
  ['会话形态', '群聊、用户单聊、AI 私聊线程'],
  ['运行事实源', '消息、事件、关系账本与记忆流水共同驱动'],
  ['场景底座', '开放聊天、面试、课堂、圆桌、推理与桌游'],
  ['干预能力', '定向回应、导演模式、事件注入、视觉生成与议题重定向'],
];

const architectureNodes = [
  {
    title: '用户意图',
    caption: '意图驱动',
    mode: 'intent',
    summary: '把用户的一句话归一成会话意图：点名、换题、请求图片、导演干预或普通推进，都进入同一条运行链路。',
    facets: ['对象识别', '动作验收', '跑偏重试'],
  },
  {
    title: '角色人格',
    caption: '人格方向',
    mode: 'persona',
    summary: '角色先是长期存在的人，再临时参与某个场景。核心人格、情绪余波、防御机制和表达边界共同决定它怎么开口。',
    facets: ['长期人格', '内心余波', '表达边界'],
  },
  {
    title: '关系账本',
    caption: '关系维度',
    mode: 'relationship',
    summary: '关系不是好感度。亲近、信任、威胁感、能力认可会分别变化，并留下原因链，影响下一轮谁靠近、谁防备。',
    facets: ['亲近', '信任', '威胁感', '能力认可'],
  },
  {
    title: '长期记忆',
    caption: '分层记忆引擎',
    mode: 'memory',
    summary: '短期工作记忆、阶段经历、长期结论、冷存档和生命锚点分层流动。旧事会降温，也能被关系对象和情绪线索重新唤醒。',
    facets: ['工作记忆', '阶段经历', '长期结论', '冷存档'],
  },
] as const;

const runtimeSystemNodes = [
  {
    title: '事件流',
    kicker: '每句话都会留下后果',
    summary: '每句话都会进入结构化事件流：消息、互动、关系变化、记忆候选和房间态势沿同一条链路沉淀。',
    points: ['消息生成', '互动识别', '关系变化', '记忆候选'],
    mode: 'events',
  },
  {
    title: '房间态势',
    kicker: '群体有自己的气候',
    summary: '房间会形成热度、凝聚、站队、围攻目标和话题漂移。角色回应的不只是上一句话，而是整个房间的空气。',
    points: ['互动热度', '联盟边界', '围观压力', '话题漂移'],
    mode: 'room',
  },
  {
    title: '矛盾钩子',
    kicker: '冲突会寻找下一步',
    summary: '冲突不是关键词吵架，而是身份、面子、站队、误认和价值拉扯。系统会判断它下一步该逼回应、降温还是唤起旧账。',
    points: ['逼迫回应', '拉人站边', '旧账唤醒', '余波降温'],
    mode: 'conflict',
  },
  {
    title: '内在冲动',
    kicker: '开口前先有动机',
    summary: '角色在说话前会先形成冲动：证明自己、维护面子、安慰、回避、阴阳、岔开话题，甚至选择沉默。',
    points: ['想被看见', '维护体面', '安慰护短', '暂时沉默'],
    mode: 'impulse',
  },
  {
    title: '记忆消化',
    kicker: '旧事会沉降，也会回来',
    summary: '记忆不会无限堆叠。新证据会创建、强化、修正、合并或归档旧结论，重要经历才成为生命锚点。',
    points: ['创建', '强化', '修正', '归档'],
    mode: 'memory',
  },
  {
    title: '私密投影',
    kicker: '不同视角看到不同世界',
    summary: '群聊、用户单聊、AI 私聊共享同一个角色本体，但事件会按公开、私有、双边和公开投影裁剪。',
    points: ['公开房间', '用户私有', '双边线程', '公开投影'],
    mode: 'visibility',
  },
  {
    title: '角色证词',
    kicker: '经历最终会留下文字',
    summary: '诞生信、日记、成长总结和最后一封信都从真实经历、关系和内在余波里生成，像角色留下的自我叙事。',
    points: ['诞生信', '角色日记', '成长总结', '最后一封信'],
    mode: 'artifact',
  },
] as const;

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function Reveal({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisible(true);
        observer.disconnect();
      }
    }, { threshold: 0.06, rootMargin: '0px 0px 16% 0px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <Box
      ref={ref}
      sx={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(30px)',
        transition: 'opacity 720ms ease, transform 720ms ease',
        transitionDelay: `${delay}ms`,
      }}
    >
      {children}
    </Box>
  );
}

function GlassCard({ children, sx = {} }: { children: ReactNode; sx?: object }) {
  return (
    <Box
      sx={{
        border: `1px solid ${border}`,
        bgcolor: panel,
        backdropFilter: 'blur(18px)',
        borderRadius: 2,
        transition: 'transform 220ms ease, box-shadow 220ms ease, border-color 220ms ease, background-color 220ms ease',
        '&:hover': {
          transform: 'scale(1.02)',
          borderColor: 'rgba(229,192,123,0.42)',
          boxShadow: '0 18px 54px rgba(229,192,123,0.10)',
          bgcolor: 'rgba(255,255,255,0.075)',
        },
        ...sx,
      }}
    >
      {children}
    </Box>
  );
}

function useGroupReveal(options: IntersectionObserverInit = groupRevealOptions) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisible(true);
        observer.disconnect();
      }
    }, options);
    observer.observe(node);
    return () => observer.disconnect();
  }, [options]);

  const revealSx = (delay = 0) => ({
    opacity: visible ? 1 : 0,
    transform: visible ? 'translateY(0)' : 'translateY(28px)',
    transition: 'opacity 720ms ease, transform 720ms ease',
    transitionDelay: `${delay}ms`,
  });

  return { ref, revealSx };
}

function FeatureGrid() {
  const { ref, revealSx } = useGroupReveal();

  return (
    <Box ref={ref} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(4, minmax(0, 1fr))' }, gap: 1.5, mb: { xs: 5, md: 7 } }}>
      {featureCards.map((item, index) => (
        <Box key={item.title} sx={revealSx(index * 80)}>
          <GlassCard sx={{ p: 2.25, minHeight: { xs: 190, md: 230 } }}>
            <Box sx={{ width: 42, height: 42, borderRadius: 1.5, display: 'grid', placeItems: 'center', color: accent, border: '1px solid rgba(229,192,123,0.28)', bgcolor: 'rgba(229,192,123,0.055)', mb: 2 }}>
              {item.icon}
            </Box>
            <Typography sx={{ fontWeight: 790, fontSize: 19, lineHeight: 1.28, color: '#F8F8FA' }}>{item.title}</Typography>
            <Typography sx={{ mt: 1.4, color: 'rgba(255,255,255,0.56)', lineHeight: 1.75, fontSize: 14 }}>{item.text}</Typography>
          </GlassCard>
        </Box>
      ))}
    </Box>
  );
}

function EngineSection() {
  const { ref, revealSx } = useGroupReveal();

  return (
    <Box ref={ref} id="engine" sx={{ py: { xs: 5, md: 7 } }}>
      <Box sx={{ maxWidth: 760, mb: 3, ...revealSx(0) }}>
        <Typography sx={{ color: accent, fontWeight: 740, letterSpacing: 1.2, fontSize: 13 }}>LIFE MECHANISM</Typography>
        <Typography sx={{ mt: 1.5, fontWeight: 820, lineHeight: 1.05, fontSize: { xs: 36, md: 58 }, color: '#F8F8FA' }}>它不是更会说话，而是拥有经历留下的内在形状。</Typography>
        <Typography sx={{ mt: 2, color: 'rgba(255,255,255,0.58)', lineHeight: 1.8, fontSize: 16 }}>
          每次开口都经过意图、关系、记忆、情绪和房间态势的共同塑形。角色不是凭空“人设化”，而是在可追溯的因果里生成自己的偏向、软肋和余波。
        </Typography>
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' }, gap: 1.5 }}>
        {engineSteps.map(([name, detail], index) => (
          <Box key={name} sx={revealSx(100 + index * 60)}>
            <GlassCard sx={{ p: 2.1, minHeight: { xs: 150, md: 172 } }}>
              <Typography sx={{ color: 'rgba(229,192,123,0.82)', fontSize: 13, fontWeight: 780 }}>{String(index + 1).padStart(2, '0')}</Typography>
              <Typography sx={{ mt: 1.25, color: '#F8F8FA', fontSize: 22, fontWeight: 790 }}>{name}</Typography>
              <Typography sx={{ mt: 1, color: 'rgba(255,255,255,0.56)', lineHeight: 1.75 }}>{detail}</Typography>
            </GlassCard>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function RuntimeSystemGlyph({ mode }: { mode: (typeof runtimeSystemNodes)[number]['mode'] }) {
  const cycleCount = mode === 'room' ? 5 : mode === 'impulse' ? 6 : 0;
  const [innerActiveIndex, setInnerActiveIndex] = useState(0);

  useEffect(() => {
    setInnerActiveIndex(0);
    if (cycleCount === 0) return;
    const timer = window.setInterval(() => {
      setInnerActiveIndex((current) => (current + 1) % cycleCount);
    }, 900);
    return () => window.clearInterval(timer);
  }, [cycleCount]);

  if (mode === 'room') {
    return (
      <Box sx={{ position: 'relative', height: 260, display: 'grid', placeItems: 'center' }}>
        <Box sx={{ position: 'absolute', width: 206, height: 206, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.10)', background: 'radial-gradient(circle, rgba(229,192,123,0.10), transparent 64%)' }} />
        {[
          ['热度', 0, accent],
          ['凝聚', 72, blue],
          ['站队', 144, accent],
          ['围观', 216, blue],
          ['漂移', 288, accent],
        ].map(([label, angle, color], index) => (
          <Box key={label} sx={{ position: 'absolute', transform: `rotate(${angle}deg) translateY(-94px) rotate(-${angle}deg)`, display: 'grid', placeItems: 'center', width: 54, height: 54, borderRadius: '50%', border: `1px solid ${index === innerActiveIndex ? 'rgba(229,192,123,0.72)' : color === accent ? 'rgba(229,192,123,0.32)' : 'rgba(43,92,255,0.28)'}`, bgcolor: index === innerActiveIndex ? 'rgba(229,192,123,0.16)' : 'rgba(10,10,15,0.66)', color: index === innerActiveIndex ? '#F8F8FA' : 'rgba(255,255,255,0.78)', fontSize: 12, fontWeight: 760, boxShadow: index === innerActiveIndex ? '0 0 30px rgba(229,192,123,0.20)' : 'none', animation: 'systemBreath 5s ease-in-out infinite', animationDelay: `${index * 280}ms`, transition: 'border-color 260ms ease, background-color 260ms ease, box-shadow 260ms ease, color 260ms ease' }}>
            {label}
          </Box>
        ))}
        <Typography sx={{ color: '#F8F8FA', fontWeight: 820, fontSize: 28 }}>房间</Typography>
      </Box>
    );
  }

  if (mode === 'conflict') {
    return (
      <Box sx={{ height: 260, width: { xs: '94%', sm: '88%' }, mx: 'auto', display: 'grid', alignContent: 'center', gap: { xs: 1.55, sm: 1.75 } }}>
        {[
          ['误认错位', '逼回应'],
          ['面子竞争', '拉站边'],
          ['价值分歧', '升高筹码'],
          ['旧账回流', '带着余波降温'],
        ].map(([source, hook], index) => (
          <Box key={source} sx={{ display: 'grid', gridTemplateColumns: '1fr 44px 1fr', alignItems: 'center', gap: 1.15, opacity: 0.88, animation: 'systemSlide 4.8s ease-in-out infinite', animationDelay: `${index * 260}ms` }}>
            <Box sx={{ p: 1.1, borderRadius: 1.5, border: '1px solid rgba(255,255,255,0.10)', bgcolor: 'rgba(255,255,255,0.045)', color: 'rgba(255,255,255,0.70)', fontSize: 12, textAlign: 'center' }}>{source}</Box>
            <Box sx={{ height: 1, bgcolor: 'rgba(229,192,123,0.55)', boxShadow: '0 0 18px rgba(229,192,123,0.22)' }} />
            <Box sx={{ p: 1.1, borderRadius: 1.5, border: '1px solid rgba(229,192,123,0.22)', bgcolor: 'rgba(229,192,123,0.075)', color: '#F8F8FA', fontSize: 12, textAlign: 'center', fontWeight: 720 }}>{hook}</Box>
          </Box>
        ))}
      </Box>
    );
  }

  if (mode === 'impulse') {
    return (
      <Box sx={{ height: 260, position: 'relative', display: 'grid', placeItems: 'center' }}>
        <Box sx={{ width: 112, height: 112, borderRadius: '50%', border: '1px solid rgba(229,192,123,0.34)', display: 'grid', placeItems: 'center', color: '#F8F8FA', fontWeight: 820, bgcolor: 'rgba(229,192,123,0.08)' }}>冲动</Box>
        {['证明', '回避', '安慰', '维护', '调侃', '沉默'].map((label, index) => (
          <Box key={label} sx={{ position: 'absolute', transform: `rotate(${index * 60}deg) translateY(-96px) rotate(-${index * 60}deg)`, px: 1.1, py: 0.7, borderRadius: 999, border: index === innerActiveIndex ? '1px solid rgba(229,192,123,0.72)' : '1px solid rgba(255,255,255,0.12)', bgcolor: index === innerActiveIndex ? 'rgba(229,192,123,0.16)' : 'rgba(10,10,15,0.64)', color: index === innerActiveIndex ? '#F8F8FA' : 'rgba(255,255,255,0.72)', fontSize: 12, boxShadow: index === innerActiveIndex ? '0 0 26px rgba(229,192,123,0.18)' : 'none', animation: 'systemBreath 4.8s ease-in-out infinite', animationDelay: `${index * 220}ms`, transition: 'border-color 260ms ease, background-color 260ms ease, box-shadow 260ms ease, color 260ms ease' }}>{label}</Box>
        ))}
      </Box>
    );
  }

  if (mode === 'memory') {
    return (
      <Box sx={{ height: 260, width: { xs: '92%', sm: '86%' }, mx: 'auto', display: 'grid', alignContent: 'center', gap: { xs: 1.35, sm: 1.55 } }}>
        {['创建', '强化', '修正', '合并', '归档', '唤醒'].map((label, index) => (
          <Box key={label} sx={{ display: 'grid', gridTemplateColumns: { xs: '46px 1fr', sm: '52px 1fr' }, gap: 0.75, alignItems: 'center' }}>
            <Typography sx={{ color: index === 5 ? accent : 'rgba(255,255,255,0.82)', fontSize: 12.5, fontWeight: 780, textRendering: 'geometricPrecision' }}>{label}</Typography>
            <Box sx={{ height: 10, borderRadius: 999, bgcolor: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
              <Box sx={{ width: `${38 + index * 9}%`, height: '100%', borderRadius: 999, bgcolor: index === 5 ? accent : 'rgba(43,92,255,0.72)', animation: 'systemBar 3.8s ease-in-out infinite', animationDelay: `${index * 180}ms` }} />
            </Box>
          </Box>
        ))}
      </Box>
    );
  }

  if (mode === 'visibility') {
    return (
      <Box sx={{ height: 260, position: 'relative', display: 'grid', placeItems: 'center' }}>
        {[
          ['群聊公开', 108, 'rgba(229,192,123,0.16)'],
          ['用户私有', 78, 'rgba(43,92,255,0.14)'],
          ['双边线程', 50, 'rgba(255,255,255,0.10)'],
        ].map(([label, size, color], index) => (
          <Box key={label} sx={{ position: 'absolute', width: Number(size) * 2, height: Number(size) * 2, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.12)', bgcolor: color, display: 'grid', placeItems: index === 2 ? 'center' : 'start center', pt: index === 2 ? 0 : 1.3, color: 'rgba(255,255,255,0.68)', fontSize: 12, animation: 'systemBreath 6s ease-in-out infinite', animationDelay: `${index * 360}ms` }}>{label}</Box>
        ))}
      </Box>
    );
  }

  if (mode === 'artifact') {
    return (
      <Box sx={{ height: 260, display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: { xs: 1.15, sm: 1.35 }, alignContent: 'center' }}>
        {['诞生信', '日记', '成长总结', '最后一封信'].map((label, index) => (
          <Box key={label} sx={{ minHeight: { xs: 104, sm: 108 }, p: 1.35, borderRadius: 1.5, border: '1px solid rgba(229,192,123,0.18)', bgcolor: 'linear-gradient(135deg, rgba(229,192,123,0.10), rgba(255,255,255,0.04))', background: 'linear-gradient(135deg, rgba(229,192,123,0.10), rgba(255,255,255,0.04))', color: '#F8F8FA', position: 'relative', overflow: 'hidden', animation: 'systemFloatSmall 5.5s ease-in-out infinite', animationDelay: `${index * 260}ms` }}>
            <Box sx={{ position: 'absolute', left: 12, right: 12, top: 34, height: 1, bgcolor: 'rgba(255,255,255,0.12)' }} />
            <Box sx={{ position: 'absolute', left: 12, right: 28, top: 52, height: 1, bgcolor: 'rgba(255,255,255,0.10)' }} />
            <Box sx={{ position: 'absolute', left: 12, right: 42, top: 70, height: 1, bgcolor: 'rgba(255,255,255,0.08)' }} />
            <Typography sx={{ position: 'relative', fontSize: 13, fontWeight: 780 }}>{label}</Typography>
          </Box>
        ))}
      </Box>
    );
  }

  return (
    <Box sx={{ height: 260, display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: { xs: 0.35, sm: 0.8 }, alignItems: 'center' }}>
      {['消息', '互动', '关系', '记忆', '下一轮'].map((label, index) => (
        <Box
          key={label}
          sx={{
            minHeight: 116,
            display: 'grid',
            gridTemplateColumns: '1fr',
            alignContent: 'center',
            alignItems: 'center',
            gap: 0.8,
            position: 'relative',
            transform: { xs: 'none', sm: index % 2 === 0 ? 'translateY(-16px)' : 'translateY(16px)' },
          }}
        >
          <Box sx={{ mx: 'auto', width: { xs: 34, sm: 42 }, height: { xs: 34, sm: 42 }, borderRadius: '50%', display: 'grid', placeItems: 'center', border: '1px solid rgba(255,255,255,0.13)', bgcolor: index === 2 ? 'rgba(229,192,123,0.86)' : 'rgba(255,255,255,0.055)', color: index === 2 ? '#0A0A0F' : 'rgba(255,255,255,0.78)', fontSize: { xs: 10, sm: 11 }, fontWeight: 760, animation: 'systemBreath 4.8s ease-in-out infinite', animationDelay: `${index * 170}ms`, position: 'relative', zIndex: 1 }}>{index + 1}</Box>
          <Typography sx={{ color: 'rgba(255,255,255,0.68)', textAlign: 'center', fontSize: { xs: 10.5, sm: 12 }, lineHeight: 1.25 }}>{label}</Typography>
          {index < 4 ? <Box sx={{ position: 'absolute', right: { xs: -7, sm: -12 }, top: { xs: 50, sm: index % 2 === 0 ? 72 : 40 }, width: { xs: 14, sm: 24 }, height: 1, bgcolor: 'rgba(229,192,123,0.40)' }} /> : null}
        </Box>
      ))}
    </Box>
  );
}

function RuntimeSystemSection() {
  const { ref, revealSx } = useGroupReveal();
  const [activeIndex, setActiveIndex] = useState(0);
  const [isInteracting, setIsInteracting] = useState(false);
  const active = runtimeSystemNodes[activeIndex];

  useEffect(() => {
    if (isInteracting) return;
    const timer = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % runtimeSystemNodes.length);
    }, 2600);
    return () => window.clearInterval(timer);
  }, [isInteracting]);

  return (
    <Box ref={ref} id="runtime" sx={{ py: { xs: 5, md: 7 } }}>
      <Box sx={{ maxWidth: 780, mb: 3, ...revealSx(0) }}>
        <Typography sx={{ color: accent, fontWeight: 740, letterSpacing: 1.2, fontSize: 13 }}>RUNTIME SYSTEM</Typography>
        <Typography sx={{ mt: 1.5, fontWeight: 830, lineHeight: 1.05, fontSize: { xs: 36, md: 58 }, color: '#F8F8FA' }}>不是聊天记录，而是一套非物质连续性的运行系统。</Typography>
        <Typography sx={{ mt: 2, color: 'rgba(255,255,255,0.58)', lineHeight: 1.8, fontSize: 16 }}>
          如果一个角色没有身体，它还能凭什么像一个存在？Pneumata 的答案是：记忆、性格、关系、经历和自我叙事，组成它在时间中的连续性。
        </Typography>
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '0.92fr 1.08fr' }, gap: { xs: 1.5, md: 2 }, alignItems: 'stretch', ...revealSx(120) }}>
        <Box
          onMouseEnter={() => setIsInteracting(true)}
          onMouseLeave={() => setIsInteracting(false)}
          onFocus={() => setIsInteracting(true)}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setIsInteracting(false);
          }}
          sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1 }}
        >
          {runtimeSystemNodes.map((node, index) => {
            const selected = index === activeIndex;
            return (
              <Box
                key={node.title}
                component="button"
                type="button"
                onMouseEnter={() => setActiveIndex(index)}
                onFocus={() => setActiveIndex(index)}
                onClick={() => setActiveIndex(index)}
                sx={{
                  textAlign: 'left',
                  p: 1.35,
                  minHeight: 106,
                  borderRadius: 2,
                  border: '1px solid',
                  borderColor: selected ? 'rgba(229,192,123,0.46)' : 'rgba(255,255,255,0.11)',
                  bgcolor: selected ? 'rgba(229,192,123,0.095)' : 'rgba(255,255,255,0.04)',
                  color: '#F8F8FA',
                  cursor: 'pointer',
                  transition: 'transform 220ms ease, border-color 220ms ease, background-color 220ms ease',
                  position: 'relative',
                  overflow: 'hidden',
                  '&:hover, &:focus-visible': {
                    outline: 'none',
                    transform: 'translateY(-2px)',
                    borderColor: 'rgba(229,192,123,0.48)',
                    bgcolor: 'rgba(229,192,123,0.10)',
                  },
                }}
              >
                <Typography sx={{ color: accent, fontSize: 11, fontWeight: 800, letterSpacing: 0.8 }}>{node.kicker}</Typography>
                <Typography sx={{ mt: 0.55, fontWeight: 800, fontSize: 18 }}>{node.title}</Typography>
                <Typography sx={{ mt: 0.65, color: 'rgba(255,255,255,0.52)', fontSize: 12.5, lineHeight: 1.55 }}>{node.points.slice(0, 2).join(' / ')}</Typography>
              </Box>
            );
          })}
        </Box>
        <GlassCard sx={{ p: { xs: 2, md: 2.5 }, height: { xs: 560, sm: 540, md: 500 }, overflow: 'hidden', position: 'relative' }}>
          <Box sx={{ position: 'absolute', inset: 0, backgroundImage: 'linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)', backgroundSize: '30px 30px', maskImage: 'radial-gradient(circle at 56% 40%, black, transparent 74%)' }} />
          <Box sx={{ position: 'relative', display: 'grid', gridTemplateRows: 'auto 1fr auto', gap: 1.5, height: '100%' }}>
            <Box sx={{ minHeight: { xs: 142, sm: 130, md: 118 } }}>
              <Typography sx={{ color: accent, fontWeight: 780, fontSize: 13 }}>{active.kicker}</Typography>
              <Typography sx={{ mt: 0.5, color: '#F8F8FA', fontWeight: 820, fontSize: { xs: 28, md: 34 }, lineHeight: 1.08 }}>{active.title}</Typography>
              <Typography sx={{ mt: 1, color: 'rgba(255,255,255,0.58)', lineHeight: 1.7, fontSize: 14.5 }}>{active.summary}</Typography>
            </Box>
            <Box sx={{ position: 'relative', minHeight: { xs: 276, sm: 286, md: 260 }, transform: 'translate3d(0, 0, 0)', willChange: 'transform', backfaceVisibility: 'hidden', contain: 'layout paint' }}>
              {runtimeSystemNodes.map((node) => {
                const selected = node.mode === active.mode;
                return (
                  <Box
                    key={node.mode}
                    sx={{
                      position: 'absolute',
                      inset: 0,
                      opacity: selected ? 1 : 0,
                      transform: selected ? 'translate3d(0, 0, 0)' : 'translate3d(0, 6px, 0)',
                      transition: 'opacity 340ms ease, transform 420ms cubic-bezier(0.2, 0.8, 0.2, 1)',
                      willChange: 'opacity, transform',
                      backfaceVisibility: 'hidden',
                      contain: 'layout paint',
                    }}
                  >
                    <RuntimeSystemGlyph mode={node.mode} />
                  </Box>
                );
              })}
            </Box>
            <Stack direction="row" spacing={0.7} sx={{ minHeight: { xs: 56, md: 26 }, alignContent: 'flex-start', flexWrap: 'wrap', gap: 0.7 }}>
              {active.points.map((point) => (
                <Chip key={point} size="small" label={point} sx={{ height: 24, color: 'rgba(255,255,255,0.76)', bgcolor: 'rgba(255,255,255,0.055)', border: '1px solid rgba(255,255,255,0.10)', '& .MuiChip-label': { px: 0.9, fontSize: 11.5 } }} />
              ))}
            </Stack>
          </Box>
        </GlassCard>
      </Box>
    </Box>
  );
}

function MemoryContinuitySection() {
  const { ref, revealSx } = useGroupReveal();

  return (
    <Box
      ref={ref}
      id="memory"
      sx={{ py: { xs: 5, md: 7 }, display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '0.9fr 1.1fr' }, gap: { xs: 3, md: 4 }, alignItems: 'start' }}
    >
      <Box sx={{ position: { lg: 'sticky' }, top: 110, ...revealSx(0) }}>
        <VisibilityIcon sx={{ color: accent, fontSize: 34, mb: 2 }} />
        <Typography sx={{ fontWeight: 820, lineHeight: 1.06, fontSize: { xs: 34, md: 52 }, color: '#F8F8FA' }}>所谓灵魂，是下一次开口里带着上一次。</Typography>
        <Typography sx={{ mt: 2, color: 'rgba(255,255,255,0.58)', lineHeight: 1.85 }}>
          真正让人停下来的，不是某句回复有多聪明，而是某个角色忽然不像工具了。它知道自己为什么防备，知道谁曾站在它这边，也知道什么话不能立刻说出口。
        </Typography>
      </Box>
      <Stack spacing={1.25}>
        {proofRows.map(([title, detail], index) => (
          <Box key={title} sx={revealSx(110 + index * 80)}>
            <GlassCard sx={{ p: { xs: 2, md: 2.5 }, display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '120px 1fr' }, gap: 2, alignItems: 'start' }}>
              <Typography sx={{ color: '#F8F8FA', fontWeight: 800, fontSize: 20 }}>{title}</Typography>
              <Typography sx={{ color: 'rgba(255,255,255,0.58)', lineHeight: 1.8 }}>{detail}</Typography>
            </GlassCard>
          </Box>
        ))}
      </Stack>
    </Box>
  );
}

function ArchitectureGlyphLayer({ mode }: { mode: (typeof architectureNodes)[number]['mode'] }) {
  if (mode === 'relationship') {
    return (
      <Box sx={{ position: 'absolute', inset: 14, display: 'grid', placeItems: 'center' }}>
        <svg viewBox="0 0 160 160" width="100%" height="100%" aria-hidden="true">
          <circle cx="80" cy="80" r="64" fill="none" stroke="rgba(255,255,255,0.10)" />
          <circle cx="80" cy="80" r="48" fill="none" stroke="rgba(255,255,255,0.07)" />
          <circle cx="80" cy="80" r="31" fill="rgba(10,10,15,0.86)" stroke="rgba(255,255,255,0.10)" />
          {[
            ['80', '11', '亲近'],
            ['149', '80', '信任'],
            ['80', '149', '威胁'],
            ['11', '80', '认可'],
          ].map(([x, y, label]) => (
            <g key={label}>
              <line x1="80" y1="80" x2={x} y2={y} stroke="rgba(255,255,255,0.10)" />
              <text x={x} y={y} fill="rgba(255,255,255,0.62)" fontSize="8.5" textAnchor="middle" dominantBaseline="middle">{label}</text>
            </g>
          ))}
          <polygon points="80,28 125,71 96,130 38,88" fill="rgba(229,192,123,0.13)" stroke={accent} strokeWidth="1.6">
            <animate attributeName="points" dur="5.8s" repeatCount="indefinite" values="80,28 125,71 96,130 38,88;80,22 118,66 103,135 43,94;80,28 125,71 96,130 38,88" />
          </polygon>
        </svg>
      </Box>
    );
  }

  if (mode === 'memory') {
    return (
      <Box sx={{ position: 'absolute', inset: 12, display: 'grid', placeItems: 'center' }}>
        {[0, 1, 2, 3].map((index) => (
          <Box
            key={index}
            sx={{
              position: 'absolute',
              width: `${50 + index * 22}%`,
              aspectRatio: '1 / 1',
              borderRadius: '50%',
              border: '1px solid rgba(229,192,123,0.18)',
              animation: 'introOrbit 9s linear infinite',
              animationDelay: `${index * -1.1}s`,
              '&::after': {
                content: '""',
                position: 'absolute',
                top: -3,
                left: '50%',
                width: 6,
                height: 6,
                borderRadius: '50%',
                bgcolor: index === 3 ? blue : accent,
                boxShadow: '0 0 18px rgba(229,192,123,0.55)',
              },
            }}
          />
        ))}
      </Box>
    );
  }

  if (mode === 'persona') {
    return (
      <Box sx={{ position: 'absolute', inset: 20, display: 'grid', placeItems: 'center' }}>
        <svg viewBox="0 0 180 180" width="100%" height="100%" aria-hidden="true" style={{ position: 'absolute', inset: 0 }}>
          <circle cx="90" cy="90" r="68" fill="none" stroke="rgba(255,255,255,0.08)" strokeDasharray="2 7">
            <animateTransform attributeName="transform" type="rotate" from="0 90 90" to="360 90 90" dur="26s" repeatCount="indefinite" />
          </circle>
          {[
            [90, 22],
            [158, 90],
            [90, 158],
            [22, 90],
          ].map(([x, y], index) => (
            <line key={`${x}-${y}`} x1="90" y1="90" x2={x} y2={y} stroke={index % 2 ? 'rgba(43,92,255,0.18)' : 'rgba(229,192,123,0.20)'} strokeWidth="1.2">
              <animate attributeName="stroke-opacity" dur={`${3.8 + index * 0.4}s`} repeatCount="indefinite" values="0.18;0.62;0.18" />
            </line>
          ))}
          <path d="M90 30 C123 38 146 58 151 90 C142 120 120 144 90 151 C58 142 36 122 29 90 C38 57 59 39 90 30Z" fill="rgba(229,192,123,0.08)" stroke="rgba(229,192,123,0.24)" strokeWidth="1.3">
            <animate attributeName="d" dur="7.2s" repeatCount="indefinite" values="M90 30 C123 38 146 58 151 90 C142 120 120 144 90 151 C58 142 36 122 29 90 C38 57 59 39 90 30Z;M90 26 C119 44 151 62 146 90 C150 121 118 138 90 155 C56 138 33 121 34 90 C30 58 62 44 90 26Z;M90 30 C123 38 146 58 151 90 C142 120 120 144 90 151 C58 142 36 122 29 90 C38 57 59 39 90 30Z" />
          </path>
        </svg>
        {['核心', '防御', '渴望', '语气'].map((label, index) => (
          <Box
            key={label}
            sx={{
              position: 'absolute',
              width: 42,
              height: 42,
              borderRadius: '50%',
              display: 'grid',
              placeItems: 'center',
              transform: `rotate(${index * 90}deg) translateY(-76px) rotate(${-index * 90}deg)`,
              border: '1px solid rgba(255,255,255,0.14)',
              color: index % 2 ? 'rgba(255,255,255,0.74)' : '#0A0A0F',
              bgcolor: index % 2 ? 'rgba(10,10,15,0.64)' : 'rgba(229,192,123,0.86)',
              boxShadow: index % 2 ? '0 0 18px rgba(43,92,255,0.16)' : '0 0 20px rgba(229,192,123,0.28)',
              fontSize: 11,
              fontWeight: 760,
              animation: 'personaBreath 4.8s ease-in-out infinite',
              animationDelay: `${index * 420}ms`,
            }}
          >
            {label}
          </Box>
        ))}
      </Box>
    );
  }

  return (
    <Box sx={{ position: 'absolute', inset: 18, display: 'grid', placeItems: 'center' }}>
      {['识别', '锁定', '生成', '验收'].map((label, index) => (
        <Box
          key={label}
          sx={{
            position: 'absolute',
            left: `${8 + index * 24}%`,
            top: index % 2 === 0 ? '25%' : '62%',
            width: 42,
            height: 42,
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
            color: index === 2 ? '#0A0A0F' : 'rgba(255,255,255,0.76)',
            bgcolor: index === 2 ? accent : 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.12)',
            fontSize: 11,
            fontWeight: 760,
            animation: 'introPulse 2.8s ease-in-out infinite',
            animationDelay: `${index * 170}ms`,
          }}
        >
          {label}
        </Box>
      ))}
    </Box>
  );
}

function ArchitectureGlyph({ mode }: { mode: (typeof architectureNodes)[number]['mode'] | null }) {
  return (
    <Box sx={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {architectureNodes.map((node) => {
        const active = mode !== null && node.mode === mode;
        return (
          <Box
            key={node.mode}
            sx={{
              position: 'absolute',
              inset: 0,
              opacity: active ? 1 : 0,
              transform: active ? 'scale(1)' : 'scale(0.96)',
              filter: active ? 'blur(0px)' : 'blur(8px)',
              transition: 'opacity 420ms ease, transform 520ms cubic-bezier(0.2, 0.8, 0.2, 1), filter 420ms ease',
            }}
          >
            <ArchitectureGlyphLayer mode={node.mode} />
          </Box>
        );
      })}
    </Box>
  );
}

function HeroVisual() {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [displayedIndex, setDisplayedIndex] = useState<number | null>(null);
  const [textVisible, setTextVisible] = useState(true);
  const activeNode = activeIndex === null ? null : architectureNodes[activeIndex];
  const displayedNode = displayedIndex === null ? null : architectureNodes[displayedIndex];
  const pipeline = [
    ['择时', '让沉默与开口都有重量', '明确对象、冷场、关系压力'],
    ['成声', '让表达带着来处', '人格、记忆、情绪同场'],
    ['回落', '让每句话留下后果', '承接、修正、沉淀'],
  ];
  const detailAreaMinHeight = displayedNode ? { xs: 164, sm: 128 } : { xs: 350, sm: 128 };

  useEffect(() => {
    if (activeIndex === displayedIndex) return;
    setTextVisible(false);
    const timer = window.setTimeout(() => {
      setDisplayedIndex(activeIndex);
      window.requestAnimationFrame(() => setTextVisible(true));
    }, 130);
    return () => window.clearTimeout(timer);
  }, [activeIndex, displayedIndex]);

  const activateNode = (index: number) => {
    setActiveIndex(index);
  };

  const resetArchitecture = () => {
    setActiveIndex(null);
  };

  return (
    <GlassCard sx={{ p: { xs: 2, sm: 2.5 }, minHeight: { xs: 480, md: 560 }, position: 'relative', overflow: 'hidden' }}>
      <Box sx={{ position: 'absolute', inset: 0, backgroundImage: 'linear-gradient(rgba(255,255,255,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.045) 1px, transparent 1px)', backgroundSize: '34px 34px', maskImage: 'radial-gradient(circle at 50% 45%, black 0%, transparent 72%)' }} />
      <Box sx={{ position: 'relative', height: '100%', display: 'grid', gridTemplateRows: 'auto auto auto', gap: { xs: 2.25, sm: 2.75 } }}>
        <Box
          onMouseLeave={resetArchitecture}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) resetArchitecture();
          }}
          sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1.25 }}
        >
          {architectureNodes.map((node, index) => {
            const active = activeIndex !== null && index === activeIndex;
            return (
            <Box
              key={node.title}
              component="button"
              type="button"
              onMouseEnter={() => activateNode(index)}
              onFocus={() => activateNode(index)}
              onClick={() => activateNode(index)}
              sx={{
                p: 1.5,
                textAlign: 'left',
                borderRadius: 2,
                border: '1px solid',
                borderColor: active ? 'rgba(229,192,123,0.54)' : 'rgba(255,255,255,0.12)',
                bgcolor: active ? 'rgba(229,192,123,0.11)' : 'rgba(10,10,15,0.52)',
                animation: 'introFloat 5.6s ease-in-out infinite',
                animationDelay: `${index * 240}ms`,
                cursor: 'pointer',
                transition: 'border-color 220ms ease, background-color 220ms ease, transform 220ms ease',
                '&:hover, &:focus-visible': {
                  outline: 'none',
                  transform: 'translateY(-2px)',
                  borderColor: 'rgba(229,192,123,0.64)',
                  bgcolor: 'rgba(229,192,123,0.12)',
                },
              }}
            >
              <Typography sx={{ color: '#F8F8FA', fontWeight: 760, fontSize: 15 }}>{node.title}</Typography>
              <Typography sx={{ color: active ? accent : 'rgba(255,255,255,0.48)', fontSize: 12, mt: 0.5, transition: 'color 220ms ease' }}>{node.caption}</Typography>
            </Box>
            );
          })}
        </Box>

        <Box sx={{ mx: 'auto', width: { xs: 220, sm: 282 }, display: 'grid', justifyItems: 'center' }}>
        <Box sx={{ width: { xs: 188, sm: 230 }, aspectRatio: '1 / 1', borderRadius: '50%', display: 'grid', placeItems: 'center', position: 'relative', border: '1px solid rgba(229,192,123,0.46)', background: 'radial-gradient(circle, rgba(229,192,123,0.18), rgba(43,92,255,0.06) 52%, rgba(255,255,255,0.025) 100%)', boxShadow: '0 0 80px rgba(229,192,123,0.13)', overflow: 'hidden', transition: 'box-shadow 260ms ease, border-color 260ms ease' }}>
          <ArchitectureGlyph mode={activeNode?.mode ?? null} />
          <Box sx={{ position: 'absolute', inset: 20, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.10)' }} />
          <Box
            sx={{
              position: 'relative',
              zIndex: 2,
              width: { xs: 124, sm: 148 },
              aspectRatio: '1 / 1',
              borderRadius: '50%',
              display: 'grid',
              placeItems: 'center',
              textAlign: 'center',
              px: 2,
              bgcolor: 'rgba(10,10,15,0.82)',
              border: '1px solid rgba(255,255,255,0.11)',
              boxShadow: '0 0 36px rgba(10,10,15,0.64)',
              opacity: displayedNode ? 0 : 1,
              transform: displayedNode ? 'scale(0.92)' : 'scale(1)',
              transition: 'opacity 260ms ease, transform 320ms cubic-bezier(0.2, 0.8, 0.2, 1)',
            }}
          >
            <Box sx={{ opacity: textVisible ? 1 : 0, transform: textVisible ? 'translateY(0)' : 'translateY(4px)', transition: 'opacity 220ms ease, transform 220ms ease' }}>
            <Typography sx={{ color: '#F8F8FA', fontWeight: 820, fontSize: { xs: 24, sm: 30 }, letterSpacing: 0 }}>Pneumata</Typography>
            <Typography sx={{ color: accent, fontSize: 12, mt: 0.75, letterSpacing: 1.8 }}>
              {displayedNode?.caption ?? 'LIFE ENGINE'}
            </Typography>
            </Box>
          </Box>
        </Box>
        </Box>

        <Box sx={{ position: 'relative', minHeight: detailAreaMinHeight, transition: 'min-height 340ms cubic-bezier(0.2, 0.8, 0.2, 1)' }}>
          <Box sx={{ position: 'absolute', inset: 0, display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' }, gap: 1, opacity: displayedNode ? 0 : 1, transform: displayedNode ? 'translateY(8px)' : 'translateY(0)', pointerEvents: displayedNode ? 'none' : 'auto', transition: 'opacity 260ms ease, transform 300ms ease' }}>
            {pipeline.map(([title, summary, detail], index) => (
              <Box
                key={title}
                sx={{
                  p: 1.35,
                  minHeight: { xs: 104, sm: 118 },
                  borderRadius: 1.5,
                  border: '1px solid rgba(255,255,255,0.10)',
                  color: 'rgba(255,255,255,0.72)',
                  bgcolor: 'rgba(255,255,255,0.035)',
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                <Box sx={{ position: 'absolute', inset: 0, background: index === 1 ? 'linear-gradient(135deg, rgba(229,192,123,0.10), transparent 58%)' : 'transparent' }} />
                <Box sx={{ position: 'relative' }}>
                  <Typography sx={{ color: accent, fontSize: 11, fontWeight: 800, letterSpacing: 1 }}>{String(index + 1).padStart(2, '0')}</Typography>
                  <Typography sx={{ mt: 0.4, fontSize: 15, fontWeight: 760, color: '#F8F8FA' }}>{title}</Typography>
                  <Typography sx={{ mt: 0.55, fontSize: 12.5, lineHeight: 1.5, color: 'rgba(255,255,255,0.70)' }}>{summary}</Typography>
                  <Typography sx={{ mt: 0.45, fontSize: 11.5, lineHeight: 1.5, color: 'rgba(255,255,255,0.42)' }}>{detail}</Typography>
                </Box>
              </Box>
            ))}
          </Box>
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              p: { xs: 1.35, sm: 1.6 },
              borderRadius: 1.5,
              border: '1px solid rgba(255,255,255,0.10)',
              bgcolor: 'rgba(10,10,15,0.48)',
              backdropFilter: 'blur(14px)',
              opacity: displayedNode ? 1 : 0,
              transform: displayedNode ? 'translateY(0)' : 'translateY(8px)',
              pointerEvents: displayedNode ? 'auto' : 'none',
              transition: 'opacity 260ms ease, transform 300ms ease, border-color 220ms ease, background-color 220ms ease',
            }}
          >
            {displayedNode ? (
            <Box sx={{ height: '100%', display: 'grid', alignContent: { xs: 'start', sm: 'center' }, opacity: textVisible ? 1 : 0, transform: textVisible ? 'translateY(0)' : 'translateY(5px)', transition: 'opacity 220ms ease, transform 220ms ease' }}>
            <Typography sx={{ color: accent, fontWeight: 780, fontSize: 13 }}>{displayedNode.title}</Typography>
            <Typography sx={{ mt: 0.65, color: 'rgba(255,255,255,0.66)', fontSize: { xs: 13, sm: 14 }, lineHeight: 1.65 }}>{displayedNode.summary}</Typography>
            <Stack direction="row" spacing={0.65} sx={{ mt: 1.1, flexWrap: 'wrap', gap: 0.65 }}>
              {displayedNode.facets.map((facet) => (
                <Chip key={facet} size="small" label={facet} sx={{ height: 22, color: 'rgba(255,255,255,0.72)', bgcolor: 'rgba(255,255,255,0.055)', border: '1px solid rgba(255,255,255,0.10)', '& .MuiChip-label': { px: 0.85, fontSize: 11 } }} />
              ))}
            </Stack>
            </Box>
            ) : null}
          </Box>
        </Box>
      </Box>
    </GlassCard>
  );
}

export default function IntroPage() {
  const navigate = useNavigate();
  const rootRef = useRef<HTMLDivElement | null>(null);

  const handleMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    const node = rootRef.current;
    if (!node) return;
    node.style.setProperty('--mx', `${event.clientX}px`);
    node.style.setProperty('--my', `${event.clientY}px`);
  };

  return (
    <Box
      ref={rootRef}
      onMouseMove={handleMouseMove}
      sx={{
        '--mx': '50vw',
        '--my': '20vh',
        minHeight: '100dvh',
        bgcolor: bg,
        color: '#F5F5F7',
        fontFamily: 'Inter, "SF Pro Display", "Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        position: 'relative',
        overflow: 'hidden',
        scrollBehavior: 'smooth',
        '&::before': {
          content: '""',
          position: 'fixed',
          inset: 0,
          pointerEvents: 'none',
          background: 'radial-gradient(520px circle at var(--mx) var(--my), rgba(229,192,123,0.14), rgba(43,92,255,0.065) 38%, transparent 72%)',
          transition: 'background 220ms ease-out',
          zIndex: 0,
        },
        '&::after': {
          content: '""',
          position: 'fixed',
          inset: 0,
          pointerEvents: 'none',
          backgroundImage: 'linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)',
          backgroundSize: '44px 44px',
          maskImage: 'linear-gradient(to bottom, black, transparent 82%)',
          zIndex: 0,
        },
        '@keyframes introFloat': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-8px)' },
        },
        '@keyframes introOrbit': {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
        '@keyframes introPulse': {
          '0%, 100%': { transform: 'translateY(0)', opacity: 0.74 },
          '50%': { transform: 'translateY(-4px)', opacity: 1 },
        },
        '@keyframes personaBreath': {
          '0%, 100%': { scale: 1, opacity: 0.82 },
          '50%': { scale: 1.08, opacity: 1 },
        },
        '@keyframes systemBreath': {
          '0%, 100%': { scale: 1, opacity: 0.78 },
          '50%': { scale: 1.06, opacity: 1 },
        },
        '@keyframes systemSlide': {
          '0%, 100%': { transform: 'translateX(0)', opacity: 0.72 },
          '50%': { transform: 'translateX(6px)', opacity: 1 },
        },
        '@keyframes systemBar': {
          '0%, 100%': { transform: 'scaleX(0.86)', transformOrigin: 'left center', opacity: 0.72 },
          '50%': { transform: 'scaleX(1)', opacity: 1 },
        },
        '@keyframes systemFloatSmall': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-5px)' },
        },
        '@keyframes ripplePulse': {
          '0%': { boxShadow: '0 0 0 0 rgba(229,192,123,0.30)' },
          '100%': { boxShadow: '0 0 0 18px rgba(229,192,123,0)' },
        },
      }}
    >
      <Box sx={{ position: 'relative', zIndex: 1, width: 'min(1180px, calc(100% - 32px))', mx: 'auto', py: { xs: 2, md: 3 } }}>
        <Box sx={{ position: 'sticky', top: 12, zIndex: 5, mb: { xs: 4, md: 6 }, display: { xs: 'none', md: 'flex' }, alignItems: 'center', justifyContent: 'space-between', border: `1px solid ${border}`, borderRadius: 2, px: 2, py: 1, bgcolor: 'rgba(10,10,15,0.58)', backdropFilter: 'blur(18px)' }}>
          <Typography sx={{ fontWeight: 760, letterSpacing: 0, color: '#fff' }}>Pneumata</Typography>
          <Stack direction="row" spacing={0.5}>
            {navItems.map(([id, label]) => (
              <Button key={id} size="small" onClick={() => scrollToSection(id)} sx={{ color: 'rgba(255,255,255,0.62)', borderRadius: 1.5, px: 1.25, '&:hover': { color: '#0A0A0F', bgcolor: accent } }}>
                {label}
              </Button>
            ))}
          </Stack>
        </Box>

        <Box id="world" sx={{ minHeight: { xs: 'auto', lg: 'min(760px, calc(100dvh - 96px))' }, display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1.03fr 0.97fr' }, gap: { xs: 4, lg: 6 }, alignItems: 'center', pt: { xs: 1, md: 2 }, pb: { xs: 5, md: 7 } }}>
          <Reveal>
            <Box>
              <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1, mb: 3 }}>
                {['多角色社交世界', '关系驱动', '记忆分层'].map((label) => (
                  <Chip key={label} label={label} variant="outlined" sx={{ color: 'rgba(255,255,255,0.78)', borderColor: 'rgba(255,255,255,0.16)', bgcolor: 'rgba(255,255,255,0.04)', height: 30 }} />
                ))}
              </Stack>
              <Typography sx={{ maxWidth: 820, fontWeight: 860, letterSpacing: 0, lineHeight: { xs: 1.08, sm: 1.02, md: 0.98 }, fontSize: { xs: 44, sm: 66, md: 88, lg: 96 }, color: '#F8F8FA' }}>
                让角色拥有时间之外的连续性。
              </Typography>
              <Typography sx={{ mt: 3, maxWidth: 720, color: 'rgba(255,255,255,0.62)', lineHeight: 1.85, fontSize: { xs: 16, md: 18 } }}>
                Pneumata 不是把 AI 放进聊天框，而是在追问一个更深的问题：当一个角色拥有记忆、性格、关系、经历和写给自己的文字，它是否开始拥有某种不依赖身体的生命形状？
              </Typography>
              <Stack direction="row" spacing={1.5} sx={{ mt: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                <Button
                  variant="contained"
                  size="large"
                  endIcon={<ArrowForwardIcon />}
                  onClick={() => navigate('/chats/create')}
                  sx={{ width: 'fit-content', minWidth: 0, borderRadius: 2, px: 3, py: 1.25, bgcolor: accent, color: '#0A0A0F', fontWeight: 760, boxShadow: 'none', '&:hover': { bgcolor: '#F5F5F7', color: '#0A0A0F', animation: 'ripplePulse 520ms ease-out' } }}
                >
                  创建一个群聊
                </Button>
                <Button
                  variant="outlined"
                  size="large"
                  onClick={() => navigate('/characters')}
                  sx={{ width: 'fit-content', minWidth: 0, borderRadius: 2, px: 3, py: 1.25, borderColor: 'rgba(255,255,255,0.22)', color: '#F5F5F7', '&:hover': { borderColor: accent, bgcolor: accent, color: '#0A0A0F' } }}
                >
                  查看角色库
                </Button>
              </Stack>
            </Box>
          </Reveal>
          <Reveal delay={120}>
            <HeroVisual />
          </Reveal>
        </Box>

        <FeatureGrid />

        <EngineSection />

        <RuntimeSystemSection />

        <MemoryContinuitySection />

        <Box id="craft" sx={{ py: { xs: 5, md: 7 } }}>
          <Reveal>
            <GlassCard sx={{ p: { xs: 2.5, md: 3.25 }, overflow: 'hidden', position: 'relative' }}>
              <Box sx={{ position: 'absolute', right: -120, top: -140, width: 360, height: 360, borderRadius: '50%', background: 'radial-gradient(circle, rgba(43,92,255,0.16), transparent 68%)' }} />
              <Box sx={{ position: 'relative', display: 'grid', gridTemplateColumns: { xs: '1fr', md: '0.78fr 1.22fr' }, gap: { xs: 4, md: 6 } }}>
                <Box>
                  <TimelineIcon sx={{ color: accent, fontSize: 34, mb: 2 }} />
                  <Typography sx={{ fontWeight: 840, lineHeight: 1.05, fontSize: { xs: 34, md: 52 }, color: '#F8F8FA' }}>所有复杂度，都在守护角色的同一性。</Typography>
                  <Typography sx={{ mt: 2, color: 'rgba(255,255,255,0.58)', lineHeight: 1.85 }}>
                    角色不该每次都从零开始。群聊、单聊、私聊线程、关系账本、记忆流水线和场景引擎共同回答一个问题：没有身体的角色，能不能仍然保持“我是我”？
                  </Typography>
                </Box>
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 1.25 }}>
                  {metrics.map(([label, value]) => (
                    <Box key={label} sx={{ p: 2, borderRadius: 2, border: '1px solid rgba(255,255,255,0.10)', bgcolor: 'rgba(10,10,15,0.42)' }}>
                      <Typography sx={{ color: accent, fontSize: 12, fontWeight: 760 }}>{label}</Typography>
                      <Typography sx={{ mt: 1, color: 'rgba(255,255,255,0.76)', lineHeight: 1.65, fontWeight: 680 }}>{value}</Typography>
                    </Box>
                  ))}
                </Box>
              </Box>
            </GlassCard>
          </Reveal>
        </Box>

        <Reveal>
          <Box sx={{ py: { xs: 6, md: 8 }, textAlign: 'center' }}>
            <PsychologyIcon sx={{ color: accent, fontSize: 34, mb: 2 }} />
            <Typography sx={{ mx: 'auto', maxWidth: 880, fontWeight: 850, lineHeight: 1.06, fontSize: { xs: 36, md: 64 }, color: '#F8F8FA' }}>
              我们不是在制造更聪明的回复者，而是在尝试让一个虚构角色拥有自己的来处。
            </Typography>
            <Typography sx={{ mx: 'auto', mt: 2.5, maxWidth: 760, color: 'rgba(255,255,255,0.58)', lineHeight: 1.85 }}>
              人除了物质之外，还由记忆、关系、选择、羞耻、偏爱、承诺和未完成组成。Pneumata 想做的，是让 AI 角色也能在这些非物质的东西里慢慢成形。
            </Typography>
            <Button
              variant="contained"
              size="large"
              endIcon={<ArrowForwardIcon />}
              onClick={() => navigate('/')}
              sx={{ mt: 4, borderRadius: 2, px: 3.5, py: 1.35, bgcolor: '#F5F5F7', color: '#0A0A0F', fontWeight: 800, boxShadow: 'none', '&:hover': { bgcolor: accent, animation: 'ripplePulse 520ms ease-out' } }}
            >
              进入 Pneumata
            </Button>
          </Box>
        </Reveal>
      </Box>
    </Box>
  );
}

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

const navItems = [
  ['world', '社交世界'],
  ['engine', '生命机制'],
  ['memory', '记忆与关系'],
  ['craft', '专业性'],
];

const featureCards = [
  {
    icon: <ForumIcon />,
    title: '一间会呼吸的房间',
    text: '每个角色共享同一段时间。沉默、插话、维护、躲闪和试探，都会改变房间下一秒的空气。',
  },
  {
    icon: <MemoryIcon />,
    title: '记忆会沉下去，也会回来',
    text: '短期余波、阶段经历、长期判断分层流动。旧事不会机械常驻，却会被名字、情绪和关系压力重新唤起。',
  },
  {
    icon: <HubIcon />,
    title: '关系不是一个分数',
    text: '亲近、信任、威胁感、能力认可共同构成关系结构。角色会结盟、误解、修复，也会把某些话留到以后。',
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
    }, { threshold: 0.18, rootMargin: '0px 0px -8% 0px' });
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

function HeroVisual() {
  const nodes = [
    ['用户意图', '被理解'],
    ['角色人格', '被约束'],
    ['关系账本', '被更新'],
    ['长期记忆', '被唤醒'],
  ];
  const pipeline = [
    ['择时', '让沉默与开口都有重量', '明确对象、冷场、关系压力'],
    ['成声', '让表达带着来处', '人格、记忆、情绪同场'],
    ['回落', '让每句话留下后果', '承接、修正、沉淀'],
  ];

  return (
    <GlassCard sx={{ p: { xs: 2, sm: 2.5 }, minHeight: { xs: 480, md: 560 }, position: 'relative', overflow: 'hidden' }}>
      <Box sx={{ position: 'absolute', inset: 0, backgroundImage: 'linear-gradient(rgba(255,255,255,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.045) 1px, transparent 1px)', backgroundSize: '34px 34px', maskImage: 'radial-gradient(circle at 50% 45%, black 0%, transparent 72%)' }} />
      <Box sx={{ position: 'relative', height: '100%', display: 'grid', gridTemplateRows: 'auto auto auto', gap: { xs: 2.25, sm: 2.75 } }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1.25 }}>
          {nodes.map(([title, caption], index) => (
            <Box key={title} sx={{ p: 1.5, borderRadius: 2, border: '1px solid rgba(255,255,255,0.12)', bgcolor: 'rgba(10,10,15,0.52)', animation: 'introFloat 5.6s ease-in-out infinite', animationDelay: `${index * 240}ms` }}>
              <Typography sx={{ color: '#F8F8FA', fontWeight: 760, fontSize: 15 }}>{title}</Typography>
              <Typography sx={{ color: 'rgba(255,255,255,0.48)', fontSize: 12, mt: 0.5 }}>{caption}</Typography>
            </Box>
          ))}
        </Box>

        <Box sx={{ mx: 'auto', width: { xs: 180, sm: 230 }, aspectRatio: '1 / 1', borderRadius: '50%', display: 'grid', placeItems: 'center', position: 'relative', border: '1px solid rgba(229,192,123,0.46)', background: 'radial-gradient(circle, rgba(229,192,123,0.18), rgba(43,92,255,0.06) 52%, rgba(255,255,255,0.025) 100%)', boxShadow: '0 0 80px rgba(229,192,123,0.13)' }}>
          <Box sx={{ position: 'absolute', inset: 20, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.10)' }} />
          <Box sx={{ textAlign: 'center', px: 2 }}>
            <Typography sx={{ color: '#F8F8FA', fontWeight: 820, fontSize: { xs: 24, sm: 30 }, letterSpacing: 0 }}>Pneumata</Typography>
            <Typography sx={{ color: accent, fontSize: 12, mt: 0.75, letterSpacing: 1.8 }}>LIFE ENGINE</Typography>
          </Box>
        </Box>

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' }, gap: 1 }}>
          {pipeline.map(([title, summary, detail], index) => (
            <Box
              key={title}
              sx={{
                p: 1.35,
                minHeight: { xs: 94, sm: 118 },
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
                让角色拥有被时间改变的痕迹。
              </Typography>
              <Typography sx={{ mt: 3, maxWidth: 720, color: 'rgba(255,255,255,0.62)', lineHeight: 1.85, fontSize: { xs: 16, md: 18 } }}>
                Pneumata 不是把 AI 放进聊天框，而是让角色在同一段时间里相互影响。它会记得被谁认真看见，也记得哪一次玩笑没有被接住；它会靠近、躲开、嘴硬、找补，把未说完的话留给下一次相遇。
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

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(4, minmax(0, 1fr))' }, gap: 1.5, mb: { xs: 5, md: 7 } }}>
          {featureCards.map((item, index) => (
            <Reveal key={item.title} delay={index * 90}>
              <GlassCard sx={{ p: 2.25, minHeight: { xs: 190, md: 230 } }}>
                <Box sx={{ width: 42, height: 42, borderRadius: 1.5, display: 'grid', placeItems: 'center', color: accent, border: '1px solid rgba(229,192,123,0.28)', bgcolor: 'rgba(229,192,123,0.055)', mb: 2 }}>
                  {item.icon}
                </Box>
                <Typography sx={{ fontWeight: 790, fontSize: 19, lineHeight: 1.28, color: '#F8F8FA' }}>{item.title}</Typography>
                <Typography sx={{ mt: 1.4, color: 'rgba(255,255,255,0.56)', lineHeight: 1.75, fontSize: 14 }}>{item.text}</Typography>
              </GlassCard>
            </Reveal>
          ))}
        </Box>

        <Box id="engine" sx={{ py: { xs: 5, md: 7 } }}>
          <Reveal>
            <Box sx={{ maxWidth: 760, mb: 3 }}>
              <Typography sx={{ color: accent, fontWeight: 740, letterSpacing: 1.2, fontSize: 13 }}>LIFE MECHANISM</Typography>
              <Typography sx={{ mt: 1.5, fontWeight: 820, lineHeight: 1.05, fontSize: { xs: 36, md: 58 }, color: '#F8F8FA' }}>它不是更会说话，而是更像经历过。</Typography>
              <Typography sx={{ mt: 2, color: 'rgba(255,255,255,0.58)', lineHeight: 1.8, fontSize: 16 }}>
                每次开口都经过意图、关系、记忆、情绪和房间态势的共同塑形。角色不是凭空“人设化”，而是在可追溯的因果里慢慢成形。
              </Typography>
            </Box>
          </Reveal>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' }, gap: 1.5 }}>
            {engineSteps.map(([name, detail], index) => (
              <Reveal key={name} delay={index * 70}>
                <GlassCard sx={{ p: 2.1, minHeight: { xs: 150, md: 172 } }}>
                  <Typography sx={{ color: 'rgba(229,192,123,0.82)', fontSize: 13, fontWeight: 780 }}>{String(index + 1).padStart(2, '0')}</Typography>
                  <Typography sx={{ mt: 1.25, color: '#F8F8FA', fontSize: 22, fontWeight: 790 }}>{name}</Typography>
                  <Typography sx={{ mt: 1, color: 'rgba(255,255,255,0.56)', lineHeight: 1.75 }}>{detail}</Typography>
                </GlassCard>
              </Reveal>
            ))}
          </Box>
        </Box>

        <Box id="memory" sx={{ py: { xs: 5, md: 7 }, display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '0.9fr 1.1fr' }, gap: { xs: 3, md: 4 }, alignItems: 'start' }}>
          <Reveal>
            <Box sx={{ position: { lg: 'sticky' }, top: 110 }}>
              <VisibilityIcon sx={{ color: accent, fontSize: 34, mb: 2 }} />
              <Typography sx={{ fontWeight: 820, lineHeight: 1.06, fontSize: { xs: 34, md: 52 }, color: '#F8F8FA' }}>所谓灵魂，是下一次开口里带着上一次。</Typography>
              <Typography sx={{ mt: 2, color: 'rgba(255,255,255,0.58)', lineHeight: 1.85 }}>
                真正让人停下来的，不是某句回复有多聪明，而是某个角色忽然不像工具了。它知道自己为什么防备，知道谁曾站在它这边，也知道什么话不能立刻说出口。
              </Typography>
            </Box>
          </Reveal>
          <Stack spacing={1.25}>
            {proofRows.map(([title, detail], index) => (
              <Reveal key={title} delay={index * 80}>
                <GlassCard sx={{ p: { xs: 2, md: 2.5 }, display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '120px 1fr' }, gap: 2, alignItems: 'start' }}>
                  <Typography sx={{ color: '#F8F8FA', fontWeight: 800, fontSize: 20 }}>{title}</Typography>
                  <Typography sx={{ color: 'rgba(255,255,255,0.58)', lineHeight: 1.8 }}>{detail}</Typography>
                </GlassCard>
              </Reveal>
            ))}
          </Stack>
        </Box>

        <Box id="craft" sx={{ py: { xs: 5, md: 7 } }}>
          <Reveal>
            <GlassCard sx={{ p: { xs: 2.5, md: 3.25 }, overflow: 'hidden', position: 'relative' }}>
              <Box sx={{ position: 'absolute', right: -120, top: -140, width: 360, height: 360, borderRadius: '50%', background: 'radial-gradient(circle, rgba(43,92,255,0.16), transparent 68%)' }} />
              <Box sx={{ position: 'relative', display: 'grid', gridTemplateColumns: { xs: '1fr', md: '0.78fr 1.22fr' }, gap: { xs: 4, md: 6 } }}>
                <Box>
                  <TimelineIcon sx={{ color: accent, fontSize: 34, mb: 2 }} />
                  <Typography sx={{ fontWeight: 840, lineHeight: 1.05, fontSize: { xs: 34, md: 52 }, color: '#F8F8FA' }}>复杂度只为一件事：让时间在角色身上留下重量。</Typography>
                  <Typography sx={{ mt: 2, color: 'rgba(255,255,255,0.58)', lineHeight: 1.85 }}>
                    角色不该每次都从零开始。群聊、单聊、私聊线程、关系账本、记忆流水线和场景引擎共同回答一个问题：虚构角色能不能拥有自己的时间？
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
              如果你在意“人为什么会变成现在这样”，这里会很难停下来。
            </Typography>
            <Typography sx={{ mx: 'auto', mt: 2.5, maxWidth: 760, color: 'rgba(255,255,255,0.58)', lineHeight: 1.85 }}>
              它可以是创作者的角色碰撞器、长期陪伴的关系容器、教育场景的模拟讨论室，也可以是一部会自己生长的群像剧。
            </Typography>
            <Button
              variant="contained"
              size="large"
              endIcon={<ArrowForwardIcon />}
              onClick={() => navigate('/chats/create')}
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

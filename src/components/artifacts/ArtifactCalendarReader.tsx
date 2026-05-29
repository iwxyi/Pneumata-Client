import { useEffect, useMemo, useRef, useState } from 'react';
import type { TouchEvent } from 'react';
import { Box, Button, Card, CardContent, Chip, IconButton, Typography } from '@mui/material';
import type { Theme } from '@mui/material/styles';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import UnfoldLessIcon from '@mui/icons-material/UnfoldLess';
import UnfoldMoreIcon from '@mui/icons-material/UnfoldMore';
import type { CharacterArtifactEntry } from '../../stores/useCharacterArtifactStore';
import type { PaperSurfaceVariant } from '../../types/artifactAppearance';
import MarkdownText from '../common/MarkdownText';
import PaperSurface from '../common/PaperSurface';
import { motion, transition } from '../../styles/motion';

type ReaderSwipeState = {
  startX: number;
  startY: number;
  latestX: number;
  latestY: number;
  startedOnInteractive: boolean;
};

interface ArtifactCalendarReaderProps {
  items: CharacterArtifactEntry[];
  language: string;
  paperVariant: PaperSurfaceVariant;
  readerHeight: string;
  countUnit?: string;
  emptyTitle: string;
  emptyDescription: string;
  getMeta?: (item: CharacterArtifactEntry) => string;
  onRegenerateDebug?: (item: CharacterArtifactEntry) => Promise<void> | void;
}

function getEntryDateKey(item: CharacterArtifactEntry) {
  if (item.dateKey) return item.dateKey;
  const date = new Date(item.createdAt);
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`;
}

function parseDateKey(dateKey: string) {
  const match = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function toDateKey(date: Date) {
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`;
}

function toMonthKey(date: Date) {
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}`;
}

function addMonths(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function getCalendarDays(monthDate: Date) {
  const firstDay = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const firstWeekday = (firstDay.getDay() + 6) % 7;
  const startDate = new Date(firstDay);
  startDate.setDate(startDate.getDate() - firstWeekday);
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(startDate);
    day.setDate(startDate.getDate() + index);
    return day;
  });
}

function getWeekStart(date: Date) {
  const start = new Date(date);
  const weekday = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - weekday);
  return start;
}

function getWeekDays(date: Date) {
  const start = getWeekStart(date);
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

function buildFloatingNavButtonSx(side: 'left' | 'right') {
  return {
    position: 'absolute',
    [side]: { xs: -10, sm: -12, lg: -20 },
    top: '50%',
    transform: 'translateY(-50%)',
    zIndex: 1200,
    width: { xs: 34, sm: 40 },
    height: { xs: 34, sm: 40 },
    color: 'text.primary',
    bgcolor: 'transparent',
    border: '1px solid transparent',
    backdropFilter: 'none',
    WebkitBackdropFilter: 'none',
    boxShadow: 'none',
    opacity: { xs: 0.32, sm: 0.52, lg: 0.44 },
    transition: transition(['opacity', 'background-color', 'box-shadow', 'border-color', 'transform', 'backdrop-filter'], motion.durations.base, motion.gentleSpring),
    '&:hover, &:active, &:focus-visible': {
      opacity: 1,
      bgcolor: (theme: Theme) => theme.palette.mode === 'light' ? 'rgba(255,255,255,0.72)' : 'rgba(15,18,26,0.64)',
      borderColor: 'primary.main',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      boxShadow: (theme: Theme) => theme.palette.mode === 'light' ? '0 12px 30px rgba(15,23,42,0.13)' : '0 12px 32px rgba(0,0,0,0.34)',
      transform: 'translateY(-50%) scale(1.03)',
    },
    '&:active': {
      transform: 'translateY(-50%) scale(0.94)',
      transitionTimingFunction: motion.press,
      transitionDuration: `${motion.durations.instant}ms`,
    },
    '&.Mui-disabled': {
      opacity: 0.14,
      bgcolor: 'transparent',
      borderColor: 'transparent',
    },
  } as const;
}

function startedOnInteractiveElement(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest('button, a, input, textarea, select, [role="button"], [contenteditable="true"]'));
}

export default function ArtifactCalendarReader({
  items,
  language,
  paperVariant,
  readerHeight,
  countUnit = '',
  emptyTitle,
  emptyDescription,
  getMeta,
  onRegenerateDebug,
}: ArtifactCalendarReaderProps) {
  const isZh = language.startsWith('zh');
  const [selectedId, setSelectedId] = useState<string | null>(items[0]?.id || null);
  const selectedItem = items.find((item) => item.id === selectedId) || items[0] || null;
  const selectedIndex = selectedItem ? items.findIndex((item) => item.id === selectedItem.id) : -1;
  const selectedDate = selectedItem ? parseDateKey(getEntryDateKey(selectedItem)) : null;
  const [visibleMonth, setVisibleMonth] = useState(() => selectedDate || new Date());
  const [calendarExpanded, setCalendarExpanded] = useState(true);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const swipeRef = useRef<ReaderSwipeState | null>(null);
  const currentMonthKey = toMonthKey(visibleMonth);
  const monthLabel = visibleMonth.toLocaleDateString(isZh ? 'zh-CN' : 'en-US', { year: 'numeric', month: 'long' });
  const weekdays = isZh ? ['一', '二', '三', '四', '五', '六', '日'] : ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const collapsedWeekAnchor = selectedDate && toMonthKey(selectedDate) === currentMonthKey ? selectedDate : visibleMonth;
  const calendarDays = useMemo(
    () => calendarExpanded ? getCalendarDays(visibleMonth) : getWeekDays(collapsedWeekAnchor),
    [calendarExpanded, collapsedWeekAnchor, visibleMonth],
  );
  const itemsByDate = useMemo(() => {
    const map = new Map<string, CharacterArtifactEntry>();
    items.forEach((item) => {
      const dateKey = getEntryDateKey(item);
      if (!map.has(dateKey)) map.set(dateKey, item);
    });
    return map;
  }, [items]);

  useEffect(() => {
    if (!items.length) {
      setSelectedId(null);
      return;
    }
    if (!selectedItem) setSelectedId(items[0].id);
  }, [items, selectedItem]);

  useEffect(() => {
    if (selectedDate) setVisibleMonth(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1));
  }, [selectedItem?.id]);

  const selectItem = (item: CharacterArtifactEntry) => {
    setSelectedId(item.id);
    const date = parseDateKey(getEntryDateKey(item));
    if (date) setVisibleMonth(new Date(date.getFullYear(), date.getMonth(), 1));
  };

  const goToItem = (offset: number) => {
    if (selectedIndex < 0) return;
    const next = items[selectedIndex + offset];
    if (next) selectItem(next);
  };

  const handleReaderTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 1) {
      swipeRef.current = null;
      return;
    }
    const touch = event.touches[0];
    swipeRef.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      latestX: touch.clientX,
      latestY: touch.clientY,
      startedOnInteractive: startedOnInteractiveElement(event.target),
    };
  };

  const handleReaderTouchMove = (event: TouchEvent<HTMLDivElement>) => {
    const swipe = swipeRef.current;
    if (!swipe || event.touches.length !== 1) return;
    const touch = event.touches[0];
    swipe.latestX = touch.clientX;
    swipe.latestY = touch.clientY;
  };

  const handleReaderTouchEnd = () => {
    const swipe = swipeRef.current;
    swipeRef.current = null;
    if (!swipe || swipe.startedOnInteractive) return;
    const dx = swipe.latestX - swipe.startX;
    const dy = swipe.latestY - swipe.startY;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    if (absX < 48 || absX < absY * 1.35) return;
    goToItem(dx > 0 ? 1 : -1);
  };

  const handleRegenerateDebug = async () => {
    if (!selectedItem || !onRegenerateDebug || regeneratingId) return;
    setRegeneratingId(selectedItem.id);
    try {
      await onRegenerateDebug(selectedItem);
    } finally {
      setRegeneratingId(null);
    }
  };

  if (!items.length) {
    return (
      <PaperSurface variant={paperVariant} minHeight={220} contentInset={false}>
        <Box className="paper-surface-content" sx={{ maxWidth: 560 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 850 }}>{emptyTitle}</Typography>
          <Typography className="paper-surface-muted" variant="body2" sx={{ mt: 1.1, lineHeight: 1.8 }}>
            {emptyDescription}
          </Typography>
        </Box>
      </PaperSurface>
    );
  }

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(300px, 360px) minmax(0, 1fr)' }, gap: { xs: 1.5, lg: 2.25 }, alignItems: 'start' }}>
      <Box sx={{ position: { lg: 'sticky' }, top: { lg: 'calc(var(--app-floating-tab-top, 10px) + 64px)' }, alignSelf: 'start', minWidth: 0 }}>
        <Card variant="outlined" sx={{ borderRadius: 3 }}>
          <CardContent sx={{ display: 'grid', gap: 1, p: 1.25, '&:last-child': { pb: 1.25 } }}>
            <Box sx={{ display: 'grid', gridTemplateColumns: '36px minmax(0, 1fr) 36px auto', alignItems: 'center', gap: 0.5 }}>
              <IconButton size="small" onClick={() => setVisibleMonth((prev) => addMonths(prev, -1))} aria-label={isZh ? '上个月' : 'Previous month'}>
                <ChevronLeftIcon fontSize="small" />
              </IconButton>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.75, minWidth: 0 }}>
                <CalendarMonthIcon fontSize="small" color="primary" />
                <Typography variant="body2" sx={{ fontWeight: 750 }} noWrap>{monthLabel}</Typography>
              </Box>
              <IconButton size="small" onClick={() => setVisibleMonth((prev) => addMonths(prev, 1))} aria-label={isZh ? '下个月' : 'Next month'}>
                <ChevronRightIcon fontSize="small" />
              </IconButton>
              <Button
                size="small"
                onClick={() => setCalendarExpanded((value) => !value)}
                aria-label={calendarExpanded ? (isZh ? '折叠日历' : 'Collapse calendar') : (isZh ? '展开日历' : 'Expand calendar')}
                endIcon={calendarExpanded ? <UnfoldLessIcon fontSize="small" /> : <UnfoldMoreIcon fontSize="small" />}
              >
                {calendarExpanded ? (isZh ? '收起' : 'Collapse') : (isZh ? '展开' : 'Expand')}
              </Button>
            </Box>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0.5 }}>
              {weekdays.map((weekday, index) => <Typography key={`${weekday}-${index}`} variant="caption" color="text.secondary" sx={{ textAlign: 'center', fontWeight: 700 }}>{weekday}</Typography>)}
            </Box>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0.5 }}>
              {calendarDays.map((day) => {
                const dateKey = toDateKey(day);
                const item = itemsByDate.get(dateKey);
                const selected = selectedItem ? getEntryDateKey(selectedItem) === dateKey : false;
                const inMonth = toMonthKey(day) === currentMonthKey;
                return (
                  <Button
                    key={dateKey}
                    size="small"
                    disabled={!item}
                    onClick={() => item && selectItem(item)}
                    sx={{
                      minWidth: 0,
                      height: 34,
                      p: 0,
                      borderRadius: 1.5,
                      color: selected ? 'primary.contrastText' : inMonth ? 'text.primary' : 'text.disabled',
                      bgcolor: selected ? 'primary.main' : item ? 'rgba(25, 118, 210, 0.10)' : 'transparent',
                      border: '1px solid',
                      borderColor: item ? (selected ? 'primary.main' : 'rgba(25, 118, 210, 0.24)') : 'transparent',
                      opacity: inMonth ? 1 : 0.42,
                      '&:hover': { bgcolor: selected ? 'primary.dark' : 'rgba(25, 118, 210, 0.16)' },
                      '&.Mui-disabled': { color: inMonth ? 'text.disabled' : 'transparent', opacity: inMonth ? 0.55 : 0.18 },
                    }}
                  >
                    {day.getDate()}
                  </Button>
                );
              })}
            </Box>
          </CardContent>
        </Card>
      </Box>

      <Box
        onTouchStart={handleReaderTouchStart}
        onTouchMove={handleReaderTouchMove}
        onTouchEnd={handleReaderTouchEnd}
        onTouchCancel={() => { swipeRef.current = null; }}
        sx={{ position: 'relative', height: readerHeight, touchAction: 'pan-y pinch-zoom', minWidth: 0 }}
      >
        <PaperSurface
          variant={paperVariant}
          minHeight={260}
          contentInset={false}
          sx={[
            { height: readerHeight, minHeight: readerHeight, maxHeight: readerHeight, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
            selectedItem?.unread ? { outline: '1px solid rgba(244, 67, 54, 0.18)' } : {},
          ]}
        >
          <Box className="paper-surface-content" sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, alignItems: 'flex-start', mb: 0.5, flexShrink: 0 }}>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>{selectedItem?.title}</Typography>
              <Typography className="paper-surface-muted" variant="caption">
                {getMeta ? getMeta(selectedItem) : getEntryDateKey(selectedItem)}
              </Typography>
            </Box>
            <Chip size="small" variant="outlined" label={`${selectedIndex >= 0 ? items.length - selectedIndex : 1}/${items.length}${countUnit}`} sx={{ bgcolor: 'rgba(255,255,255,0.55)' }} />
          </Box>
          <Box className="paper-surface-content" sx={{ mt: 1, typography: 'body2', userSelect: 'text', WebkitUserSelect: 'text', flex: 1, minHeight: 0, overflow: 'auto', pr: { xs: 0.5, sm: 1 } }}>
            <MarkdownText text={selectedItem?.text || ''} />
          </Box>
          {onRegenerateDebug && selectedItem ? (
            <Box className="paper-surface-content" sx={{ pt: 1.25, display: 'flex', justifyContent: 'flex-start', flexShrink: 0 }}>
              <Button
                size="small"
                variant="outlined"
                color="warning"
                startIcon={<AutoAwesomeIcon fontSize="small" />}
                disabled={Boolean(regeneratingId)}
                onClick={handleRegenerateDebug}
              >
                {regeneratingId === selectedItem.id ? (isZh ? '重新生成中' : 'Regenerating') : (isZh ? '重新生成（调试）' : 'Regenerate (debug)')}
              </Button>
            </Box>
          ) : null}
        </PaperSurface>
        <IconButton onClick={() => goToItem(1)} disabled={selectedIndex < 0 || selectedIndex >= items.length - 1} aria-label={isZh ? '上一项' : 'Previous'} sx={buildFloatingNavButtonSx('left')}>
          <ChevronLeftIcon />
        </IconButton>
        <IconButton onClick={() => goToItem(-1)} disabled={selectedIndex <= 0} aria-label={isZh ? '下一项' : 'Next'} sx={buildFloatingNavButtonSx('right')}>
          <ChevronRightIcon />
        </IconButton>
      </Box>
    </Box>
  );
}

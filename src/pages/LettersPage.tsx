import { useEffect, useMemo, useState } from 'react';
import { Badge, Box, Button, Card, CardContent, Chip, FormControl, IconButton, InputLabel, MenuItem, Select, Stack, Tabs, Tab, Typography } from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import UnfoldLessIcon from '@mui/icons-material/UnfoldLess';
import UnfoldMoreIcon from '@mui/icons-material/UnfoldMore';
import { useTranslation } from 'react-i18next';
import { useLayoutHeaderActions } from '../components/layout/AppLayoutContext';
import { useCharacterStore } from '../stores/useCharacterStore';
import { useCharacterArtifactStore, type CharacterArtifactEntry } from '../stores/useCharacterArtifactStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import MarkdownText from '../components/common/MarkdownText';
import PaperSurface from '../components/common/PaperSurface';
import type { PaperSurfaceVariant } from '../types/artifactAppearance';

type LettersTab = 'letters' | 'diary';

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

function formatDateLabel(dateKey?: string | null, language = 'zh') {
  if (!dateKey) return language.startsWith('zh') ? '未标注日期' : 'No date';
  return dateKey;
}

function buildCharacterOptions(items: CharacterArtifactEntry[], nameMap: Map<string, string>, language: string) {
  const counts = new Map<string, number>();
  items.forEach((item) => counts.set(item.characterId, (counts.get(item.characterId) || 0) + 1));
  return [
    { id: 'all', label: language.startsWith('zh') ? `全部(${items.length})` : `All (${items.length})`, count: items.length },
    ...Array.from(counts.entries())
      .map(([id, count]) => ({ id, label: `${nameMap.get(id) || items.find((item) => item.characterId === id)?.characterName || id}(${count})`, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, language.startsWith('zh') ? 'zh-Hans-CN' : 'en-US')),
  ];
}

function ArtifactCalendarReader({
  items,
  tab,
  language,
  characterNameMap,
  paperVariant,
}: {
  items: CharacterArtifactEntry[];
  tab: LettersTab;
  language: string;
  characterNameMap: Map<string, string>;
  paperVariant: PaperSurfaceVariant;
}) {
  const isZh = language.startsWith('zh');
  const [selectedId, setSelectedId] = useState<string | null>(items[0]?.id || null);
  const selectedItem = items.find((item) => item.id === selectedId) || items[0] || null;
  const selectedIndex = selectedItem ? items.findIndex((item) => item.id === selectedItem.id) : -1;
  const selectedDate = selectedItem ? parseDateKey(getEntryDateKey(selectedItem)) : null;
  const [visibleMonth, setVisibleMonth] = useState(() => selectedDate || new Date());
  const [calendarExpanded, setCalendarExpanded] = useState(true);
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

  if (!items.length) {
    return (
      <Box sx={{ px: { xs: 4.5, sm: 6, lg: 7 } }}>
        <PaperSurface variant={paperVariant} minHeight={220}>
          <Box className="paper-surface-content" sx={{ maxWidth: 560 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 850 }}>
              {tab === 'letters'
                ? (isZh ? '还没有寄出的信' : 'No letters have arrived yet')
                : (isZh ? '还没有写下的日记' : 'No diary pages yet')}
            </Typography>
            <Typography className="paper-surface-muted" variant="body2" sx={{ mt: 1.1, lineHeight: 1.8 }}>
              {tab === 'letters'
                ? (isZh ? '等角色真正经历过相遇、告别、牵挂和改变，这里会留下它们想认真说完的话。' : 'When a character has lived through enough meetings, partings, attachments, and change, the words they need to finish will rest here.')
                : (isZh ? '日记不会急着出现。它会等某一天的关系余波、没说出口的话，或一点明天还想继续的理由。' : 'Diaries are not rushed. They wait for relationship residue, unsent words, or one small reason to keep going tomorrow.')}
            </Typography>
          </Box>
        </PaperSurface>
      </Box>
    );
  }

  return (
    <Stack spacing={1.5}>
      <Box sx={{ px: { xs: 4.5, sm: 6, lg: 7 } }}>
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

      <Box sx={{ position: 'relative', minHeight: 260, px: { xs: 4.5, sm: 6, lg: 7 } }}>
        <PaperSurface variant={paperVariant} minHeight={260} sx={selectedItem?.unread ? { outline: '1px solid rgba(244, 67, 54, 0.18)' } : undefined}>
            <Box className="paper-surface-content" sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, alignItems: 'flex-start', mb: 0.5 }}>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>{selectedItem?.title}</Typography>
                <Typography className="paper-surface-muted" variant="caption">
                  {characterNameMap.get(selectedItem?.characterId || '') || selectedItem?.characterName} · {formatDateLabel(selectedItem ? getEntryDateKey(selectedItem) : null, language)}
                </Typography>
              </Box>
              <Chip size="small" variant="outlined" label={`${selectedIndex >= 0 ? items.length - selectedIndex : 1}/${items.length}${isZh ? (tab === 'letters' ? '封' : '篇') : ''}`} sx={{ bgcolor: 'rgba(255,255,255,0.55)' }} />
            </Box>
            <Box className="paper-surface-content" sx={{ mt: 1, typography: 'body2', userSelect: 'text', WebkitUserSelect: 'text' }}>
              <MarkdownText text={selectedItem?.text || ''} />
            </Box>
        </PaperSurface>
        <IconButton onClick={() => goToItem(1)} disabled={selectedIndex < 0 || selectedIndex >= items.length - 1} aria-label={isZh ? '上一项' : 'Previous'} sx={{ position: 'fixed', left: { xs: 10, sm: 18, lg: 28 }, top: '50vh', transform: 'translateY(-50%)', zIndex: 1200, bgcolor: 'rgba(255,255,255,0.78)', boxShadow: 2, '&:hover': { bgcolor: 'rgba(255,255,255,0.92)' } }}>
          <ChevronLeftIcon />
        </IconButton>
        <IconButton onClick={() => goToItem(-1)} disabled={selectedIndex <= 0} aria-label={isZh ? '下一项' : 'Next'} sx={{ position: 'fixed', right: { xs: 10, sm: 18, lg: 28 }, top: '50vh', transform: 'translateY(-50%)', zIndex: 1200, bgcolor: 'rgba(255,255,255,0.78)', boxShadow: 2, '&:hover': { bgcolor: 'rgba(255,255,255,0.92)' } }}>
          <ChevronRightIcon />
        </IconButton>
      </Box>
    </Stack>
  );
}

export default function LettersPage() {
  const { i18n } = useTranslation();
  const { setHeaderTitle, setHeaderBackAction, setHideMobileBottomNav } = useLayoutHeaderActions();
  const characters = useCharacterStore((state) => state.characters);
  const items = useCharacterArtifactStore((state) => state.items);
  const unreadLetterCount = useCharacterArtifactStore((state) => state.unreadLetterCount);
  const markLettersRead = useCharacterArtifactStore((state) => state.markLettersRead);
  const paperVariant = useSettingsStore((state) => state.artifactAppearance.paperVariant);
  const [tab, setTab] = useState<LettersTab>('letters');
  const [characterFilter, setCharacterFilter] = useState('all');

  useEffect(() => {
    setHeaderTitle(i18n.language.startsWith('zh') ? '信件' : 'Letters');
    setHeaderBackAction(null);
    setHideMobileBottomNav(false);
    markLettersRead();
    return () => {
      setHeaderTitle(null);
      setHeaderBackAction(null);
      setHideMobileBottomNav(false);
    };
  }, [i18n.language, markLettersRead, setHeaderBackAction, setHeaderTitle, setHideMobileBottomNav]);

  const letters = useMemo(() => items.filter((item) => item.kind === 'birth_letter' || item.kind === 'final_letter').slice().sort((a, b) => b.createdAt - a.createdAt), [items]);
  const diaries = useMemo(() => items.filter((item) => item.kind === 'diary').slice().sort((a, b) => b.createdAt - a.createdAt), [items]);
  const activeItems = tab === 'letters' ? letters : diaries;
  const characterNameMap = useMemo(() => new Map(characters.map((character) => [character.id, character.name])), [characters]);
  const characterOptions = useMemo(() => buildCharacterOptions(activeItems, characterNameMap, i18n.language), [activeItems, characterNameMap, i18n.language]);
  const visibleItems = useMemo(() => characterFilter === 'all' ? activeItems : activeItems.filter((item) => item.characterId === characterFilter), [activeItems, characterFilter]);

  useEffect(() => {
    setCharacterFilter('all');
  }, [tab]);

  useEffect(() => {
    if (characterFilter !== 'all' && !characterOptions.some((option) => option.id === characterFilter)) {
      setCharacterFilter('all');
    }
  }, [characterFilter, characterOptions]);

  return (
    <Box sx={{ p: 3, pt: { xs: 1, sm: 1, md: 3 }, width: '100%', maxWidth: 1100, mx: 'auto' }}>
      <Stack spacing={2}>
        <Box sx={{ px: { xs: 1.5, sm: 6, lg: 7 } }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'minmax(0, 1fr) minmax(140px, 220px)' }, gap: 1, alignItems: 'center' }}>
            <Tabs
              value={tab}
              onChange={(_, value) => setTab(value)}
              variant="scrollable"
              allowScrollButtonsMobile
              sx={{
                minWidth: 0,
                width: '100%',
                '& .MuiTabs-scroller': { minWidth: 0 },
                '& .MuiTabs-flexContainer': { gap: 0.25 },
                '& .MuiTab-root': { minWidth: 0, px: { xs: 1.25, sm: 1.75 }, whiteSpace: 'nowrap' },
              }}
            >
              <Tab value="letters" label={(
                <Badge badgeContent={unreadLetterCount} color="error" max={99}>
                  <span>{i18n.language.startsWith('zh') ? '信件' : 'Letters'}</span>
                </Badge>
              )} />
              <Tab value="diary" label={i18n.language.startsWith('zh') ? '日记' : 'Diary'} />
            </Tabs>
            <FormControl size="small" fullWidth>
              <InputLabel>{i18n.language.startsWith('zh') ? '角色' : 'Character'}</InputLabel>
              <Select label={i18n.language.startsWith('zh') ? '角色' : 'Character'} value={characterFilter} onChange={(event) => setCharacterFilter(event.target.value)}>
                {characterOptions.map((option) => <MenuItem key={option.id} value={option.id}>{option.label}</MenuItem>)}
              </Select>
            </FormControl>
          </Box>
        </Box>

        <ArtifactCalendarReader items={visibleItems} tab={tab} language={i18n.language} characterNameMap={characterNameMap} paperVariant={paperVariant} />
      </Stack>
    </Box>
  );
}

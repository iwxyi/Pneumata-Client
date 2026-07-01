import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SessionActionDefinition } from '../../types/sessionEngine';
import SessionActionPanel from './SessionActionPanel';

vi.mock('@mui/material', async () => {
  const React = await import('react');
  const passthrough = (tag: keyof React.JSX.IntrinsicElements) => ({
    children,
    disabled,
    label,
    placeholder,
  }: {
    children?: React.ReactNode;
    disabled?: boolean;
    label?: React.ReactNode;
    placeholder?: string;
  }) => React.createElement(tag, disabled ? { disabled } : null, children ?? label ?? placeholder);
  return {
    Box: passthrough('div'),
    Button: passthrough('button'),
    MenuItem: passthrough('option'),
    Stack: passthrough('div'),
    TextField: passthrough('label'),
    Typography: passthrough('span'),
  };
});

vi.mock('../common/SurfaceCard', async () => {
  const React = await import('react');
  return { default: ({ children }: { children?: React.ReactNode }) => React.createElement('section', null, children) };
});

vi.mock('../common/SectionHeader', async () => {
  const React = await import('react');
  return {
    default: ({ title, subtitle }: { title?: React.ReactNode; subtitle?: React.ReactNode }) => React.createElement(
      'header',
      null,
      title,
      subtitle,
    ),
  };
});

vi.mock('../common/PageSection', async () => {
  const React = await import('react');
  return { default: ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children) };
});

describe('SessionActionPanel deliberation actions', () => {
  it('renders public copy instead of raw action types', () => {
    const actions: SessionActionDefinition[] = [
      {
        type: 'question_member',
        autoRun: false,
        targetIds: ['member-1'],
        fields: [
          { key: 'targetId', label: '质询对象', type: 'single_select', required: true, options: [{ value: 'member-1', label: '成员甲' }] },
          { key: 'prompt', label: '质询内容', type: 'textarea', required: true },
        ],
      },
      {
        type: 'submit_evidence',
        autoRun: false,
        fields: [{ key: 'evidenceText', label: '证据内容', type: 'textarea', required: true }],
      },
      {
        type: 'record_verdict',
        autoRun: false,
        fields: [{ key: 'verdictText', label: '裁决内容', type: 'textarea', required: true }],
      },
      { type: 'summarize_discussion', autoRun: false },
      { type: 'shift_to_synthesis', autoRun: false },
    ];

    const markup = renderToStaticMarkup(<SessionActionPanel actions={actions} onRunAction={() => undefined} />);

    expect(markup).toContain('质询成员');
    expect(markup).toContain('指定成员回应漏洞、证据或责任问题。');
    expect(markup).toContain('发起质询');
    expect(markup).toContain('提交证据');
    expect(markup).toContain('把补充材料写入审议证据区。');
    expect(markup).toContain('记录裁决');
    expect(markup).toContain('记录当前阶段判断或裁决倾向。');
    expect(markup).toContain('总结审议');
    expect(markup).toContain('整理当前审议的观点、证据、分歧和下一步。');
    expect(markup).toContain('生成总结');
    expect(markup).toContain('结论整理');
    expect(markup).toContain('切到结论整理阶段，之后仍可继续补充观点和总结。');
    expect(markup).not.toContain('question_member');
    expect(markup).not.toContain('submit_evidence');
    expect(markup).not.toContain('record_verdict');
    expect(markup).not.toContain('summarize_discussion');
    expect(markup).not.toContain('shift_to_synthesis');
  });
});

import { describe, expect, it } from 'vitest';
import {
  buildCommentPrompt,
  extractCommentQuestionFromReplies,
  stripMarkdown,
} from '../../../src/bot/comments.js';

describe('comment parser', () => {
  it('keeps docs_link text in the question and omits person mentions', () => {
    const result = extractCommentQuestionFromReplies({
      replyId: 'reply-1',
      replies: [
        {
          reply_id: 'reply-1',
          content: {
            elements: [
              { type: 'text_run', text_run: { text: '@bot see ' } },
              { type: 'docs_link', docs_link: { url: 'https://example.test/doc' } },
              { type: 'person', person: { user_id: 'ou_secret' } },
            ],
          },
        },
      ],
    });

    expect(result?.question).toBe('@bot see https://example.test/doc');
    expect(result?.question).not.toContain('ou_secret');
  });

  it('falls back to the latest reply when replyId is missing and multiple replies exist', () => {
    const result = extractCommentQuestionFromReplies({
      replies: [
        { reply_id: 'reply-1', content: { elements: [{ type: 'text_run', text_run: { text: 'first' } }] } },
        { reply_id: 'reply-2', content: { elements: [{ type: 'text_run', text_run: { text: 'second' } }] } },
      ],
    });

    expect(result).toEqual({ question: 'second', targetReplyId: 'reply-2' });
  });

  it('strips common markdown before writing back to comments', () => {
    expect(stripMarkdown('**bold** _italic_ `code`\n- item\n> quote')).toBe(
      'bold italic code\nitem\nquote',
    );
  });

  it('recommends the current docs fetch form without hard-binding one local CLI build', () => {
    const prompt = buildCommentPrompt(
      { fileToken: 'doc-token', fileType: 'docx' },
      { question: '@bot read this', isWhole: false },
    );

    expect(prompt).toContain(
      'lark-cli docs +fetch --api-version v2 --doc doc-token --doc-format markdown',
    );
    expect(prompt).toContain('如果本机 lark-cli 不支持上述参数');
    expect(prompt).toContain('不要在同一错误上反复重试');
    expect(prompt).toContain('使用当前可用的等价读取命令');
    expect(prompt).toContain('不要调用云文档评论或回复接口');
    expect(prompt).toContain('不要给评论添加或删除 reaction');
    expect(prompt).toContain('最终答案直接用纯文本交给 bridge');
    expect(prompt).toContain('不要输出内部思考、内部分析、读取步骤、工具调用过程或工具日志');
    expect(prompt).toContain('若用户要求解释依据，只说明用户可见的依据和结论');
    expect(prompt).not.toContain('`lark-cli docs +fetch --doc doc-token`');
  });

  it('does not recommend docs fetch for non-document comment targets', () => {
    const prompt = buildCommentPrompt(
      { fileToken: 'sheet-token', fileType: 'sheet' },
      { question: '@bot read this sheet', isWhole: true },
    );

    expect(prompt).toContain('这是 sheet 类型');
    expect(prompt).toContain('不要使用 docs +fetch');
    expect(prompt).not.toContain('lark-cli docs +fetch --api-version v2');
    expect(prompt).not.toContain('--doc-format markdown');
  });
});

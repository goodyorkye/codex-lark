import type { TenantBrand } from '../config/schema';

function maskAppId(id: string): string {
  if (id.length < 12) return id;
  return `${id.slice(0, 13)}****${id.slice(-2)}`;
}

export interface CurrentInfo {
  appId: string;
  botName?: string;
  tenant: TenantBrand;
}

export function accountCurrentCard(info: CurrentInfo): object {
  return {
    schema: '2.0',
    config: { summary: { content: '当前应用' } },
    body: {
      elements: [
        {
          tag: 'markdown',
          content: [
            '📋 **当前应用**',
            '',
            `**App ID**: \`${maskAppId(info.appId)}\``,
            `**Bot 名**: ${info.botName ?? '(未知)'}`,
            `**Tenant**: ${info.tenant}`,
          ].join('\n'),
        },
        { tag: 'hr' },
        {
          tag: 'button',
          text: { tag: 'plain_text', content: '更换凭据' },
          type: 'primary',
          behaviors: [{ type: 'callback', value: { cmd: 'account.change' } }],
        },
      ],
    },
  };
}

export interface FormCardOpts {
  initialTenant?: TenantBrand;
  prefillAppId?: string;
  errorMessage?: string;
}

export function accountFormCard(opts: FormCardOpts = {}): object {
  const { initialTenant = 'feishu', prefillAppId, errorMessage } = opts;
  const bodyElements: object[] = [];
  if (errorMessage) {
    bodyElements.push({
      tag: 'markdown',
      content: `❌ **校验失败**：${errorMessage}`,
    });
  }
  bodyElements.push({
    tag: 'form',
    name: 'account_form',
    elements: [
      {
        tag: 'input',
        name: 'app_id',
        label: { tag: 'plain_text', content: 'App ID' },
        placeholder: { tag: 'plain_text', content: 'cli_xxxxxxxxxxxx' },
        ...(prefillAppId ? { default_value: prefillAppId } : {}),
        required: true,
      },
      {
        tag: 'input',
        name: 'app_secret',
        label: { tag: 'plain_text', content: 'App Secret' },
        placeholder: { tag: 'plain_text', content: '32 位字符串' },
        // Never prefill secret — even on validation retry. Pre-filled secrets
        // can leak into Lark's server-side card cache.
        required: true,
      },
      { tag: 'markdown', content: '**Tenant**' },
      {
        tag: 'select_static',
        name: 'tenant',
        initial_option: initialTenant,
        options: [
          { text: { tag: 'plain_text', content: 'Feishu (国内)' }, value: 'feishu' },
          { text: { tag: 'plain_text', content: 'Lark (海外)' }, value: 'lark' },
        ],
      },
      {
        tag: 'column_set',
        flex_mode: 'flow',
        horizontal_spacing: 'small',
        columns: [
          {
            tag: 'column',
            width: 'auto',
            elements: [
              {
                tag: 'button',
                name: 'submit_btn',
                text: { tag: 'plain_text', content: '提交' },
                type: 'primary',
                form_action_type: 'submit',
                behaviors: [{ type: 'callback', value: { cmd: 'account.submit' } }],
              },
            ],
          },
          {
            tag: 'column',
            width: 'auto',
            elements: [
              {
                tag: 'button',
                name: 'cancel_btn',
                text: { tag: 'plain_text', content: '取消' },
                behaviors: [{ type: 'callback', value: { cmd: 'account.cancel' } }],
              },
            ],
          },
        ],
      },
    ],
  });

  return {
    schema: '2.0',
    config: { summary: { content: '更换凭据' } },
    body: { elements: bodyElements },
  };
}

export function accountValidatingCard(): object {
  return {
    schema: '2.0',
    config: { summary: { content: '正在校验...' } },
    body: { elements: [{ tag: 'markdown', content: '⏳ **正在校验凭据...**' }] },
  };
}

export function accountSuccessCard(info: CurrentInfo): object {
  return {
    schema: '2.0',
    config: { summary: { content: '已保存' } },
    body: {
      elements: [
        {
          tag: 'markdown',
          content: [
            '✅ **凭据已保存**',
            '',
            `**App ID**: \`${maskAppId(info.appId)}\``,
            info.botName ? `**Bot 名**: ${info.botName}` : '',
            `**Tenant**: ${info.tenant}`,
            '',
            '正在用新凭据重连 WebSocket...',
            '⚠️ 如果新 bot 不在此群，后续消息将由新 bot 接管，老 bot 不会再回复。',
          ]
            .filter(Boolean)
            .join('\n'),
        },
      ],
    },
  };
}

export function accountFailureCard(reason: string): object {
  return {
    schema: '2.0',
    config: { summary: { content: '校验失败' } },
    body: {
      elements: [
        {
          tag: 'markdown',
          content: `❌ **校验失败**\n\n\`${reason}\`\n\n请检查 App ID 和 Secret 是否正确，重发 \`/account change\` 重试。`,
        },
      ],
    },
  };
}

export function accountCancelledCard(): object {
  return {
    schema: '2.0',
    config: { summary: { content: '已取消' } },
    body: { elements: [{ tag: 'markdown', content: '已取消，未做任何修改。' }] },
  };
}

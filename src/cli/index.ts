import { Command } from 'commander';
import pkg from '../../package.json';
import { formatAgentPreflightDiagnostic, getAgentPreflightDiagnostic } from '../agent/preflight';
import { runMigrate } from './commands/migrate';
import { runNotify } from './commands/notify';
import {
  installCodexLarkNotifySkillOnStartup,
  runSkillInstall,
  runSkillRemove,
  runSkillStatus,
} from './commands/skill';
import { runKillCli, runPs } from './commands/ps';
import {
  runSecretsGet,
  runSecretsList,
  runSecretsRemove,
  runSecretsSet,
} from './commands/secrets';
import {
  runProfileCreate,
  runProfileExport,
  runProfileList,
  runProfileRemove,
  runProfileUse,
} from './commands/profile';
import { runStart, type StartOptions } from './commands/start';
import { TerminalUi } from './terminal-ui';

const program = new Command();

program
  .name('codex-lark')
  .description('Continue Codex tasks from ChatGPT or Codex Desktop in Feishu/Lark')
  .version(pkg.version, '-v, --version')
  .option('--profile <name>', 'profile name (default: codex)')
  .option('--workspace <path>', 'initial working directory for first-time setup')
  .option('--app-id <id>', 'use an existing Lark/Feishu app instead of QR app creation')
  .option('--app-secret <secret>', 'App Secret for --app-id')
  .option('--tenant <tenant>', 'tenant for --app-id (feishu or lark; default feishu)')
  .action(async (opts: ForegroundOptions) => {
    await runForeground(opts);
  });

// === process-level commands (work directly on bridge processes) ===

program
  .command('run')
  .description('Run in the foreground (same as `codex-lark` with no command)')
  .option('-c, --config <path>', 'path to config file')
  .option('--profile <name>', 'profile name to run')
  .option('--workspace <path>', 'initial working directory for first-run profile bootstrap')
  .option('--app-id <id>', 'use an existing Lark/Feishu app instead of QR app creation')
  .option('--app-secret <secret>', 'App Secret for --app-id; prefer interactive input on shared machines')
  .option('--tenant <tenant>', 'tenant for --app-id (feishu or lark; default feishu)')
  .action(async (opts: ForegroundOptions & {
    config?: string;
  }) => {
    await runForeground(opts);
  });

program
  .command('migrate')
  .description('Migrate legacy bridge config/state into the current profile layout')
  .option('-c, --config <path>', 'path to config file')
  .option('--profile <name>', 'target profile name for legacy v1 config migration')
  .option('--agent <kind>', 'agent kind for legacy v1 profile migration (claude or codex)')
  .action(async (opts: { config?: string; profile?: string; agent?: string }) => {
    await runMigrate(opts);
  });

program
  .command('notify [message]')
  .description('Push a completed task result to Feishu/Lark')
  .option('--profile <name>', 'profile name (defaults to the active profile)')
  .option('--to <id>', 'recipient open_id or chat_id (defaults to the app owner)')
  .option('--title <title>', 'notification title')
  .option('--thread <id>', 'Codex thread id (defaults to CODEX_THREAD_ID)')
  .option('--task-title <title>', 'Codex task title shown in the notification card')
  .option('--markdown-file <path>', 'read notification Markdown from a file')
  .option('--file <path>', 'attach a local file; repeat for multiple files', collectOption, [])
  .option('--cwd <path>', 'workspace root for resolving local Markdown resources')
  .option('--stdin', 'read notification Markdown from stdin')
  .option('--plain', 'send plain Markdown instead of an interactive card')
  .option('--json', 'print the result as JSON')
  .action(async (
    message: string | undefined,
    opts: {
      profile?: string;
      to?: string;
      title?: string;
      thread?: string;
      taskTitle?: string;
      markdownFile?: string;
      file?: string[];
      cwd?: string;
      stdin?: boolean;
      plain?: boolean;
      json?: boolean;
    },
    command: Command,
  ) => {
    const withGlobals = command.optsWithGlobals() as { profile?: string };
    await runNotify(message, {
      profile: opts.profile ?? withGlobals.profile,
      to: opts.to,
      title: opts.title,
      thread: opts.thread,
      taskTitle: opts.taskTitle,
      markdownFile: opts.markdownFile,
      files: opts.file,
      cwd: opts.cwd,
      stdin: opts.stdin,
      plain: opts.plain,
      json: opts.json,
    });
  });

const skill = program
  .command('skill')
  .description('Manage the bundled Codex notification skill');

skill
  .command('install')
  .description('Install or safely update the bundled Codex notification skill')
  .action(async () => {
    await runSkillInstall();
  });

skill
  .command('status')
  .description('Show the bundled Codex notification skill status')
  .action(async () => {
    await runSkillStatus();
  });

skill
  .command('remove')
  .description('Remove the skill when it is still managed and unmodified')
  .action(async () => {
    await runSkillRemove();
  });

const profile = program
  .command('profile')
  .description('Manage local bridge profiles');

profile
  .command('list')
  .description('List configured profiles')
  .action(async () => {
    await runProfileList();
  });

profile
  .command('create <name>')
  .description('Create a profile from QR registration or existing app credentials')
  .option('--agent <kind>', 'agent kind (claude or codex)')
  .option('--workspace <path>', 'initial working directory for this profile')
  .option('--app-id <id>', 'use an existing Lark/Feishu app instead of QR app creation')
  .option('--app-secret <secret>', 'App Secret for --app-id; prefer interactive input on shared machines')
  .option('--tenant <tenant>', 'tenant for --app-id (feishu or lark; default feishu)')
  .action(async (name: string, opts: {
    agent?: string;
    workspace?: string;
    appId?: string;
    appSecret?: string;
    tenant?: string;
  }) => {
    await runProfileCreate(name, opts);
  });

profile
  .command('use <name>')
  .description('Set the active profile')
  .action(async (name: string) => {
    await runProfileUse(name);
  });

profile
  .command('remove <name>')
  .description('Archive a profile and its local state')
  .option('--purge', 'permanently delete profile state instead of archiving')
  .option('--yes', 'confirm destructive profile deletion')
  .action(async (name: string, opts: { purge?: boolean; yes?: boolean }) => {
    await runProfileRemove(name, { purge: opts.purge, yes: opts.yes });
  });

profile
  .command('export <name>')
  .description('Export one profile as JSON')
  .option('--output <path>', 'write export JSON to a file instead of stdout')
  .option('--force', 'overwrite an existing output file')
  .option('--include-secrets', 'include secret provider configuration and app secret values')
  .option('--yes', 'confirm exporting secrets')
  .action(async (name: string, opts: {
    output?: string;
    force?: boolean;
    includeSecrets?: boolean;
    yes?: boolean;
  }) => {
    await runProfileExport(name, {
      output: opts.output,
      force: opts.force,
      includeSecrets: opts.includeSecrets,
      yes: opts.yes,
    });
  });

program
  .command('ps')
  .description('List running bridge processes on this machine')
  .action(() => {
    runPs();
  });

program
  .command('kill <target>')
  .description('Kill a running bridge process by short id or list index (graceful stop, then force after 2s). Was `stop <target>` in older versions.')
  .action(async (target: string) => {
    await runKillCli(target);
  });

const secrets = program
  .command('secrets')
  .description('Manage the bridge\'s encrypted secret keystore (~/.codex-lark/secrets.enc)');

secrets
  .command('get')
  .description('Exec-provider protocol: read JSON request from stdin, write JSON response to stdout. Used by lark-cli config bind --source lark-channel.')
  .action(async () => {
    await runSecretsGet();
  });

secrets
  .command('set')
  .description('Encrypt and store an App Secret. Prompts for the secret without echoing.')
  .requiredOption('--app-id <id>', 'App ID (e.g. cli_xxxxxxxxxxxx)')
  .option('--profile <name>', 'profile name (defaults to active profile)')
  .action(async (opts: { appId: string; profile?: string }) => {
    await runSecretsSet(opts.appId, { profile: opts.profile });
  });

secrets
  .command('list')
  .description('List the IDs of secrets in the encrypted keystore (no secrets shown)')
  .option('--profile <name>', 'profile name (defaults to active profile)')
  .action(async (opts: { profile?: string }) => {
    await runSecretsList({ profile: opts.profile });
  });

secrets
  .command('remove')
  .description('Delete an entry from the encrypted keystore')
  .requiredOption('--app-id <id>', 'App ID to remove')
  .option('--profile <name>', 'profile name (defaults to active profile)')
  .action(async (opts: { appId: string; profile?: string }) => {
    await runSecretsRemove(opts.appId, { profile: opts.profile });
  });

interface ForegroundOptions {
  config?: string;
  profile?: string;
  workspace?: string;
  appId?: string;
  appSecret?: string;
  tenant?: string;
}

function collectOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}

async function runForeground(opts: ForegroundOptions): Promise<void> {
  await installCodexLarkNotifySkillOnStartup();
  const ui = new TerminalUi();
  ui.start();
  try {
    const startOptions: StartOptions = {
      ...opts,
      profile: opts.profile ?? 'codex',
      agent: 'codex',
      skipCheckLarkCli: true,
      registrationProgress: ui.registrationProgress,
      onStatus: (phase, detail) => ui.status(phase, detail),
    };
    await runStart(startOptions);
  } catch (error) {
    ui.fail(error);
    throw error;
  }
}

program.parseAsync(process.argv).catch((err: unknown) => {
  const diagnostic = getAgentPreflightDiagnostic(err);
  if (diagnostic) {
    console.error(formatAgentPreflightDiagnostic(diagnostic));
    process.exit(1);
  }
  if (err instanceof Error) {
    if (err.name === 'UserCancelledError') {
      console.log(err.message);
      process.exit(0);
    }
    console.error(`Error: ${err.message}`);
  } else {
    console.error(err);
  }
  process.exit(1);
});

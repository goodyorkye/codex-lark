# Privacy

## Data flow

Messages and files sent in Feishu/Lark pass through that platform and the local bridge. Prompts and selected local files are then processed by the Codex Desktop account and services configured on the local computer. Review the privacy and retention terms of both services before use.

`codex-lark` does not add a hosted relay or local web dashboard. The project ships no telemetry backend; an optional telemetry adapter can receive only sanitized operational events and must not receive prompts, transcripts, credentials, or file contents.

The optional Dots integration reuses the installed Desktop core's existing ChatGPT login to access the owner's original Dot cloud messaging room. Selected private-chat text, original images and files become part of that native conversation. Generated native attachments return through the same Feishu bot. No additional hosted relay, local MCP server, custom plugin, Tunnel or application patch is added.

When `DASHSCOPE_API_KEY` is configured, source voice/audio is sent over HTTPS to Aliyun Model Studio for transcription using that key's quota. The transcript and original audio are forwarded to the Dot. Without the key, audio is not downloaded or forwarded and Feishu receives local setup instructions. The bridge does not synthesize speech or invoke local speech commands.

Dots stores plaintext queued input, transcripts, replies and source/native file identifiers in private `dots/desktop-state.json`. Login/API credentials, signed file URLs and attachment bodies are not stored there. Temporary input files are deleted after use; outbound native attachments are fetched into bounded memory. Authentication remains in memory for the fixed OpenAI origin, while room activity uses the client's native authenticated state channels. Review [Dots setup and retention limits](DOTS.md) before enabling it.

## Local data

`~/.codex-lark/` can contain encrypted app credentials, chat-to-task selection, workspace aliases, downloaded attachment cache, callback nonces, locks, sanitized logs, and on Windows a versioned runtime copy of the signed core taken from the installed Desktop package. The canonical Codex task history remains in the Codex task store managed by the Desktop core.

Attachment cache entries expire and are garbage-collected. Removing a profile archives its state by default; permanent deletion requires the explicit `--purge --yes` CLI combination.

## Recommended operation

- Use a dedicated operating-system account if the computer is shared with untrusted users or software.
- Keep group access closed unless collaboration is intentional.
- Do not paste production secrets into tasks.
- Review approval cards carefully, especially commands and file changes outside the selected project.
- Stop the bridge when remote access is not needed.

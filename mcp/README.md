# Optional PepLogs MCP

This integration is opt-in. The existing GitHub Pages frontend and individual Google Apps Script/Sheets deployments remain unchanged.

## Security prerequisites

- Never treat an Apps Script deployment URL as proof of user identity.
- Do not expose individual deployment URLs, tokens, or personal records in this public repository.
- A remotely hosted MCP service must authenticate each user, securely bind their identity to their own deployment, and authorize every request.
- Start with read-only operations and explicit consent. Provide a revocation mechanism.
- Test with a disposable Sheet and Apps Script deployment before production use.

## Status

Design only. No MCP endpoint has been deployed and no live Sheets have been modified.

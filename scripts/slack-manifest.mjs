#!/usr/bin/env node
// Point the Slack app's webhook + OAuth URLs at a different origin without the Slack UI.
//
//   npm run slack:manifest            show where the app currently points
//   npm run slack:manifest -- local   switch to the Tailscale dev URL
//   npm run slack:manifest -- prod    switch to the deployed Factory
//   npm run slack:manifest -- https://foo.example.com [--dry-run]
//
// Needs an App Configuration refresh token (api.slack.com/apps → "Your App Configuration
// Tokens" → Generate) in .env as SLACK_CONFIG_REFRESH_TOKEN. Config tokens expire after
// 12h and refresh tokens are single-use, so the rotated pair is cached in
// .slack-config-token.json (gitignored) and that file wins over .env after the first run.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const PRESETS = {
  local: process.env.SLACK_MANIFEST_LOCAL_URL ?? 'https://dschau.tail9b165a.ts.net',
  prod: process.env.SLACK_MANIFEST_PROD_URL ?? 'https://personal-factory.factory.mastra.cloud',
};
const TOKEN_CACHE = '.slack-config-token.json';

if (existsSync('.env')) process.loadEnvFile('.env');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const target = args.find((a) => !a.startsWith('--'));

async function slack(method, params, token) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: new URLSearchParams(params),
  });
  const data = await res.json();
  if (!data.ok) {
    const detail = data.errors ? `\n${JSON.stringify(data.errors, null, 2)}` : '';
    throw new Error(`${method}: ${data.error}${detail}`);
  }
  return data;
}

async function configToken() {
  const cached = existsSync(TOKEN_CACHE) ? JSON.parse(readFileSync(TOKEN_CACHE, 'utf8')) : {};
  if (cached.token && cached.exp * 1000 > Date.now() + 60_000) return cached.token;

  const refreshToken = cached.refreshToken ?? process.env.SLACK_CONFIG_REFRESH_TOKEN;
  if (!refreshToken) {
    throw new Error('Set SLACK_CONFIG_REFRESH_TOKEN in .env (api.slack.com/apps → App Configuration Tokens).');
  }
  const { token, refresh_token, exp } = await slack('tooling.tokens.rotate', { refresh_token: refreshToken });
  writeFileSync(TOKEN_CACHE, JSON.stringify({ token, refreshToken: refresh_token, exp }, null, 2) + '\n', {
    mode: 0o600,
  });
  return token;
}

async function appId() {
  if (process.env.SLACK_APP_ID) return process.env.SLACK_APP_ID;
  const botToken = process.env.SLACK_APP_BOT_TOKEN;
  if (!botToken) throw new Error('Set SLACK_APP_ID or SLACK_APP_BOT_TOKEN in .env.');
  const { bot_id } = await slack('auth.test', {}, botToken);
  const { bot } = await slack('bots.info', { bot: bot_id }, botToken);
  return bot.app_id;
}

const withOrigin = (url, origin) => new URL(new URL(url).pathname, origin).toString();

function currentUrls(manifest) {
  return {
    events: manifest.settings?.event_subscriptions?.request_url,
    interactivity: manifest.settings?.interactivity?.request_url,
    oauthRedirects: manifest.oauth_config?.redirect_urls ?? [],
  };
}

process.on('uncaughtException', (err) => {
  console.error(err.message);
  process.exit(1);
});

const id = await appId();
const token = await configToken();
const { manifest } = await slack('apps.manifest.export', { app_id: id }, token);

if (!target) {
  console.log(`App ${id} (${manifest.display_information?.name}) currently points at:`);
  console.log(currentUrls(manifest));
  process.exit(0);
}

const origin = new URL(PRESETS[target] ?? target).origin;
const { event_subscriptions: events, interactivity } = manifest.settings ?? {};
if (events?.request_url) events.request_url = withOrigin(events.request_url, origin);
if (interactivity?.request_url) interactivity.request_url = withOrigin(interactivity.request_url, origin);
if (manifest.oauth_config?.redirect_urls) {
  manifest.oauth_config.redirect_urls = [
    ...new Set(manifest.oauth_config.redirect_urls.map((u) => withOrigin(u, origin))),
  ];
}

console.log(`Switching app ${id} to ${origin}:`);
console.log(currentUrls(manifest));
if (dryRun) process.exit(0);

// Slack re-verifies the events URL on update, so the target server must be up.
await slack('apps.manifest.update', { app_id: id, manifest: JSON.stringify(manifest) }, token);
console.log('Updated.');

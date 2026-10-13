import { createInterface } from 'node:readline';

const endpoint = process.env.PEPLOGS_SCRIPT_URL;
const tool = { name: 'read_peplogs', description: 'Read your own PepLogs data (read only)', inputSchema: { type: 'object', properties: {}, additionalProperties: false } };
const send = value => process.stdout.write(JSON.stringify(value) + '\n');

async function readData() {
  if (!endpoint) throw new Error('PEPLOGS_SCRIPT_URL is required');
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || url.hostname !== 'script.google.com' || !/^\/macros\/s\/[\w-]+\/exec$/.test(url.pathname)) throw new Error('Invalid Apps Script URL');
  url.searchParams.set('action', 'getAllData');
  const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error('Backend HTTP error');
  const data = await response.json();
  if (data.success !== true) throw new Error('Backend rejected request');
  return data;
}

for await (const line of createInterface({ input: process.stdin })) {
  let request;
  try { request = JSON.parse(line); } catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); continue; }
  if (request.id === undefined) continue;
  const reply = result => send({ jsonrpc: '2.0', id: request.id, result });
  if (request.method === 'initialize') reply({ protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'peplogs-local', version: '0.1.0' } });
  else if (request.method === 'tools/list') reply({ tools: [tool] });
  else if (request.method === 'ping') reply({});
  else if (request.method === 'tools/call' && request.params?.name === tool.name) {
    try { reply({ content: [{ type: 'text', text: JSON.stringify(await readData()) }] }); }
    catch (error) { reply({ isError: true, content: [{ type: 'text', text: error.message }] }); }
  } else send({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Method not found' } });
}

import { describe, expect, it } from 'vitest';
import { buildQueryOptions } from '../../src/cli.js';

describe('CLI Agent SDK lockdown', () => {
  it('uses only the watch-only coinwatch MCP tools and strips all built-ins', () => {
    const server = { type: 'sdk', name: 'coinwatch' } as Parameters<typeof buildQueryOptions>[0];
    const options = buildQueryOptions(server);

    expect(Object.keys(options).sort()).toEqual([
      'allowedTools',
      'mcpServers',
      'model',
      'permissionMode',
      'settingSources',
      'systemPrompt',
      'tools',
    ]);
    expect(options.model).toBe('claude-opus-4-8');
    expect(options.tools).toEqual([]);
    expect(options.allowedTools).toEqual(['mcp__coinwatch__*']);
    expect(options.settingSources).toEqual([]);
    expect(options.permissionMode).toBe('default');
    expect(options.mcpServers).toEqual({ coinwatch: server });
    expect(options).not.toHaveProperty('allowDangerouslySkipPermissions');
    expect(options).not.toHaveProperty('disallowedTools');
    expect(JSON.stringify(options)).not.toContain('bypassPermissions');
  });

  it('can import the CLI module without starting the REPL or calling the model', async () => {
    const mod = await import('../../src/cli.js');
    expect(mod.main).toBeTypeOf('function');
    expect(mod.userMessages).toBeTypeOf('function');
  });
});

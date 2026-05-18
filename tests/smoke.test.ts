import { describe, expect, it } from 'vitest';
import { buildReadyMessage, serviceName } from '../src/index';

describe('scaffold smoke', () => {
  it('exposes the service name', () => {
    expect(serviceName).toBe('partner-mcp-gateway');
  });

  it('builds the ready banner', () => {
    expect(buildReadyMessage()).toBe('partner-mcp-gateway ready');
    expect(buildReadyMessage('alt')).toBe('alt ready');
  });
});

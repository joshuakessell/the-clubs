import { describe, it, expect } from 'vitest';
import { sendError, Errors } from '../src/errors/index';

// Mock FastifyReply
function mockReply() {
  const sent: { statusCode?: number; body?: unknown } = {};
  const reply = {
    status(code: number) {
      sent.statusCode = code;
      return reply;
    },
    send(body: unknown) {
      sent.body = body;
      return reply;
    },
  };
  return { reply: reply as any, sent };
}

describe('sendError', () => {
  it('sends correct status and body', () => {
    const { reply, sent } = mockReply();
    sendError(reply, 400, 'Bad request', 'Invalid input');
    expect(sent.statusCode).toBe(400);
    expect(sent.body).toEqual({ error: 'Bad request', message: 'Invalid input' });
  });

  it('includes details when provided', () => {
    const { reply, sent } = mockReply();
    const details = [{ field: 'name', issue: 'required' }];
    sendError(reply, 400, 'Validation', 'Invalid', details);
    expect((sent.body as any).details).toEqual(details);
  });

  it('omits details when undefined', () => {
    const { reply, sent } = mockReply();
    sendError(reply, 500, 'Error', 'Something failed');
    expect((sent.body as any).details).toBeUndefined();
  });
});

describe('Errors helpers', () => {
  it('unauthorized sends 401', () => {
    const { reply, sent } = mockReply();
    Errors.unauthorized(reply);
    expect(sent.statusCode).toBe(401);
    expect((sent.body as any).error).toBe('Unauthorized');
    expect((sent.body as any).message).toBe('Authentication required');
  });

  it('unauthorized with custom message', () => {
    const { reply, sent } = mockReply();
    Errors.unauthorized(reply, 'Token expired');
    expect((sent.body as any).message).toBe('Token expired');
  });

  it('forbidden sends 403', () => {
    const { reply, sent } = mockReply();
    Errors.forbidden(reply);
    expect(sent.statusCode).toBe(403);
    expect((sent.body as any).message).toBe('Insufficient permissions');
  });

  it('notFound sends 404', () => {
    const { reply, sent } = mockReply();
    Errors.notFound(reply, 'Customer');
    expect(sent.statusCode).toBe(404);
    expect((sent.body as any).message).toBe('Customer not found');
  });

  it('notFound with default entity', () => {
    const { reply, sent } = mockReply();
    Errors.notFound(reply);
    expect((sent.body as any).message).toBe('Resource not found');
  });

  it('badRequest sends 400', () => {
    const { reply, sent } = mockReply();
    Errors.badRequest(reply, 'Missing name');
    expect(sent.statusCode).toBe(400);
    expect((sent.body as any).message).toBe('Missing name');
  });

  it('badRequest with details', () => {
    const { reply, sent } = mockReply();
    Errors.badRequest(reply, 'Validation', { fields: ['a'] });
    expect((sent.body as any).details).toEqual({ fields: ['a'] });
  });

  it('conflict sends 409', () => {
    const { reply, sent } = mockReply();
    Errors.conflict(reply, 'Already exists');
    expect(sent.statusCode).toBe(409);
    expect((sent.body as any).message).toBe('Already exists');
  });

  it('internal sends 500', () => {
    const { reply, sent } = mockReply();
    Errors.internal(reply);
    expect(sent.statusCode).toBe(500);
    expect((sent.body as any).message).toBe('Internal server error');
  });
});

import { describe, it, expect } from 'vitest';
import { HttpError } from '../src/errors/HttpError';

describe('HttpError', () => {
  it('is an instance of Error', () => {
    const err = new HttpError(400, 'Bad request');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(HttpError);
  });

  it('sets statusCode and message', () => {
    const err = new HttpError(404, 'Not found');
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe('Not found');
  });

  it('sets name to HttpError', () => {
    const err = new HttpError(500, 'Server error');
    expect(err.name).toBe('HttpError');
  });

  it('sets optional code', () => {
    const err = new HttpError(403, 'Forbidden', { code: 'BANNED' });
    expect(err.code).toBe('BANNED');
  });

  it('defaults code to undefined when not provided', () => {
    const err = new HttpError(400, 'Bad request');
    expect(err.code).toBeUndefined();
  });

  it('sets cause when provided', () => {
    const orig = new Error('original');
    const err = new HttpError(500, 'Wrapper', { cause: orig });
    expect((err as Error & { cause?: unknown }).cause).toBe(orig);
  });

  it('does not set cause when not provided', () => {
    const err = new HttpError(400, 'No cause');
    expect((err as Error & { cause?: unknown }).cause).toBeUndefined();
  });

  it('supports both code and cause together', () => {
    const orig = new Error('root');
    const err = new HttpError(409, 'Conflict', { cause: orig, code: 'DUPLICATE' });
    expect(err.statusCode).toBe(409);
    expect(err.message).toBe('Conflict');
    expect(err.code).toBe('DUPLICATE');
    expect((err as Error & { cause?: unknown }).cause).toBe(orig);
  });

  it('has a stack trace', () => {
    const err = new HttpError(500, 'Error');
    expect(err.stack).toBeDefined();
    expect(err.stack).toContain('HttpError');
  });
});

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { protect, AuthRequest } from '../middleware/auth';

process.env.JWT_SECRET = 'test-secret';

function mockRes() {
  const res = { status: jest.fn(), json: jest.fn() } as unknown as Response;
  (res.status as jest.Mock).mockReturnValue(res);
  return res;
}

const next: NextFunction = jest.fn();

describe('protect middleware', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 401 when Authorization header is missing', () => {
    const req = { headers: {} } as AuthRequest;
    const res = mockRes();
    protect(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when header does not start with Bearer', () => {
    const req = { headers: { authorization: 'Basic abc123' } } as AuthRequest;
    const res = mockRes();
    protect(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 for an invalid token', () => {
    const req = { headers: { authorization: 'Bearer invalidtoken' } } as AuthRequest;
    const res = mockRes();
    protect(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('sets req.userId and calls next for a valid token', () => {
    const token = jwt.sign({ userId: 'user123' }, 'test-secret');
    const req = { headers: { authorization: `Bearer ${token}` } } as AuthRequest;
    const res = mockRes();
    protect(req, res, next);
    expect(req.userId).toBe('user123');
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});

const request = require('supertest');
const jwt = require('jsonwebtoken');

const { app, JWT_SECRET } = require('../server');

describe('POST /login', () => {
  it('returns a token and user for valid admin credentials', async () => {
    const res = await request(app).post('/login').send({ username: 'admin', password: 'admin123' });

    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({ id: 1, username: 'admin', role: 'admin' });

    const payload = jwt.verify(res.body.token, JWT_SECRET);
    expect(payload).toMatchObject({ id: 1, username: 'admin', role: 'admin' });
    expect(payload.exp - payload.iat).toBe(24 * 60 * 60);
  });

  it('returns a token for valid regular user credentials', async () => {
    const res = await request(app).post('/login').send({ username: 'user', password: 'user123' });

    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({ id: 2, username: 'user', role: 'user' });
  });

  it('matches the username case-insensitively', async () => {
    const res = await request(app).post('/login').send({ username: 'AdMiN', password: 'admin123' });

    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe('admin');
  });

  it('never leaks the password hash', async () => {
    const res = await request(app).post('/login').send({ username: 'admin', password: 'admin123' });

    expect(res.body.user.password).toBeUndefined();
  });

  it.each([
    ['missing password', { username: 'admin' }],
    ['missing username', { password: 'admin123' }],
    ['empty body', {}],
    ['empty strings', { username: '', password: '' }],
  ])('rejects %s with 400', async (_label, body) => {
    const res = await request(app).post('/login').send(body);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Username and password are required.' });
  });

  it('rejects an unknown username with 401', async () => {
    const res = await request(app).post('/login').send({ username: 'nobody', password: 'admin123' });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid username or password.' });
  });

  it('rejects a wrong password with 401', async () => {
    const res = await request(app).post('/login').send({ username: 'admin', password: 'wrong' });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid username or password.' });
  });
});

describe('authenticateToken middleware', () => {
  it('rejects requests without an Authorization header', async () => {
    const res = await request(app).get('/files');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Access denied. No token provided.' });
  });

  it('rejects an Authorization header without a bearer token part', async () => {
    const res = await request(app).get('/files').set('Authorization', 'Bearer');

    expect(res.status).toBe(401);
  });

  it('rejects a malformed token', async () => {
    const res = await request(app).get('/files').set('Authorization', 'Bearer not-a-jwt');

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Invalid or expired token.' });
  });

  it('rejects a token signed with a different secret', async () => {
    const token = jwt.sign({ id: 1, username: 'admin', role: 'admin' }, 'other-secret');
    const res = await request(app).get('/files').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it('rejects an expired token', async () => {
    const token = jwt.sign({ id: 1, username: 'admin', role: 'admin' }, JWT_SECRET, { expiresIn: '-1s' });
    const res = await request(app).get('/files').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Invalid or expired token.' });
  });

  it('accepts a valid token', async () => {
    const token = jwt.sign({ id: 2, username: 'user', role: 'user' }, JWT_SECRET);
    const res = await request(app).get('/files').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
  });
});

describe('requireAdmin middleware', () => {
  it('blocks non-admin users with 403', async () => {
    const token = jwt.sign({ id: 2, username: 'user', role: 'user' }, JWT_SECRET);
    const res = await request(app).delete('/delete/whatever.txt').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Access denied. Admin privileges required.' });
  });

  it('lets admins through to the route handler', async () => {
    const token = jwt.sign({ id: 1, username: 'admin', role: 'admin' }, JWT_SECRET);
    const res = await request(app).delete('/delete/missing.txt').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'File not found' });
  });
});

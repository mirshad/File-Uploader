const fs = require('fs');
const path = require('path');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const { app, JWT_SECRET, uploadDir } = require('../server');

const adminToken = jwt.sign({ id: 1, username: 'admin', role: 'admin' }, JWT_SECRET);
const userToken = jwt.sign({ id: 2, username: 'user', role: 'user' }, JWT_SECRET);

function clearUploadDir() {
  for (const entry of fs.readdirSync(uploadDir)) {
    fs.rmSync(path.join(uploadDir, entry), { recursive: true, force: true });
  }
}

beforeEach(() => {
  clearUploadDir();
  jest.restoreAllMocks();
});

afterAll(() => clearUploadDir());

describe('POST /upload', () => {
  it('stores the file under its original name and echoes its metadata', async () => {
    const res = await request(app)
      .post('/upload')
      .set('Authorization', `Bearer ${userToken}`)
      .attach('file', Buffer.from('hello world'), 'notes.txt');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      message: 'File uploaded successfully',
      filename: 'notes.txt',
      originalName: 'notes.txt',
      size: 11,
    });
    expect(fs.readFileSync(path.join(uploadDir, 'notes.txt'), 'utf8')).toBe('hello world');
  });

  it('overwrites an existing file with the same name', async () => {
    await request(app)
      .post('/upload')
      .set('Authorization', `Bearer ${userToken}`)
      .attach('file', Buffer.from('first'), 'dup.txt');
    await request(app)
      .post('/upload')
      .set('Authorization', `Bearer ${userToken}`)
      .attach('file', Buffer.from('second'), 'dup.txt');

    expect(fs.readdirSync(uploadDir)).toEqual(['dup.txt']);
    expect(fs.readFileSync(path.join(uploadDir, 'dup.txt'), 'utf8')).toBe('second');
  });

  it('returns 400 when no file field is present', async () => {
    const res = await request(app)
      .post('/upload')
      .set('Authorization', `Bearer ${userToken}`)
      .field('note', 'no file here');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'No file uploaded' });
  });

  it('requires authentication', async () => {
    const res = await request(app).post('/upload').attach('file', Buffer.from('x'), 'x.txt');

    expect(res.status).toBe(401);
    expect(fs.readdirSync(uploadDir)).toEqual([]);
  });

  it('rejects files larger than the 10MB limit', async () => {
    const res = await request(app)
      .post('/upload')
      .set('Authorization', `Bearer ${userToken}`)
      .attach('file', Buffer.alloc(10 * 1024 * 1024 + 1), 'big.bin');

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body.filename).toBeUndefined();
  });
});

describe('GET /files', () => {
  it('returns an empty list when nothing has been uploaded', async () => {
    const res = await request(app).get('/files').set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ files: [] });
  });

  it('lists uploaded files with size and upload date', async () => {
    fs.writeFileSync(path.join(uploadDir, 'a.txt'), 'abc');
    fs.writeFileSync(path.join(uploadDir, 'b.txt'), 'defgh');

    const res = await request(app).get('/files').set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    const byName = Object.fromEntries(res.body.files.map(f => [f.filename, f]));
    expect(Object.keys(byName).sort()).toEqual(['a.txt', 'b.txt']);
    expect(byName['a.txt'].size).toBe(3);
    expect(byName['b.txt'].size).toBe(5);
    expect(Number.isNaN(Date.parse(byName['a.txt'].uploadDate))).toBe(false);
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/files');

    expect(res.status).toBe(401);
  });

  it('returns 500 when the upload directory cannot be read', async () => {
    jest.spyOn(fs, 'readdir').mockImplementation((dir, cb) => cb(new Error('boom')));

    const res = await request(app).get('/files').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to read files' });
  });
});

describe('GET /download/:filename', () => {
  it('sends the file contents as an attachment', async () => {
    fs.writeFileSync(path.join(uploadDir, 'report.txt'), 'download me');

    const res = await request(app).get('/download/report.txt');

    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('report.txt');
    expect(res.text).toBe('download me');
  });

  it('returns 404 for a missing file', async () => {
    const res = await request(app).get('/download/nope.txt');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'File not found' });
  });

  it('is publicly accessible without a token', async () => {
    fs.writeFileSync(path.join(uploadDir, 'public.txt'), 'anyone');

    const res = await request(app).get('/download/public.txt');

    expect(res.status).toBe(200);
  });
});

describe('DELETE /delete/:filename', () => {
  it('removes the file for an admin', async () => {
    const target = path.join(uploadDir, 'stale.txt');
    fs.writeFileSync(target, 'bye');

    const res = await request(app).delete('/delete/stale.txt').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'File deleted successfully', filename: 'stale.txt' });
    expect(fs.existsSync(target)).toBe(false);
  });

  it('does not delete anything for a non-admin', async () => {
    const target = path.join(uploadDir, 'keep.txt');
    fs.writeFileSync(target, 'keep');

    const res = await request(app).delete('/delete/keep.txt').set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(403);
    expect(fs.existsSync(target)).toBe(true);
  });

  it('requires authentication', async () => {
    const res = await request(app).delete('/delete/anything.txt');

    expect(res.status).toBe(401);
  });

  it('returns 404 for a missing file', async () => {
    const res = await request(app).delete('/delete/ghost.txt').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'File not found' });
  });

  it('returns 500 when unlinking fails', async () => {
    fs.writeFileSync(path.join(uploadDir, 'locked.txt'), 'x');
    jest.spyOn(fs, 'unlink').mockImplementation((p, cb) => cb(new Error('EPERM')));

    const res = await request(app).delete('/delete/locked.txt').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to delete file' });
  });
});

describe('GET /uploads static serving', () => {
  it('serves an uploaded file for previews', async () => {
    fs.writeFileSync(path.join(uploadDir, 'preview.txt'), 'inline');

    const res = await request(app).get('/uploads/preview.txt');

    expect(res.status).toBe(200);
    expect(res.text).toBe('inline');
  });

  it('returns 404 for an unknown preview path', async () => {
    const res = await request(app).get('/uploads/missing.txt');

    expect(res.status).toBe(404);
  });
});

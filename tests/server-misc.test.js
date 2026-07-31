const os = require('os');
const request = require('supertest');

const { app, getLocalIp } = require('../server');

afterEach(() => jest.restoreAllMocks());

describe('GET /health', () => {
  it('reports that the server is running', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'Server is running' });
  });
});

describe('static pages', () => {
  it.each(['/', '/login.html', '/view.html', '/index.html'])('serves %s as HTML', async route => {
    const res = await request(app).get(route);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
  });

  it('returns 404 for an unknown route', async () => {
    const res = await request(app).get('/does-not-exist');

    expect(res.status).toBe(404);
  });
});

describe('getLocalIp', () => {
  it('returns the first external IPv4 address of the Wi-Fi interface', () => {
    jest.spyOn(os, 'networkInterfaces').mockReturnValue({
      'Wi-Fi': [
        { family: 'IPv6', internal: false, address: 'fe80::1' },
        { family: 'IPv4', internal: true, address: '127.0.0.1' },
        { family: 'IPv4', internal: false, address: '192.168.1.20' },
        { family: 'IPv4', internal: false, address: '192.168.1.99' },
      ],
    });

    expect(getLocalIp()).toBe('192.168.1.20');
  });

  it('falls back to the Ethernet interface when Wi-Fi is absent', () => {
    jest.spyOn(os, 'networkInterfaces').mockReturnValue({
      Ethernet: [{ family: 'IPv4', internal: false, address: '10.0.0.5' }],
    });

    expect(getLocalIp()).toBe('10.0.0.5');
  });

  it('returns null when only internal or IPv6 addresses exist', () => {
    jest.spyOn(os, 'networkInterfaces').mockReturnValue({
      'Wi-Fi': [
        { family: 'IPv4', internal: true, address: '127.0.0.1' },
        { family: 'IPv6', internal: false, address: '::1' },
      ],
    });

    expect(getLocalIp()).toBeNull();
  });

  it('throws when neither a Wi-Fi nor an Ethernet interface exists', () => {
    jest.spyOn(os, 'networkInterfaces').mockReturnValue({ eth0: [] });

    expect(() => getLocalIp()).toThrow(TypeError);
  });
});

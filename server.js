const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

function requiredInProduction(name, fallback) {
  const value = process.env[name];
  if (value) {
    return value;
  }
  if (IS_PRODUCTION) {
    console.error(`${name} must be set when NODE_ENV=production.`);
    process.exit(1);
  }
  console.warn(`${name} is not set; using an insecure development default.`);
  return fallback;
}

// Signing key for JWTs. Never commit a real secret: set JWT_SECRET in the environment.
// Without it, a random per-process key is used so tokens do not survive a restart.
const JWT_SECRET = requiredInProduction('JWT_SECRET', crypto.randomBytes(32).toString('hex'));

// Demo users (in production, use a database)
const users = [
  {
    id: 1,
    username: 'admin',
    password: bcrypt.hashSync(requiredInProduction('ADMIN_PASSWORD', 'admin123'), 10),
    role: 'admin'
  },
  {
    id: 2,
    username: 'user',
    password: bcrypt.hashSync(requiredInProduction('USER_PASSWORD', 'user123'), 10),
    role: 'user'
  }
];

// CORS is disabled unless ALLOWED_ORIGINS lists the origins that may call the API.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin: allowedOrigins.length > 0 ? allowedOrigins : false,
  methods: ['GET', 'POST', 'DELETE'],
  allowedHeaders: ['Authorization', 'Content-Type']
}));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// Parse JSON bodies
app.use(express.json({ limit: '100kb' }));

// Serve static files (HTML, CSS, JS)
app.use(express.static(path.join(__dirname)));

// Authentication middleware. GET requests may pass the token as a query
// parameter because <img>/<iframe> previews cannot set request headers.
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const headerToken = authHeader && authHeader.split(' ')[1];
  const token = headerToken || (req.method === 'GET' ? req.query.token : null);

  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token.' });
    }
    req.user = user;
    next();
  });
}

// Admin middleware
function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Access denied. Admin privileges required.' });
  }
  next();
}

function getLocalIp() {
  const interfaces = os.networkInterfaces();
  const preferred = ['Wi-Fi', 'Ethernet'];
  const names = [...preferred, ...Object.keys(interfaces).filter(n => !preferred.includes(n))];

  for (const name of names) {
    const addresses = interfaces[name];
    if (!addresses) continue;

    for (const addr of addresses) {
      // Skip internal (loopback) and IPv6 addresses
      if (addr.family === 'IPv4' && !addr.internal) {
        return addr.address;
      }
    }
  }

  return null;
}

//const localIp = getLocalIp();

// Throttle login attempts per client address to slow down credential stuffing.
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;
const loginAttempts = new Map();

function loginRateLimit(req, res, next) {
  const now = Date.now();
  const key = req.ip;
  const entry = loginAttempts.get(key);

  if (!entry || now - entry.start > LOGIN_WINDOW_MS) {
    loginAttempts.set(key, { start: now, count: 1 });
    return next();
  }

  entry.count += 1;
  if (entry.count > LOGIN_MAX_ATTEMPTS) {
    return res.status(429).json({ error: 'Too many login attempts. Try again later.' });
  }
  next();
}

// Login endpoint
app.post('/login', loginRateLimit, (req, res) => {
  const { username, password } = req.body;

  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());

  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Invalid username or password.' });
  }

  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: '24h' }
  );

  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      role: user.role
    }
  });
});

// Create uploads directory if it doesn't exist
const uploadDir = path.resolve(process.env.UPLOAD_DIR || '/tmp/uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Reduce a client supplied name to a single safe path segment.
function sanitizeFilename(originalName) {
  const base = path.basename(String(originalName || '')).replace(/[^A-Za-z0-9._-]/g, '_');
  const trimmed = base.replace(/^\.+/, '').slice(0, 100);
  return trimmed || 'file';
}

// Resolve a request supplied filename inside uploadDir, or null if it escapes it.
function resolveUploadPath(filename) {
  const safeName = path.basename(String(filename || ''));
  if (!safeName || safeName === '.' || safeName === '..') {
    return null;
  }
  const resolved = path.resolve(uploadDir, safeName);
  if (resolved !== path.join(uploadDir, safeName)) {
    return null;
  }
  return resolved;
}

// Configure multer for file storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Create unique filename with timestamp so uploads cannot overwrite each other
    const uniqueSuffix = Date.now() + '-' + crypto.randomBytes(6).toString('hex');
    cb(null, `${uniqueSuffix}-${sanitizeFilename(file.originalname)}`);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    files: 1
  }
});

// Resolve an uploaded file, responding with 404 when it does not exist.
function resolveUploadedFile(req, res) {
  const filename = req.params.filename;
  const filePath = path.join(uploadDir, filename);

  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'File not found' });
    return null;
  }

  return { filename, filePath };
}

// Upload endpoint
app.post('/upload', authenticateToken, upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
// Translate multer failures (size limit, unexpected field, disk errors) into JSON
// responses; they happen in middleware, outside the route handler's reach.
function handleUpload(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (!err) {
      return next();
    }

    console.log('File uploaded by:', req.user.username, '-', req.file.filename);
    
    res.json({
      message: 'File uploaded successfully',
      filename: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Upload failed' });
  }

  console.log('File uploaded by:', req.user.username, '-', req.file.filename);

  res.json({
    message: 'File uploaded successfully',
    filename: req.file.filename,
    originalName: req.file.originalname,
    size: req.file.size,
    path: req.file.path
  });
});

// Get list of uploaded files
app.get('/files', authenticateToken, (req, res) => {
  fs.readdir(uploadDir, (err, files) => {
    if (err) {
      console.error('Failed to read upload directory:', err);
      return res.status(500).json({ error: 'Failed to read files' });
    }

    // A file can disappear between readdir and stat, so skip unreadable entries
    // rather than throwing inside this callback, which would crash the process.
    const fileList = [];
    for (const filename of files) {
      try {
        const stats = fs.statSync(path.join(uploadDir, filename));
        if (!stats.isFile()) continue;
        fileList.push({ filename, size: stats.size, uploadDate: stats.mtime });
      } catch (statError) {
        console.error(`Skipping ${filename}, failed to stat:`, statError);
      }
    }

    res.json({ files: fileList });
  });
});

// Types that browsers would render in the app's own origin if served inline.
const forceDownloadExtensions = new Set(['.html', '.htm', '.svg', '.xml', '.xhtml', '.js', '.mjs']);

// Serve uploaded files (for thumbnails and previews)
app.use('/uploads', authenticateToken, express.static(uploadDir, {
  dotfiles: 'deny',
  index: false,
  setHeaders: (res, filePath) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    if (forceDownloadExtensions.has(path.extname(filePath).toLowerCase())) {
      res.setHeader('Content-Disposition', 'attachment');
    }
  }
}));

// Download file endpoint
app.get('/download/:filename', (req, res) => {
  const file = resolveUploadedFile(req, res);
  if (!file) return;

  res.download(file.filePath, file.filename);
});

// Delete file endpoint (Admin only)
app.delete('/delete/:filename', authenticateToken, requireAdmin, (req, res) => {
  const file = resolveUploadedFile(req, res);
  if (!file) return;

  const { filename, filePath } = file;

  fs.unlink(filePath, (err) => {
    if (err) {
      console.error('Error deleting file:', err);
      const status = err.code === 'ENOENT' ? 404 : 500;
      return res.status(status).json({
        error: status === 404 ? 'File not found' : 'Failed to delete file'
      });
    }
    
    console.log('File deleted by admin:', req.user.username, '-', path.basename(filePath));
    res.json({ message: 'File deleted successfully', filename: path.basename(filePath) });
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'Server is running' });
});

// Serve the HTML pages
const pages = {
  '/': 'index.html',
  '/login.html': 'login.html',
  '/view.html': 'view.html'
};

for (const [route, page] of Object.entries(pages)) {
  app.get(route, (req, res) => {
    res.sendFile(path.join(__dirname, page));
  });
}

// Unknown routes answer with JSON so clients can always parse the response.
app.use((req, res) => {
  res.status(404).json({ error: `Not found: ${req.method} ${req.path}` });
});

// Central error handler: anything thrown or passed to next(err) lands here
// instead of Express' default HTML error page.
app.use((err, req, res, _next) => {
  console.error(`Unhandled error on ${req.method} ${req.path}:`, err);

  if (res.headersSent) {
    return res.destroy(err);
  }

  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    error: status < 500 ? err.message : 'Internal server error'
  });
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on http://localhost:${PORT}`);
 // console.log(`Local network access: http://${localIp}:${PORT}`);
  console.log(`Open http://localhost:${PORT} in your browser to use the app`);
  console.log(`Upload endpoint: http://localhost:${PORT}/upload`);
  console.log(`Files will be saved to: ${uploadDir}`);
});

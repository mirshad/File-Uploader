const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const os = require('os');

const app = express();
const PORT = 3000;
const JWT_SECRET = 'my-key-12345'; // In production, use a more secure key and store it safely

// Demo users (in production, use a database)
const users = [
  {
    id: 1,
    username: 'admin',
    password: bcrypt.hashSync('admin123', 10),
    role: 'admin'
  },
  {
    id: 2,
    username: 'user',
    password: bcrypt.hashSync('user123', 10),
    role: 'user'
  }
];

// Enable CORS
app.use(cors());

// Parse JSON bodies
app.use(express.json());

// Serve static files (HTML, CSS, JS)
app.use(express.static(path.join(__dirname)));

// Authentication middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

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

// Login endpoint
app.post('/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
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
const uploadDir = '/tmp/uploads';
try {
  fs.mkdirSync(uploadDir, { recursive: true });
} catch (error) {
  console.error(`Failed to create upload directory ${uploadDir}:`, error);
  process.exit(1);
}

// Resolve a client supplied filename to a path inside the upload directory.
// Returns null when the name is empty or escapes the upload directory.
function resolveUploadPath(filename) {
  if (!filename || filename !== path.basename(filename)) {
    return null;
  }

  return path.join(path.resolve(uploadDir), filename);
}

// Configure multer for file storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Create unique filename with timestamp
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.originalname);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// Translate multer failures (size limit, unexpected field, disk errors) into JSON
// responses; they happen in middleware, outside the route handler's reach.
function handleUpload(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (!err) {
      return next();
    }

    if (err instanceof multer.MulterError) {
      const isTooLarge = err.code === 'LIMIT_FILE_SIZE';
      console.error('Upload rejected:', err.code, err.message);
      return res.status(isTooLarge ? 413 : 400).json({
        error: isTooLarge ? 'File is too large. Maximum size is 10MB.' : `Upload rejected: ${err.message}`,
        code: err.code
      });
    }

    next(err);
  });
}

// Upload endpoint
app.post('/upload', authenticateToken, handleUpload, (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
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

// Serve uploaded files (for thumbnails and previews)
app.use('/uploads', express.static(uploadDir));

// Download file endpoint
app.get('/download/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = resolveUploadPath(filename);

  if (!filePath) {
    return res.status(400).json({ error: 'Invalid filename' });
  }

  res.download(filePath, filename, (err) => {
    if (!err) return;

    console.error(`Download failed for ${filename}:`, err);

    if (res.headersSent) {
      // Body already streaming; abort so the client sees a failed transfer.
      return res.destroy(err);
    }

    const status = err.code === 'ENOENT' ? 404 : 500;
    res.status(status).json({
      error: status === 404 ? 'File not found' : 'Failed to download file'
    });
  });
});

// Delete file endpoint (Admin only)
app.delete('/delete/:filename', authenticateToken, requireAdmin, (req, res) => {
  const filename = req.params.filename;
  const filePath = resolveUploadPath(filename);

  if (!filePath) {
    return res.status(400).json({ error: 'Invalid filename' });
  }

  fs.unlink(filePath, (err) => {
    if (err) {
      console.error('Error deleting file:', err);
      const status = err.code === 'ENOENT' ? 404 : 500;
      return res.status(status).json({
        error: status === 404 ? 'File not found' : 'Failed to delete file'
      });
    }
    
    console.log('File deleted by admin:', req.user.username, '-', filename);
    res.json({ message: 'File deleted successfully', filename });
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'Server is running' });
});

// Serve login page
app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

// Serve index.html for root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Serve view.html for file management
app.get('/view.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'view.html'));
});

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
  console.log(`Files will be saved to: ${path.resolve(uploadDir)}`);
});

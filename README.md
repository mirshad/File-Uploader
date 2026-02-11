# File Upload System

A secure, full-featured file upload application with JWT authentication, drag-and-drop interface, and role-based access control (RBAC).

## Features

- **JWT Authentication**: Secure token-based authentication with 24-hour token expiration
- **Drag & Drop Upload**: Intuitive UI for uploading files by dragging and dropping
- **Role-Based Access Control**: Admin and regular user roles with different permissions
- **File Management**: Upload, view, download, and delete files
- **Multi-User Support**: Multiple users can upload files with their own sessions
- **Large File Support**: Supports files up to 10MB
- **Responsive Design**: Modern, mobile-friendly interface
- **Local Network Access**: Access the application from any device on your network
- **File Tracking**: Upload date and file size information for all uploaded files

## Tech Stack

- **Backend**: Node.js with Express.js
- **Frontend**: HTML5, CSS3, with React TypeScript components
- **Authentication**: JWT (JSON Web Tokens) with bcryptjs for password hashing
- **File Upload**: Multer middleware
- **CORS**: Enabled for cross-origin requests

## Project Structure

```
File-Uploader/
├── server.js                # Express server with auth and upload endpoints
├── package.json             # Project dependencies
├── index.html               # Main upload interface
├── login.html               # Login page
├── view.html                # File management/listing page
├── drag-drop-upload.tsx     # React component for drag-drop functionality
├── start-app.bat            # Batch file to start the application
└── uploads/                 # Directory for uploaded files
```

## Installation

1. Clone or download the project
2. Navigate to the project directory
3. Install dependencies:
   ```bash
   npm install
   ```

## Configuration

### Default Credentials

The application comes with two demo users:

| Username | Password  | Role  |
|----------|-----------|-------|
| admin    | admin123  | Admin |
| user     | user123   | User  |

> **Note:** In production, store credentials in a database and use environment variables for secrets.

### Environment Variables

To use in production, set the `JWT_SECRET` environment variable instead of hardcoding it in server.js:

```js
const JWT_SECRET = process.env.JWT_SECRET || 'my-key-12345';
```

## Getting Started

### Start the Server

**Option 1: Using npm**
```bash
npm start
```

**Option 2: Using batch file (Windows)**
```
start-app.bat
```

**Option 3: Using Node directly**
```bash
node server.js
```
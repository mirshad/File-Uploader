import React, { useState, useRef } from 'react';
import { Upload, File, CheckCircle, XCircle, Loader } from 'lucide-react';

export default function FileUploader() {
  const [isDragging, setIsDragging] = useState(false);
  const [files, setFiles] = useState([]);
  const [uploadStatus, setUploadStatus] = useState({});
  const fileInputRef = useRef(null);

  const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const droppedFiles = Array.from(e.dataTransfer.files);
    handleFiles(droppedFiles);
  };

  const handleFileInput = (e) => {
    const selectedFiles = Array.from(e.target.files);
    handleFiles(selectedFiles);
  };

  const handleFiles = (newFiles) => {
    const filesWithId = newFiles.map(file => ({
      file,
      id: Math.random().toString(36).substr(2, 9),
      name: file.name,
      size: file.size
    }));
    
    setFiles(prev => [...prev, ...filesWithId]);
    filesWithId.forEach(fileObj => uploadFile(fileObj));
  };

  const uploadFile = async (fileObj) => {
    setUploadStatus(prev => ({
      ...prev,
      [fileObj.id]: { status: 'uploading', progress: 0 }
    }));

    const formData = new FormData();
    formData.append('file', fileObj.file);

    try {
      const response = await fetch('http://localhost:3000/upload', {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        setUploadStatus(prev => ({
          ...prev,
          [fileObj.id]: { status: 'success', progress: 100 }
        }));
      } else {
        throw new Error('Upload failed');
      }
    } catch (error) {
      setUploadStatus(prev => ({
        ...prev,
        [fileObj.id]: { status: 'error', progress: 0 }
      }));
    }
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const removeFile = (id) => {
    setFiles(prev => prev.filter(f => f.id !== id));
    setUploadStatus(prev => {
      const newStatus = { ...prev };
      delete newStatus[id];
      return newStatus;
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-2xl shadow-xl p-8">
          <h1 className="text-3xl font-bold text-gray-800 mb-2 flex items-center gap-3">
            <Upload className="text-indigo-600" />
            File Upload
          </h1>
          <p className="text-gray-600 mb-8">Drag and drop files or click to browse</p>

          <div
            className={`border-3 border-dashed rounded-xl p-12 text-center transition-all duration-200 cursor-pointer ${
              isDragging
                ? 'border-indigo-500 bg-indigo-50'
                : 'border-gray-300 bg-gray-50 hover:border-indigo-400 hover:bg-indigo-50'
            }`}
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className={`mx-auto mb-4 ${isDragging ? 'text-indigo-600' : 'text-gray-400'}`} size={48} />
            <p className="text-lg font-semibold text-gray-700 mb-2">
              {isDragging ? 'Drop files here' : 'Drag & drop files here'}
            </p>
            <p className="text-sm text-gray-500">or click to browse from your computer</p>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handleFileInput}
              className="hidden"
            />
          </div>

          {files.length > 0 && (
            <div className="mt-8">
              <h2 className="text-xl font-semibold text-gray-800 mb-4">Uploaded Files</h2>
              <div className="space-y-3">
                {files.map((fileObj) => {
                  const status = uploadStatus[fileObj.id];
                  return (
                    <div
                      key={fileObj.id}
                      className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200"
                    >
                      <div className="flex items-center gap-3 flex-1">
                        <File className="text-indigo-600" size={24} />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-800 truncate">{fileObj.name}</p>
                          <p className="text-sm text-gray-500">{formatFileSize(fileObj.size)}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {status?.status === 'uploading' && (
                          <Loader className="text-indigo-600 animate-spin" size={20} />
                        )}
                        {status?.status === 'success' && (
                          <CheckCircle className="text-green-600" size={20} />
                        )}
                        {status?.status === 'error' && (
                          <XCircle className="text-red-600" size={20} />
                        )}
                        <button
                          onClick={() => removeFile(fileObj.id)}
                          className="text-gray-400 hover:text-red-600 transition-colors"
                        >
                          <XCircle size={20} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="mt-6 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <p className="text-sm text-yellow-800">
            <strong>Note:</strong> This demo requires a Node.js backend server running on localhost:3000. 
            See the backend code below to set it up.
          </p>
        </div>
      </div>
    </div>
  );
}
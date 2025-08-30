import { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';

export default function Home() {
  const [file, setFile] = useState(null);
  const [type, setType] = useState('pdf-to-word');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [compressionLevel, setCompressionLevel] = useState('medium');
  const [backendStatus, setBackendStatus] = useState('checking');
  const [mounted, setMounted] = useState(false);

  const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'https://pdftoword-convertore.onrender.com';

  // Enhanced fetch with better error handling and CORS
  const fetchWithRetry = async (url, options = {}, retries = 3) => {
    for (let i = 0; i < retries; i++) {
      try {
        console.log(`🔄 Attempt ${i + 1} - Fetching:`, url);
        
        const response = await fetch(url, {
          ...options,
          mode: 'cors',
          credentials: 'omit', // Remove credentials for CORS
          headers: {
            'Accept': 'application/json',
            ...options.headers,
          },
        });
        
        console.log(`✅ Response status: ${response.status}`);
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        return response;
      } catch (error) {
        console.error(`❌ Attempt ${i + 1} failed:`, error.message);
        
        if (i === retries - 1) {
          throw new Error(`Network request failed after ${retries} attempts: ${error.message}`);
        }
        
        // Wait before retry with exponential backoff
        const delay = Math.min(1000 * Math.pow(2, i), 10000);
        console.log(`⏳ Waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  };

  const tools = [
    { 
      id: 'pdf-to-word', 
      name: 'PDF to Word', 
      desc: 'Convert PDF to editable Word document',
      accept: '.pdf',
      color: 'from-blue-500 to-blue-600'
    },
    { 
      id: 'image-to-pdf', 
      name: 'Image to PDF', 
      desc: 'Convert images to PDF format',
      accept: '.jpg,.jpeg,.png,.gif,.bmp,.webp',
      color: 'from-green-500 to-green-600'
    },
    { 
      id: 'compress-image', 
      name: 'Compress Image', 
      desc: 'Reduce image file size',
      accept: '.jpg,.jpeg,.png,.gif,.bmp,.webp',
      color: 'from-purple-500 to-purple-600'
    },
    { 
      id: 'compress-video', 
      name: 'Compress Video', 
      desc: 'Reduce video file size',
      accept: '.mp4,.avi,.mov,.wmv,.flv,.webm',
      color: 'from-red-500 to-red-600'
    },
    { 
      id: 'compress-pdf', 
      name: 'Compress PDF', 
      desc: 'Reduce PDF file size',
      accept: '.pdf',
      color: 'from-orange-500 to-orange-600'
    }
  ];

  const currentTool = tools.find(tool => tool.id === type);

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && validateFile(droppedFile)) {
      setFile(droppedFile);
      toast.success(`File "${droppedFile.name}" selected!`);
    }
  };

  const validateFile = (file) => {
    const maxSize = 50 * 1024 * 1024; // 50MB
    if (file.size > maxSize) {
      toast.error('File size must be less than 50MB');
      return false;
    }

    const acceptedTypes = currentTool.accept.split(',');
    const fileExtension = '.' + file.name.split('.').pop().toLowerCase();
    
    if (!acceptedTypes.includes(fileExtension)) {
      toast.error(`Please select a valid file type: ${currentTool.accept}`);
      return false;
    }

    return true;
  };

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile && validateFile(selectedFile)) {
      setFile(selectedFile);
      toast.success(`File "${selectedFile.name}" selected!`);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) {
      toast.error('Please select a file first');
      return;
    }

    // Check if backend is connected first
    if (backendStatus !== 'connected') {
      toast.error('Backend is not connected. Please wait for connection.');
      return;
    }

    setLoading(true);
    setResult(null);
    
    const formData = new FormData();
    formData.append('file', file);
    formData.append('type', type);
    formData.append('compressionLevel', compressionLevel);

    const loadingToast = toast.loading('Converting your file...');

    try {
      console.log('🚀 Starting file upload...');
      console.log('📁 File:', file.name, 'Size:', file.size);
      console.log('🔧 Type:', type, 'Compression:', compressionLevel);
      
      const response = await fetchWithRetry(`${API_BASE_URL}/api/convert`, {
        method: 'POST',
        body: formData,
        // Don't set Content-Type header - let browser set it for FormData
      });
      
      const data = await response.json();
      console.log('✅ Conversion response:', data);
      
      setResult(data);
      toast.success('Conversion completed successfully!', { id: loadingToast });
      
    } catch (error) {
      console.error('❌ Upload failed:', error);
      
      let errorMessage = 'Conversion failed';
      
      if (error.message.includes('Failed to fetch')) {
        errorMessage = 'Cannot reach server. Please check if the backend is running.';
      } else if (error.message.includes('NetworkError')) {
        errorMessage = 'Network error. Please check your internet connection.';
      } else if (error.message.includes('CORS')) {
        errorMessage = 'Cross-origin request blocked. Please contact support.';
      } else {
        errorMessage = error.message;
      }
      
      setResult({ error: errorMessage });
      toast.error(errorMessage, { id: loadingToast });
    } finally {
      setLoading(false);
    }
  };

  const downloadFile = async (filename) => {
    try {
      console.log('📥 Downloading:', filename);
      
      const response = await fetchWithRetry(`${API_BASE_URL}/api/download/${filename}`, {
        method: 'GET',
      });
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast.success('File downloaded successfully!');
    } catch (error) {
      console.error('❌ Download failed:', error);
      toast.error('Download failed. Please try again.');
    }
  };

  useEffect(() => {
    // Enhanced backend connection check
    const checkBackend = async () => {
      setBackendStatus('checking');
      
      try {
        console.log('🔍 Checking backend health...');
        
        const response = await fetch(`${API_BASE_URL}/health`, {
          method: 'GET',
          mode: 'cors',
          credentials: 'omit',
          headers: {
            'Accept': 'application/json',
          },
        });
        
        if (response.ok) {
          const data = await response.json();
          console.log('✅ Backend healthy:', data);
          setBackendStatus('connected');
        } else {
          throw new Error(`Backend returned ${response.status}`);
        }
      } catch (error) {
        console.error('❌ Backend check failed:', error);
        setBackendStatus('error');
      }
    };
    
    // Only run on client side
    if (typeof window !== 'undefined') {
      checkBackend();
      
      // Retry every 15 seconds if failed
      const interval = setInterval(() => {
        if (backendStatus === 'error') {
          console.log('🔄 Retrying backend connection...');
          checkBackend();
        }
      }, 15000);
      
      return () => clearInterval(interval);
    }
  }, []); // Remove backendStatus from dependency array to avoid infinite loop

  // Add test connection function
  const testConnection = async () => {
    if (typeof window === 'undefined') return; // Prevent SSR issues
    
    try {
      toast.loading('Testing connection...');
      
      const response = await fetch(`${API_BASE_URL}/api/test`, {
        method: 'GET',
        mode: 'cors',
        credentials: 'omit',
      });
      
      if (response.ok) {
        const data = await response.json();
        toast.success('Connection test successful!');
        console.log('✅ Test response:', data);
      } else {
        toast.error(`Test failed: ${response.status}`);
      }
    } catch (error) {
      toast.error(`Test failed: ${error.message}`);
      console.error('❌ Test failed:', error);
    }
  };

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900 transition-all duration-500">
      <Toaster position="top-right" />
      
      {/* Header */}
      <header className="bg-white/10 backdrop-blur-sm border-b border-white/20 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-gradient-to-r from-blue-500 to-purple-600 rounded-xl flex items-center justify-center">
                <span className="text-white font-bold">📄</span>
              </div>
              <div>
                <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                  PDF Tools Pro
                </h1>
                <p className="text-sm text-gray-600 dark:text-gray-400">Professional file conversion suite</p>
              </div>
            </div>
            
            <div className="flex items-center space-x-2">
              <div className={`w-2 h-2 rounded-full ${
                backendStatus === 'connected' ? 'bg-green-500' : 
                backendStatus === 'error' ? 'bg-red-500' : 'bg-yellow-500'
              }`}></div>
              <span className="text-xs text-gray-500">
                {backendStatus === 'connected' ? 'Online' : 
                 backendStatus === 'error' ? 'Offline' : 'Connecting...'}
              </span>
            </div>

            <button
              onClick={() => setDarkMode(!darkMode)}
              className="p-3 rounded-xl bg-white/10 hover:bg-white/20 dark:bg-black/10 dark:hover:bg-black/20 transition-all duration-200 backdrop-blur-sm border border-white/20"
            >
              {darkMode ? '☀️' : '🌙'}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Tool Selection */}
        <div className="mb-8">
          <h2 className="text-xl font-semibold mb-4 text-gray-800 dark:text-gray-200">Choose Your Tool</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
            {tools.map((tool) => (
              <button
                key={tool.id}
                onClick={() => {
                  setType(tool.id);
                  setFile(null);
                  setResult(null);
                }}
                className={`p-4 rounded-2xl border-2 transition-all duration-300 hover:scale-105 ${
                  type === tool.id
                    ? 'border-blue-500 bg-gradient-to-r ' + tool.color + ' text-white shadow-lg'
                    : 'border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-gray-800/50 hover:border-blue-300 dark:hover:border-blue-600'
                }`}
              >
                <div className={`text-2xl mb-2 ${type === tool.id ? 'text-white' : 'text-gray-600 dark:text-gray-400'}`}>
                  {tool.id === 'pdf-to-word' && '📄'}
                  {tool.id === 'image-to-pdf' && '🖼️'}
                  {tool.id === 'compress-image' && '🗜️'}
                  {tool.id === 'compress-video' && '🎥'}
                  {tool.id === 'compress-pdf' && '📋'}
                </div>
                <h3 className={`font-medium text-sm ${type === tool.id ? 'text-white' : 'text-gray-800 dark:text-gray-200'}`}>
                  {tool.name}
                </h3>
                <p className={`text-xs mt-1 ${type === tool.id ? 'text-white/80' : 'text-gray-500 dark:text-gray-400'}`}>
                  {tool.desc}
                </p>
              </button>
            ))}
          </div>
        </div>

        {(type === 'compress-image' || type === 'compress-video' || type === 'compress-pdf') && (
          <div className="mb-6">
            <h3 className="text-lg font-semibold mb-3 text-gray-800 dark:text-gray-200">
              Choose Compression Level
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {['low', 'medium', 'high'].map((level) => (
                <button
                  key={level}
                  onClick={() => setCompressionLevel(level)}
                  className={`p-4 rounded-xl border-2 transition-all duration-200 ${
                    compressionLevel === level
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                      : 'border-gray-200 dark:border-gray-700 hover:border-blue-300'
                  }`}
                >
                  <div className="text-center">
                    <div className="text-lg mb-1">
                      {level === 'low' && '🗜️'}
                      {level === 'medium' && '⚖️'}
                      {level === 'high' && '✨'}
                    </div>
                    <h4 className="font-medium capitalize text-gray-800 dark:text-gray-200">
                      {level} Quality
                    </h4>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {level === 'low' && 'Smallest file size'}
                      {level === 'medium' && 'Balanced quality & size'}
                      {level === 'high' && 'Best quality'}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* File Upload */}
        <div className="grid lg:grid-cols-2 gap-8">
          <div>
            <div className="bg-white/10 backdrop-blur-sm rounded-3xl p-8 border border-white/20">
              <h3 className="text-lg font-semibold mb-4 text-gray-800 dark:text-gray-200">Upload File</h3>
              
              <div
                className={`border-2 border-dashed rounded-2xl p-8 text-center transition-all duration-300 ${
                  dragActive
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                    : 'border-gray-300 dark:border-gray-600 hover:border-blue-400 dark:hover:border-blue-500'
                }`}
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
              >
                <div className="text-4xl mb-4">📤</div>
                <p className="text-lg font-medium mb-2 text-gray-700 dark:text-gray-300">
                  Drop your file here or click to browse
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                  Accepted formats: {currentTool.accept}
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">
                  Maximum file size: 50MB
                </p>
                
                <input
                  type="file"
                  onChange={handleFileChange}
                  accept={currentTool.accept}
                  className="hidden"
                  id="file-upload"
                />
                <label
                  htmlFor="file-upload"
                  className="inline-flex items-center px-6 py-3 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-xl hover:from-blue-600 hover:to-blue-700 transition-all duration-200 cursor-pointer font-medium"
                >
                  Select File
                </label>
              </div>

              {file && (
                <div className="mt-4 p-4 bg-green-50 dark:bg-green-900/20 rounded-xl border border-green-200 dark:border-green-800">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <span className="text-green-500">✅</span>
                      <div>
                        <p className="font-medium text-green-800 dark:text-green-200">{file.name}</p>
                        <p className="text-sm text-green-600 dark:text-green-400">
                          {(file.size / 1024 / 1024).toFixed(2)} MB
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => setFile(null)}
                      className="p-1 hover:bg-green-200 dark:hover:bg-green-800 rounded-lg transition-colors"
                    >
                      <span className="text-green-600 dark:text-green-400">❌</span>
                    </button>
                  </div>
                </div>
              )}

              <button
                onClick={handleSubmit}
                disabled={!file || loading}
                className="w-full mt-6 py-4 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-xl font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:from-blue-600 hover:to-purple-700 transition-all duration-200 flex items-center justify-center space-x-2"
              >
                {loading ? (
                  <>
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                    <span>Converting...</span>
                  </>
                ) : (
                  <span>Convert File</span>
                )}
              </button>
            </div>
          </div>

          {/* Results */}
          <div>
            <div className="bg-white/10 backdrop-blur-sm rounded-3xl p-8 border border-white/20">
              <h3 className="text-lg font-semibold mb-4 text-gray-800 dark:text-gray-200">Results</h3>
              
              {!result && !loading && (
                <div className="text-center py-12">
                  <div className="text-4xl mb-4">📥</div>
                  <p className="text-gray-500 dark:text-gray-400">Your converted file will appear here</p>
                </div>
              )}

              {loading && (
                <div className="text-center py-12">
                  <div className="animate-pulse">
                    <div className="text-4xl mb-4">⏳</div>
                    <p className="text-blue-600 dark:text-blue-400 font-medium">Processing your file...</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">This may take a few moments</p>
                  </div>
                </div>
              )}

              {result && result.error && (
                <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-xl border border-red-200 dark:border-red-800">
                  <div className="flex items-center space-x-3">
                    <span className="text-red-500">⚠️</span>
                    <div>
                      <p className="font-medium text-red-800 dark:text-red-200">Conversion Failed</p>
                      <p className="text-sm text-red-600 dark:text-red-400">{result.error}</p>
                    </div>
                  </div>
                </div>
              )}

              {result && (
                <div className="mt-6 p-6 bg-white dark:bg-slate-800 rounded-2xl shadow-lg border border-slate-200 dark:border-slate-700">
                  <div className="text-center">
                    <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                      <span className="text-2xl">✅</span>
                    </div>
                    
                    <h3 className="text-xl font-bold text-slate-800 dark:text-slate-200 mb-2">
                      Conversion Successful!
                    </h3>
                    
                    <div className="space-y-2 text-sm text-slate-600 dark:text-slate-400 mb-6">
                      <p><strong>Original:</strong> {result.originalName}</p>
                      <p><strong>Type:</strong> {result.message}</p>
                      {result.compressionLevel && (
                        <p><strong>Quality:</strong> {result.compressionLevel} compression</p>
                      )}
                    </div>
                    
                    <button
                      onClick={() => downloadFile(result.filename)}
                      className="w-full py-3 bg-gradient-to-r from-green-500 to-green-600 text-white rounded-xl font-medium hover:from-green-600 hover:to-green-700 transition-all duration-200 flex items-center justify-center space-x-2"
                    >
                      <span>📥</span>
                      <span>Download Converted File</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

// Add client-side only rendering for status check
const [mounted, setMounted] = useState(false);

useEffect(() => {
  setMounted(true);
}, []);

// Render status only after component is mounted
{mounted && (
  <div className="mb-6 p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
    <div className="flex items-center justify-between">
      <div className="flex items-center space-x-3">
        <div className={`w-3 h-3 rounded-full ${
          backendStatus === 'connected' ? 'bg-green-500 animate-pulse' : 
          backendStatus === 'error' ? 'bg-red-500' : 'bg-yellow-500 animate-pulse'
        }`}></div>
        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
          Backend: {
            backendStatus === 'connected' ? 'Connected ✅' : 
            backendStatus === 'error' ? 'Disconnected ❌' : 'Connecting... ⏳'
          }
        </span>
      </div>
      
      <div className="flex space-x-2">
        <button
          onClick={testConnection}
          className="px-3 py-1 text-xs bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
        >
          Test
        </button>
        <button
          onClick={() => window.location.reload()}
          className="px-3 py-1 text-xs bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors"
        >
          Refresh
        </button>
      </div>
    </div>
    
    <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
      Server: {API_BASE_URL}
    </div>
  </div>
)}}




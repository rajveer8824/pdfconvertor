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

  useEffect(() => {
    setMounted(true);
  }, []);

  const fetchWithRetry = async (url, options = {}, retries = 3) => {
    for (let i = 0; i < retries; i++) {
      try {
        console.log(`🔄 Attempt ${i + 1} - Fetching:`, url);
        
        const response = await fetch(url, {
          ...options,
          mode: 'cors',
          credentials: 'omit',
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
        
        const delay = Math.min(1000 * Math.pow(2, i), 10000);
        console.log(`⏳ Waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  };

  const testConnection = async () => {
    if (typeof window === 'undefined') return;
    
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

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) {
      toast.error('Please select a file first');
      return;
    }

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
    
    if (typeof window !== 'undefined') {
      checkBackend();
      
      const interval = setInterval(() => {
        if (backendStatus === 'error') {
          console.log('🔄 Retrying backend connection...');
          checkBackend();
        }
      }, 15000);
      
      return () => clearInterval(interval);
    }
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-4">
              PDF Converter
            </h1>
            <p className="text-lg text-gray-600 dark:text-gray-300">
              Convert your PDF files to Word documents quickly and easily
            </p>
          </div>

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
          )}

          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8">
            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Select File
                </label>
                <input
                  type="file"
                  accept=".pdf"
                  onChange={(e) => setFile(e.target.files[0])}
                  className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Conversion Type
                </label>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                  className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                >
                  <option value="pdf-to-word">PDF to Word</option>
                  <option value="pdf-to-excel">PDF to Excel</option>
                  <option value="pdf-to-powerpoint">PDF to PowerPoint</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Compression Level
                </label>
                <select
                  value={compressionLevel}
                  onChange={(e) => setCompressionLevel(e.target.value)}
                  className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>

              <button
                type="submit"
                disabled={loading || !file || backendStatus !== 'connected'}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-semibold py-3 px-6 rounded-lg transition-colors duration-200"
              >
                {loading ? 'Converting...' : 'Convert File'}
              </button>
            </form>

            {result && (
              <div className="mt-8 p-6 bg-gray-50 dark:bg-gray-700 rounded-lg">
                {result.error ? (
                  <div className="text-red-600 dark:text-red-400">
                    <h3 className="font-semibold mb-2">Error:</h3>
                    <p>{result.error}</p>
                  </div>
                ) : (
                  <div className="text-green-600 dark:text-green-400">
                    <h3 className="font-semibold mb-2">Conversion Successful!</h3>
                    <p className="mb-4">Your file has been converted successfully.</p>
                    {result.filename && (
                      <button
                        onClick={() => downloadFile(result.filename)}
                        className="bg-green-600 hover:bg-green-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors duration-200"
                      >
                        Download Converted File
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}


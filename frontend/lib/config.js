// lib/config.js
export const getApiBaseUrl = () => {
  // For client-side components
  if (typeof window !== 'undefined') {
    return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
  }
  // For server-side components
  return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
};
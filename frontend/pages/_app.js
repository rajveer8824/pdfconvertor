import React from 'react';
import "@/styles/globals.css";
import { Toaster } from 'react-hot-toast';

function MyApp({ Component, pageProps }) {
  return React.createElement(
    React.Fragment,
    null,
    React.createElement(Component, pageProps),
    React.createElement(Toaster, {
      position: "top-right",
      toastOptions: {
        duration: 4000,
        style: {
          background: '#363636',
          color: '#fff',
        },
      }
    })
  );
}

export default MyApp;


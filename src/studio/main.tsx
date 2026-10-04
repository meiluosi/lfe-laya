import React from 'react';
import { createRoot } from 'react-dom/client';
import Studio from './Studio';
import './studio.css';
createRoot(document.getElementById('root')!).render(<React.StrictMode><Studio/></React.StrictMode>);

import React from 'react';
import { Route, Routes } from 'react-router-dom';
import RouterPage from './pages/router/RouterPage';
import NotFound from './pages/NotFound/NotFound';
const RoutesComponent: React.FC = () => <Routes><Route index element={<RouterPage />} />
  <Route path="*" element={<NotFound />} /></Routes>;
export default RoutesComponent;

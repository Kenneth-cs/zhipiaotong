/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout";
import Workspace from "./pages/Workspace";
import History from "./pages/History";
import Login from "./pages/Login";
import { getToken } from "./lib/api";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  if (!getToken()) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="/workspace" replace />} />
          <Route path="workspace" element={<Workspace />} />
          <Route path="history" element={<History />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import App from "./App.jsx";
import LoginPage, { AppAuthGate } from "./pages/LoginPage.jsx";
import AdminLoginPage from "./admin/AdminLoginPage.jsx";
import AdminGate from "./admin/AdminGate.jsx";
import AdminDashboardPage from "./admin/AdminDashboardPage.jsx";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/admin/login" element={<AdminLoginPage />} />
        <Route
          path="/admin/*"
          element={
            <AdminGate>
              <AdminDashboardPage />
            </AdminGate>
          }
        />
        <Route
          path="/*"
          element={
            <AppAuthGate>
              <App />
            </AppAuthGate>
          }
        />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);

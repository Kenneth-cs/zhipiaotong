import React from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  History,
  CloudUpload,
  Settings,
  HelpCircle,
  Search,
  Bell,
  LogOut,
} from "lucide-react";
import { cn } from "../lib/utils";
import { getUser, logout } from "../lib/api";

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const user = getUser();

  const handleLogout = () => {
    logout();
  };

  return (
    <div className="min-h-screen bg-[#F8F9FB] flex font-sans">
      {/* Sidebar */}
      <aside className="w-64 bg-[#F8FAFC] border-r border-slate-200/50 flex flex-col fixed h-full z-20">
        {/* Logo */}
        <div className="p-4 flex items-center gap-3 mt-2">
          <div className="w-8 h-8 bg-[#0052D9] rounded-md flex items-center justify-center text-white font-bold text-lg">
            A
          </div>
          <div>
            <div className="font-black text-[#1E3A8A] text-lg leading-tight">
              智票通
            </div>
            <div className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">
              精准发票管理
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-4 py-6 space-y-2">
          <Link
            to="/workspace"
            className={cn(
              "flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors",
              location.pathname.includes("workspace")
                ? "bg-white text-[#1D4ED8] shadow-sm"
                : "text-slate-500 hover:bg-slate-100",
            )}
          >
            <LayoutDashboard className="w-5 h-5" /> 工作台
          </Link>
          <Link
            to="/history"
            className={cn(
              "flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors",
              location.pathname.includes("history")
                ? "bg-white text-[#1D4ED8] shadow-sm"
                : "text-slate-500 hover:bg-slate-100",
            )}
          >
            <History className="w-5 h-5" /> 发票历史
          </Link>
        </nav>

        {/* Bottom */}
        <div className="p-4 border-t border-slate-200/50 space-y-2">
          <button className="w-full bg-gradient-to-br from-[#003DA6] to-[#0052D9] text-white rounded-lg py-3 font-bold shadow-md flex items-center justify-center gap-2 mb-4 hover:opacity-90 transition-opacity">
            <CloudUpload className="w-5 h-5" /> 上传发票
          </button>
          <Link
            to="/settings"
            className="flex items-center gap-3 px-4 py-2 rounded-lg text-sm font-medium text-slate-500 hover:bg-slate-100"
          >
            <Settings className="w-5 h-5" /> 设置
          </Link>
          <Link
            to="/help"
            className="flex items-center gap-3 px-4 py-2 rounded-lg text-sm font-medium text-slate-500 hover:bg-slate-100"
          >
            <HelpCircle className="w-5 h-5" /> 帮助
          </Link>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 ml-64 flex flex-col min-h-screen">
        {/* Header */}
        <header className="h-16 bg-white/80 backdrop-blur-md border-b border-slate-200/50 flex items-center px-8 justify-between sticky top-0 z-10">
          <div className="flex items-center gap-8 h-full">
            <h1 className="text-xl font-bold text-[#1E40AF]">
              {location.pathname.includes("workspace") ? "工作台" : "发票历史"}
            </h1>
            <nav className="flex gap-6 h-full items-center">
              <Link
                to="/workspace"
                className={cn(
                  "text-sm font-semibold h-full flex items-center border-b-2 transition-colors",
                  location.pathname.includes("workspace")
                    ? "text-[#1D4ED8] border-[#1D4ED8]"
                    : "text-slate-600 border-transparent hover:text-slate-800",
                )}
              >
                工作台
              </Link>
              <Link
                to="/history"
                className={cn(
                  "text-sm font-semibold h-full flex items-center border-b-2 transition-colors",
                  location.pathname.includes("history")
                    ? "text-[#1D4ED8] border-[#1D4ED8]"
                    : "text-slate-600 border-transparent hover:text-slate-800",
                )}
              >
                发票历史
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-6">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
              <input
                className="bg-[#F3F4F6] rounded-xl pl-9 pr-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 w-64 text-slate-600 transition-all"
                placeholder="搜索关键词..."
              />
            </div>
            <Bell className="text-slate-500 w-5 h-5 cursor-pointer hover:text-slate-700 transition-colors" />
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-[#0052D9] flex items-center justify-center text-white text-sm font-bold">
                {user?.nickname?.charAt(0) || 'U'}
              </div>
              <span className="text-sm text-slate-600 font-medium hidden lg:block">
                {user?.nickname || '用户'}
              </span>
              <button
                onClick={handleLogout}
                className="text-slate-400 hover:text-red-500 transition-colors"
                title="退出登录"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <div className="flex-1 p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

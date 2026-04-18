import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Phone, Lock, User, Eye, EyeOff } from 'lucide-react';
import { apiLogin, apiRegister } from '../lib/api';

export default function Login() {
  const navigate = useNavigate();
  const [isRegister, setIsRegister] = useState(false);
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isRegister) {
        await apiRegister(phone, password, nickname);
      } else {
        await apiLogin(phone, password);
      }
      navigate('/workspace');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#EFF6FF] via-white to-[#F0F9FF] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-4">
            <div className="w-12 h-12 bg-[#0052D9] rounded-xl flex items-center justify-center shadow-lg shadow-blue-200">
              <FileText className="w-6 h-6 text-white" />
            </div>
            <div className="text-left">
              <div className="font-black text-[#1E3A8A] text-2xl leading-tight">智票通</div>
              <div className="text-xs text-slate-500 font-medium uppercase tracking-wider">精准发票管理</div>
            </div>
          </div>
          <p className="text-slate-500 text-sm">
            {isRegister ? '创建账户，开始智能发票管理' : '登录您的账户'}
          </p>
        </div>

        {/* Form Card */}
        <div className="bg-white rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-100 p-8">
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Phone */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">手机号</label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="请输入手机号"
                  maxLength={11}
                  className="w-full pl-11 pr-4 py-3 bg-[#F8FAFC] border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                  required
                />
              </div>
            </div>

            {/* Nickname (register only) */}
            {isRegister && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">昵称 <span className="text-slate-400">(选填)</span></label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <input
                    type="text"
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    placeholder="给自己取个名字"
                    className="w-full pl-11 pr-4 py-3 bg-[#F8FAFC] border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                  />
                </div>
              </div>
            )}

            {/* Password */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">密码</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={isRegister ? '设置密码（至少6位）' : '请输入密码'}
                  minLength={6}
                  className="w-full pl-11 pr-12 py-3 bg-[#F8FAFC] border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-gradient-to-r from-[#1D4ED8] to-[#3B82F6] text-white rounded-xl font-bold shadow-lg shadow-blue-500/25 hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  {isRegister ? '注册中...' : '登录中...'}
                </span>
              ) : (
                isRegister ? '注册' : '登录'
              )}
            </button>
          </form>

          {/* Toggle */}
          <div className="mt-6 text-center text-sm text-slate-500">
            {isRegister ? (
              <span>
                已有账户？{' '}
                <button
                  onClick={() => { setIsRegister(false); setError(''); }}
                  className="text-[#1D4ED8] font-semibold hover:underline"
                >
                  立即登录
                </button>
              </span>
            ) : (
              <span>
                没有账户？{' '}
                <button
                  onClick={() => { setIsRegister(true); setError(''); }}
                  className="text-[#1D4ED8] font-semibold hover:underline"
                >
                  免费注册
                </button>
              </span>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="text-center mt-6 text-xs text-slate-400">
          智票通 © 2024 · 精准发票管理系统
        </div>
      </div>
    </div>
  );
}
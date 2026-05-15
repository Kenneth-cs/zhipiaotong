import React, { useState } from 'react';
import { X, Gift, Loader2, AlertTriangle } from 'lucide-react';
import { apiRedeemCode } from '../lib/api';

interface QuotaDialogProps {
  open: boolean;
  onClose: () => void;
  onRedeemed: () => void;
  reason?: 'daily_limit' | 'balance' | 'insufficient';
}

export default function QuotaDialog({ open, onClose, onRedeemed, reason = 'daily_limit' }: QuotaDialogProps) {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  if (!open) return null;

  const handleRedeem = async () => {
    if (!code.trim()) {
      setError('请输入兑换码');
      return;
    }
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      const res = await apiRedeemCode(code.trim());
      setSuccess(res.message);
      setCode('');
      onRedeemed();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setCode('');
    setError('');
    setSuccess('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-[#1D4ED8] to-[#3B82F6] p-6 text-white relative">
          <button
            onClick={handleClose}
            className="absolute top-4 right-4 text-white/70 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold">
                {reason === 'daily_limit' && '今日免费张数已用完'}
                {reason === 'balance' && '识别余额不足'}
                {reason === 'insufficient' && '本次批量识别张数不足'}
              </h3>
              <p className="text-blue-100 text-sm">使用兑换码获取更多识别张数</p>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">兑换码</label>
            <div className="flex gap-2">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => { if (e.key === 'Enter') handleRedeem(); }}
                placeholder="XCQ-XXXX-XXXX-XXXX"
                className="flex-1 px-4 py-3 bg-[#F8FAFC] border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all font-mono tracking-wider"
              />
              <button
                onClick={handleRedeem}
                disabled={loading}
                className="px-5 py-3 bg-[#0052D9] text-white rounded-xl font-bold hover:bg-[#003DA6] transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Gift className="w-4 h-4" />}
                兑换
              </button>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">
              {error}
            </div>
          )}

          {success && (
            <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-sm text-green-600">
              {success}
            </div>
          )}

          <p className="text-xs text-slate-400 text-center">
            每日可免费识别 5 张，兑换码可获得额外识别张数
          </p>
        </div>
      </div>
    </div>
  );
}
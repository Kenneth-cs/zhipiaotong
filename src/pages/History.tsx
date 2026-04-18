import React, { useState, useEffect, useCallback } from "react";
import { Search, Calendar, Filter, Download, Trash2, Eye, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { formatCurrency } from "../lib/utils";
import { apiGetInvoices, apiBatchDeleteInvoices, apiExportInvoices } from "../lib/api";
import * as XLSX from "xlsx";

export default function History() {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 20, total: 0, totalPages: 0 });
  const [summary, setSummary] = useState({ totalCount: 0, duplicateCount: 0, normalCount: 0, totalAmount: 0 });
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateRange, setDateRange] = useState('30d');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchInvoices = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const res = await apiGetInvoices({
        page,
        pageSize: pagination.pageSize,
        keyword: keyword || undefined,
        status: statusFilter || undefined,
        dateRange: dateRange || undefined,
      });
      setInvoices(res.data);
      setPagination(res.pagination);
      setSummary(res.summary);
      setSelectedIds([]);
    } catch (err: any) {
      console.error('获取发票列表失败:', err);
    } finally {
      setLoading(false);
    }
  }, [keyword, statusFilter, dateRange, pagination.pageSize]);

  useEffect(() => {
    fetchInvoices(1);
  }, [statusFilter, dateRange]);

  const handleSearch = () => {
    fetchInvoices(1);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === invoices.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(invoices.map((inv) => inv.id));
    }
  };

  const handleBatchDelete = async () => {
    if (selectedIds.length === 0) return;
    if (!confirm(`确认删除 ${selectedIds.length} 条发票记录？`)) return;
    try {
      await apiBatchDeleteInvoices(selectedIds);
      fetchInvoices(pagination.page);
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleExport = async () => {
    try {
      const res = await apiExportInvoices(selectedIds.length > 0 ? selectedIds : undefined);
      const exportData = res.data.map((row: any, i: number) => ({
        '序号': i + 1,
        '发票代码': row.invoice_code || '',
        '发票号码': row.invoice_number || '',
        '开票日期': row.invoice_date || '',
        '金额': row.amount || 0,
        '税额': row.tax || 0,
        '价税合计': row.total || 0,
        '销售方': row.seller_name || '',
        '购买方': row.buyer_name || '',
        '纳税人识别号': row.tax_id || '',
        '状态': row.status === 'duplicate' ? '重复' : '正常',
      }));
      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '发票统计');
      XLSX.writeFile(wb, `发票统计_${new Date().toLocaleDateString()}.xlsx`);
    } catch (err: any) {
      alert(err.message);
    }
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 mb-2">发票存档</h2>
          <p className="text-slate-500">
            查看和管理所有历史处理的发票，包含精确的审计日志。
          </p>
        </div>
        <div className="flex gap-3">
          <button className="px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg font-medium shadow-sm hover:bg-slate-50 flex items-center gap-2 transition-colors">
            <Download className="w-4 h-4" /> 导出选中到 Excel
          </button>
          <button className="px-4 py-2 bg-red-50 text-red-600 rounded-lg font-medium hover:bg-red-100 flex items-center gap-2 transition-colors">
            <Trash2 className="w-4 h-4" /> 删除选中
          </button>
        </div>
      </div>

      <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 flex gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-full bg-[#F8FAFC] rounded-lg pl-9 pr-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all"
            placeholder="发票号, 销售方, 金额..."
          />
        </div>
        <div className="w-64 relative">
          <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
          <select
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value)}
            className="w-full bg-[#F8FAFC] rounded-lg pl-9 pr-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 appearance-none transition-all"
          >
            <option value="30d">最近 30 天</option>
            <option value="90d">最近 3 个月</option>
            <option value="1y">今年</option>
            <option value="">全部时间</option>
          </select>
        </div>
        <div className="flex bg-[#F8FAFC] rounded-lg p-1">
          {['', 'normal', 'duplicate'].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                statusFilter === s
                  ? 'bg-white shadow-sm text-slate-800'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {s === '' ? '全部' : s === 'normal' ? '正常' : '重复'}
            </button>
          ))}
        </div>
        <button
          onClick={handleSearch}
          className="px-4 py-2.5 bg-[#0052D9] text-white rounded-lg text-sm font-medium hover:bg-[#003DA6] flex items-center gap-2 transition-colors"
        >
          <Search className="w-4 h-4" /> 搜索
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-[#0052D9] animate-spin" />
            <span className="ml-3 text-slate-500">加载中...</span>
          </div>
        ) : invoices.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400">
            <Search className="w-12 h-12 mb-4 text-slate-300" />
            <p className="text-lg font-medium">暂无发票记录</p>
            <p className="text-sm mt-1">去工作台上传发票开始识别吧</p>
          </div>
        ) : (
          <>
            <table className="w-full text-left text-sm">
              <thead className="bg-[#F8FAFC] border-b border-slate-100">
                <tr className="text-slate-500 font-bold">
                  <th className="py-4 px-6 w-12">
                    <input
                      type="checkbox"
                      className="rounded border-slate-300"
                      checked={selectedIds.length === invoices.length && invoices.length > 0}
                      onChange={toggleSelectAll}
                    />
                  </th>
                  <th className="py-4 px-6">发票号码</th>
                  <th className="py-4 px-6">处理日期</th>
                  <th className="py-4 px-6">销售方名称</th>
                  <th className="py-4 px-6">纳税人识别号</th>
                  <th className="py-4 px-6 text-right">金额</th>
                  <th className="py-4 px-6">状态</th>
                  <th className="py-4 px-6 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {invoices.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-4 px-6">
                      <input
                        type="checkbox"
                        className="rounded border-slate-300"
                        checked={selectedIds.includes(item.id)}
                        onChange={() => toggleSelect(item.id)}
                      />
                    </td>
                    <td className="py-4 px-6 font-medium text-slate-800">
                      {item.invoice_number || '-'}
                    </td>
                    <td className="py-4 px-6 text-slate-500">{formatDate(item.created_at)}</td>
                    <td className="py-4 px-6 text-slate-800">{item.seller_name || '-'}</td>
                    <td className="py-4 px-6 text-slate-400 font-mono text-xs">{item.tax_id || '-'}</td>
                    <td className="py-4 px-6 text-slate-800 font-bold text-right">
                      {formatCurrency(parseFloat(item.total) || 0)}
                    </td>
                    <td className="py-4 px-6">
                      {item.status === 'normal' ? (
                        <span className="bg-[#2563EB] text-white px-2 py-1 rounded text-xs font-bold">
                          正常
                        </span>
                      ) : (
                        <span className="bg-[#FEF2F2] text-[#DC2626] border border-[#FECACA] px-2 py-1 rounded text-xs font-bold">
                          重复
                        </span>
                      )}
                    </td>
                    <td className="py-4 px-6 text-right">
                      <div className="flex items-center justify-end gap-3 text-slate-400">
                        <button className="hover:text-blue-600 transition-colors" title="查看详情">
                          <Eye className="w-4 h-4" />
                        </button>
                        <button className="hover:text-blue-600 transition-colors" title="下载">
                          <Download className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="p-4 border-t border-slate-100 flex items-center justify-between text-sm text-slate-500">
              <span>显示 {(pagination.page - 1) * pagination.pageSize + 1} 至 {Math.min(pagination.page * pagination.pageSize, pagination.total)} 条，共 {pagination.total} 条</span>
              <div className="flex gap-1">
                <button
                  onClick={() => fetchInvoices(pagination.page - 1)}
                  disabled={pagination.page <= 1}
                  className="w-8 h-8 flex items-center justify-center rounded hover:bg-slate-100 transition-colors disabled:opacity-30"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                {Array.from({ length: Math.min(5, pagination.totalPages) }, (_, i) => {
                  let pageNum: number;
                  if (pagination.totalPages <= 5) {
                    pageNum = i + 1;
                  } else if (pagination.page <= 3) {
                    pageNum = i + 1;
                  } else if (pagination.page >= pagination.totalPages - 2) {
                    pageNum = pagination.totalPages - 4 + i;
                  } else {
                    pageNum = pagination.page - 2 + i;
                  }
                  return (
                    <button
                      key={pageNum}
                      onClick={() => fetchInvoices(pageNum)}
                      className={`w-8 h-8 flex items-center justify-center rounded font-medium transition-colors ${
                        pagination.page === pageNum
                          ? 'bg-blue-600 text-white'
                          : 'hover:bg-slate-100'
                      }`}
                    >
                      {pageNum}
                    </button>
                  );
                })}
                <button
                  onClick={() => fetchInvoices(pagination.page + 1)}
                  disabled={pagination.page >= pagination.totalPages}
                  className="w-8 h-8 flex items-center justify-center rounded hover:bg-slate-100 transition-colors disabled:opacity-30"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

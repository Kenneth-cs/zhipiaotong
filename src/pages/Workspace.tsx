import React, { useState, useCallback, useEffect, useRef } from "react";
import { useDropzone } from "react-dropzone";
import {
  UploadCloud,
  MoreHorizontal,
  XCircle,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  FileText,
  ArrowLeft,
  Download,
  StopCircle,
  RotateCcw,
} from "lucide-react";
import { cn, formatCurrency } from "../lib/utils";
import { FileStatus, InvoiceFile, InvoiceData } from "../types";
import { apiRecognizeInvoice } from "../lib/api";
import { TaskQueue } from "../lib/queue";
import * as XLSX from "xlsx";

export default function Workspace() {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [files, setFiles] = useState<InvoiceFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const newFiles = acceptedFiles.map((f) => ({
      id: Math.random().toString(36).substring(7),
      file: f,
      progress: 0,
      status: "uploading" as FileStatus,
    }));
    setFiles((prev) => [...prev, ...newFiles]);
    setIsUploading(true);

    newFiles.forEach((f) => {
      let progress = 0;
      const interval = setInterval(() => {
        progress += Math.random() * 30;
        if (progress >= 100) {
          progress = 100;
          clearInterval(interval);
          setFiles((prev) =>
            prev.map((pf) =>
              pf.id === f.id ? { ...pf, progress: 100, status: "pending" } : pf,
            ),
          );
        } else {
          setFiles((prev) =>
            prev.map((pf) => (pf.id === f.id ? { ...pf, progress } : pf)),
          );
        }
      }, 300);
    });
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "image/jpeg": [".jpg", ".jpeg"],
      "image/png": [".png"],
      "application/pdf": [".pdf"],
    },
  } as any);

  useEffect(() => {
    if (
      isUploading &&
      files.length > 0 &&
      files.every((f) => f.status !== "uploading")
    ) {
      setIsUploading(false);
    }
  }, [files, isUploading]);

  // 并发队列引用
  const queueRef = useRef<TaskQueue<any> | null>(null);
  const [recognizeProgress, setRecognizeProgress] = useState({ completed: 0, total: 0 });
  const [batchId] = useState(() => `batch_${Date.now()}_${Math.random().toString(36).substring(7)}`);

  const handleConfirmAndRecognize = () => {
    // 必须在 setFiles 之前先捕获待处理文件列表
    // 因为 setFiles 是异步的，直接在后面读 files 拿到的还是旧状态
    const pendingFiles = files.filter((f) => f.status === "pending");

    setStep(2);
    setFiles((prev) => prev.map((f) => ({ ...f, status: "recognizing" })));

    // 创建并发队列（1=免费版串行，10=正式版并行）
    const maxConcurrent = 1;
    const queue = new TaskQueue<any>(maxConcurrent, {
      onTaskComplete: (id, result) => {
        const data = result.data;
        setFiles((prev) =>
          prev.map((pf) =>
            pf.id === id
              ? {
                  ...pf,
                  status: data.isDuplicate ? "duplicate" : "success",
                  data: {
                    id: data.id,
                    invoiceCode: data.invoiceCode,
                    invoiceNumber: data.invoiceNumber,
                    date: data.invoiceDate,
                    amount: data.amount,
                    tax: data.tax,
                    total: data.total,
                    sellerName: data.sellerName,
                    sellerTaxId: data.sellerTaxId,
                    buyerName: data.buyerName,
                    buyerTaxId: data.buyerTaxId,
                    invoiceCategory: data.invoiceCategory,
                    invoiceType: data.invoiceType,
                    invoiceItem: data.invoiceItem,
                    invoiceDetail: data.invoiceDetail,
                    remark: data.remark,
                  },
                }
              : pf,
          ),
        );
      },
      onTaskError: (id, error) => {
        setFiles((prev) =>
          prev.map((pf) =>
            pf.id === id
              ? { ...pf, status: "error", error: error.message }
              : pf,
          ),
        );
      },
      onProgress: (completed, total) => {
        setRecognizeProgress({ completed, total });
      },
      onAllComplete: () => {
        console.log('✅ 所有发票识别完成');
      },
    });

    queueRef.current = queue;

    setRecognizeProgress({ completed: 0, total: pendingFiles.length });

    queue.addTasks(
      pendingFiles.map((f) => ({
        id: f.id,
        execute: () => apiRecognizeInvoice(f.file, batchId),
      }))
    );

    queue.start();
  };

  const handleCancelRecognize = () => {
    if (queueRef.current) {
      queueRef.current.cancel();
      // 把还在识别中的标记为待确认
      setFiles((prev) =>
        prev.map((f) =>
          f.status === "recognizing" ? { ...f, status: "pending" } : f,
        ),
      );
    }
  };

  const handleRetryFile = (fileId: string) => {
    const file = files.find((f) => f.id === fileId);
    if (!file) return;

    setFiles((prev) =>
      prev.map((f) =>
        f.id === fileId ? { ...f, status: "recognizing", error: undefined } : f,
      ),
    );

    if (queueRef.current) {
      queueRef.current.retry({
        id: fileId,
        execute: () => apiRecognizeInvoice(file.file, batchId),
      });
    }
  };

  const handleExportExcel = () => {
    // 17列表头，与模板完全对齐
    const headers = [
      "发票分类", "发票类型", "购买方名称", "购买方税号",
      "销售方名称", "销售方税号", "发票代码", "发票号码",
      "开票日期", "开票项目", "开票明细", "金额",
      "税额", "价税合计", "备注信息", "文件名称", "是否重复",
    ];

    const rows = files
      .filter((f) => f.status === "success" || f.status === "duplicate")
      .map((f) => [
        f.data?.invoiceCategory || "",
        f.data?.invoiceType || "",
        f.data?.buyerName || "",
        f.data?.buyerTaxId || "",
        f.data?.sellerName || "",
        f.data?.sellerTaxId || "",
        f.data?.invoiceCode || "",
        f.data?.invoiceNumber || "",
        f.data?.date || "",
        f.data?.invoiceItem || "",
        f.data?.invoiceDetail || "",
        f.data?.amount ?? 0,
        f.data?.tax ?? 0,
        f.data?.total ?? 0,
        f.data?.remark || "",
        f.file.name,
        f.status === "duplicate" ? "是" : "否",
      ]);

    // 用 aoa_to_sheet（数组的数组）保持列顺序
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);

    // 设置列宽，提升可读性
    ws['!cols'] = [
      { wch: 10 }, { wch: 8 },  { wch: 20 }, { wch: 20 },
      { wch: 20 }, { wch: 20 }, { wch: 14 }, { wch: 22 },
      { wch: 14 }, { wch: 16 }, { wch: 40 }, { wch: 10 },
      { wch: 10 }, { wch: 10 }, { wch: 16 }, { wch: 30 }, { wch: 8 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "发票统计");
    XLSX.writeFile(wb, "发票统计文件.xlsx");

    setStep(3);
  };

  const resetWorkspace = () => {
    setFiles([]);
    setStep(1);
  };

  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const pendingCount = files.filter((f) => f.status === "pending").length;
  const duplicateCount = files.filter((f) => f.status === "duplicate").length;
  const totalAmount = files.reduce((sum, f) => sum + (f.data?.total || 0), 0);
  const isAllRecognized =
    files.length > 0 &&
    files.every(
      (f) =>
        f.status === "success" ||
        f.status === "duplicate" ||
        f.status === "error",
    );

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Banner */}
      <div className="bg-[#0052D9] rounded-2xl p-10 text-center text-white shadow-sm relative overflow-hidden">
        <h2 className="text-2xl font-medium mb-4">在线PDF电子发票统计及去重</h2>
        <p className="text-blue-100 text-sm">
          批量上传PDF格式电子发票文件，系统会自动统计发票信息并标记重复发票，可导出为Excel表格
        </p>
      </div>

      {/* Steps */}
      <div className="flex items-center justify-center py-6">
        <StepItem
          number={1}
          label="上传PDF发票"
          active={step >= 1}
          current={step === 1}
        />
        <div
          className={cn(
            "w-48 h-[1px] mx-4",
            step >= 2 ? "bg-[#0052D9]" : "bg-slate-200",
          )}
        />
        <StepItem
          number={2}
          label="统计及去重"
          active={step >= 2}
          current={step === 2}
        />
        <div
          className={cn(
            "w-48 h-[1px] mx-4",
            step >= 3 ? "bg-[#0052D9]" : "bg-slate-200",
          )}
        />
        <StepItem
          number={3}
          label="下载统计报表"
          active={step >= 3}
          current={step === 3}
        />
      </div>

      {/* Content Area */}
      {step === 1 && (
        <div className="space-y-6">
          {/* Dropzone */}
          <div
            {...getRootProps()}
            className={cn(
              "border-2 border-dashed rounded-2xl p-12 flex flex-col items-center justify-center bg-white transition-colors cursor-pointer",
              isDragActive
                ? "border-[#0052D9] bg-blue-50"
                : "border-slate-200 hover:border-[#0052D9] hover:bg-slate-50",
            )}
          >
            <input {...getInputProps()} />
            <div className="w-16 h-16 bg-blue-50 rounded-xl flex items-center justify-center mb-4">
              <UploadCloud className="w-8 h-8 text-[#0052D9]" />
            </div>
            <h3 className="text-xl font-semibold text-slate-800 mb-2">
              拖拽文件到此处
            </h3>
            <p className="text-slate-500 text-sm mb-6 text-center">
              支持 JPG, PNG, PDF 格式。自动 OCR 识别将在上传后立即
              <br />
              开始。
            </p>
            <button className="bg-[#003DA6] text-white px-8 py-2.5 rounded-lg font-semibold shadow-md hover:bg-[#002b75] transition-colors">
              选择文件
            </button>
          </div>

          {/* Uploading Progress */}
          {files.some((f) => f.status === "uploading") && (
            <div className="space-y-4">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500 font-bold tracking-widest">
                  实时处理中
                </span>
                <span className="text-[#0052D9] font-medium">
                  剩余 {files.filter((f) => f.status === "uploading").length} 项
                </span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                {files
                  .filter((f) => f.status === "uploading")
                  .map((f) => (
                    <div
                      key={f.id}
                      className="bg-[#F3F4F6] rounded-xl p-4 flex items-center gap-4"
                    >
                      <div className="w-5 h-5 rounded-full border-2 border-[#0052D9] border-t-transparent animate-spin shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between text-sm mb-2">
                          <span className="font-medium text-slate-800 truncate pr-4">
                            {f.file.name}
                          </span>
                          <span className="text-slate-500 shrink-0">
                            {Math.round(f.progress)}%
                          </span>
                        </div>
                        <div className="h-1 bg-slate-200 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-[#0052D9] transition-all duration-300"
                            style={{ width: `${f.progress}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* Pending List */}
          {files.some((f) => f.status === "pending") && !isUploading && (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
              <table className="w-full text-left text-sm">
                <thead className="bg-[#F8FAFC] border-b border-slate-100">
                  <tr className="text-slate-500 font-bold">
                    <th className="py-4 px-6 w-20">序号</th>
                    <th className="py-4 px-6">文件名</th>
                    <th className="py-4 px-6">发票号码</th>
                    <th className="py-4 px-6">日期</th>
                    <th className="py-4 px-6 text-right">金额</th>
                    <th className="py-4 px-6 text-right">税额</th>
                    <th className="py-4 px-6 text-right">总额</th>
                    <th className="py-4 px-6">状态</th>
                    <th className="py-4 px-6 text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {files
                    .filter((f) => f.status === "pending")
                    .map((f, i) => (
                      <tr
                        key={f.id}
                        className="hover:bg-slate-50 transition-colors"
                      >
                        <td className="py-4 px-6 text-slate-400">
                          {String(i + 1).padStart(2, "0")}
                        </td>
                        <td className="py-4 px-6 font-medium text-slate-800">
                          {f.file.name}
                        </td>
                        <td className="py-4 px-6 text-slate-300">-</td>
                        <td className="py-4 px-6 text-slate-300">-</td>
                        <td className="py-4 px-6 text-slate-300 text-right">
                          -
                        </td>
                        <td className="py-4 px-6 text-slate-300 text-right">
                          -
                        </td>
                        <td className="py-4 px-6 text-slate-300 text-right">
                          -
                        </td>
                        <td className="py-4 px-6">
                          <span className="bg-[#FFFBEB] text-[#D97706] border border-[#FEF3C7] px-2 py-1 rounded text-xs font-bold flex items-center gap-1 w-max">
                            <MoreHorizontal className="w-3 h-3" /> 待确认
                          </span>
                        </td>
                        <td className="py-4 px-6 text-right">
                          <button
                            onClick={() => removeFile(f.id)}
                            className="text-slate-400 hover:text-red-500 transition-colors"
                          >
                            <XCircle className="w-5 h-5 inline-block" />
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
              <div className="bg-[#F8FAFC] p-4 text-xs text-slate-500 border-t border-slate-100 flex justify-between items-center">
                <span>
                  显示第 1 至 {pendingCount} 条，共 {pendingCount} 条记录
                </span>
                <div className="flex gap-2">
                  <button className="p-1 text-slate-300 hover:text-slate-500">
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                  <button className="p-1 text-slate-300 hover:text-slate-500">
                    <ArrowLeft className="w-4 h-4 rotate-180" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Bottom Action Bar */}
          {files.some((f) => f.status === "pending") && !isUploading && (
            <div className="bg-[#EFF6FF] border border-[#DBEAFE] rounded-2xl p-6 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-200">
                  <FileText className="w-6 h-6 text-white" />
                </div>
                <div>
                  <div className="font-bold text-[#1E3A8A] text-lg">
                    文件已就绪
                  </div>
                  <div className="text-blue-700/70 text-sm">
                    共有 {pendingCount} 个新文件等待确认识别
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <button
                  onClick={resetWorkspace}
                  className="px-6 py-3 rounded-lg text-slate-600 font-semibold border border-slate-200 hover:bg-slate-50 transition-colors bg-white"
                >
                  清空列表
                </button>
                <button
                  onClick={handleConfirmAndRecognize}
                  className="px-8 py-3 rounded-lg text-white font-bold bg-gradient-to-r from-[#1D4ED8] to-[#3B82F6] shadow-lg shadow-blue-500/30 hover:opacity-90 transition-opacity flex items-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" /> 确认并开始识别 (
                  {pendingCount}张)
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {step === 2 && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead className="bg-[#F8FAFC] border-b border-slate-100">
                <tr className="text-slate-500 font-bold">
                  <th className="py-4 px-6 w-20">序号</th>
                  <th className="py-4 px-6">文件名</th>
                  <th className="py-4 px-6">发票号码</th>
                  <th className="py-4 px-6">日期</th>
                  <th className="py-4 px-6 text-right">金额</th>
                  <th className="py-4 px-6 text-right">税额</th>
                  <th className="py-4 px-6 text-right">总额</th>
                  <th className="py-4 px-6">状态</th>
                  <th className="py-4 px-6 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {files.map((f, i) => (
                  <tr
                    key={f.id}
                    className="hover:bg-slate-50 transition-colors"
                  >
                    <td className="py-4 px-6 text-slate-400">
                      {String(i + 1).padStart(2, "0")}
                    </td>
                    <td className="py-4 px-6 font-medium text-slate-800">
                      {f.file.name}
                    </td>
                    <td className="py-4 px-6 text-slate-600">
                      {f.data?.invoiceNumber || (
                        <span className="text-slate-300">识别中...</span>
                      )}
                    </td>
                    <td className="py-4 px-6 text-slate-600">
                      {f.data?.date || "-"}
                    </td>
                    <td className="py-4 px-6 text-slate-600 text-right">
                      {f.data ? f.data.amount.toFixed(2) : "0.00"}
                    </td>
                    <td className="py-4 px-6 text-slate-600 text-right">
                      {f.data ? f.data.tax.toFixed(2) : "0.00"}
                    </td>
                    <td className="py-4 px-6 text-slate-600 text-right">
                      {f.data ? f.data.total.toFixed(2) : "0.00"}
                    </td>
                    <td className="py-4 px-6">
                      {f.status === "recognizing" && (
                        <span className="bg-slate-100 text-slate-500 px-2 py-1 rounded text-xs font-bold flex items-center gap-1 w-max">
                          <RefreshCw className="w-3 h-3 animate-spin" /> 识别中
                        </span>
                      )}
                      {f.status === "success" && (
                        <span className="bg-[#2563EB] text-white px-2 py-1 rounded text-xs font-bold flex items-center gap-1 w-max">
                          <CheckCircle2 className="w-3 h-3" /> 已识别
                        </span>
                      )}
                      {f.status === "duplicate" && (
                        <span className="bg-[#FEF2F2] text-[#DC2626] border border-[#FECACA] px-2 py-1 rounded text-xs font-bold flex items-center gap-1 w-max">
                          <AlertTriangle className="w-3 h-3" /> 发现重复
                        </span>
                      )}
                      {f.status === "error" && (
                        <span className="bg-red-50 text-red-500 border border-red-200 px-2 py-1 rounded text-xs font-bold flex items-center gap-1 w-max" title={f.error}>
                          <XCircle className="w-3 h-3" /> 识别失败
                        </span>
                      )}
                    </td>
                    <td className="py-4 px-6 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {f.status === "error" && (
                          <button
                            onClick={() => handleRetryFile(f.id)}
                            className="text-blue-500 hover:text-blue-700 transition-colors"
                            title="重试"
                          >
                            <RotateCcw className="w-4 h-4 inline-block" />
                          </button>
                        )}
                        <button className="text-slate-400 hover:text-blue-600 transition-colors">
                          <MoreHorizontal className="w-5 h-5 inline-block" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Progress Bar */}
          {recognizeProgress.total > 0 && !isAllRecognized && (
            <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-5 h-5 rounded-full border-2 border-[#0052D9] border-t-transparent animate-spin" />
                <span className="text-sm text-blue-800 font-medium">
                  正在识别第 {recognizeProgress.completed + 1}/{recognizeProgress.total} 张...
                  预计剩余 {Math.max(0, recognizeProgress.total - recognizeProgress.completed)} 秒
                </span>
              </div>
              <button
                onClick={handleCancelRecognize}
                className="px-4 py-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg font-medium hover:bg-red-100 transition-colors flex items-center gap-1"
              >
                <StopCircle className="w-4 h-4" /> 停止识别
              </button>
            </div>
          )}

          {/* Summary Bar */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 flex items-center justify-between shadow-sm">
            <div className="flex items-center gap-8">
              <div>
                <div className="text-xs text-slate-500 mb-1">发票总计</div>
                <div className="text-lg font-bold text-slate-800">
                  总计 {files.length} 张发票
                </div>
              </div>
              {duplicateCount > 0 && (
                <div>
                  <div className="text-xs text-slate-500 mb-1">重复项</div>
                  <div className="text-lg font-bold text-[#DC2626]">
                    发现 {duplicateCount} 个重复项
                  </div>
                </div>
              )}
              <div>
                <div className="text-xs text-slate-500 mb-1">总金额</div>
                <div className="text-lg font-bold text-[#1E3A8A]">
                  {formatCurrency(totalAmount)}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <button
                onClick={resetWorkspace}
                className="px-6 py-3 text-slate-500 font-medium hover:text-slate-800 transition-colors"
              >
                重置工作台
              </button>
              <button
                onClick={handleExportExcel}
                disabled={!isAllRecognized}
                className="px-8 py-3 rounded-lg text-white font-bold bg-[#0052D9] shadow-md hover:bg-[#003DA6] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                <Download className="w-4 h-4" /> 生成 Excel
              </button>
            </div>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-16 flex flex-col items-center justify-center text-center">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mb-6">
            <CheckCircle2 className="w-10 h-10 text-green-600" />
          </div>
          <h3 className="text-2xl font-bold text-[#DC2626] mb-4">
            生成Excel表格完成
          </h3>
          <p className="text-slate-600 mb-6">
            此次共为您统计了 {files.length} 张发票文件！
          </p>
          <div className="flex items-center gap-2 text-green-600 bg-green-50 px-4 py-2 rounded-lg mb-10">
            <FileText className="w-4 h-4" />
            <span className="font-medium">发票统计文件.xlsx</span>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={resetWorkspace}
              className="px-6 py-2.5 rounded-lg text-[#0052D9] font-medium border border-[#0052D9] hover:bg-blue-50 transition-colors flex items-center gap-2"
            >
              <ArrowLeft className="w-4 h-4" /> 返回继续操作
            </button>
            <button className="px-6 py-2.5 rounded-lg text-white font-medium bg-[#0052D9] hover:bg-[#003DA6] transition-colors flex items-center gap-2">
              <Download className="w-4 h-4" /> 下载Excel表格
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function StepItem({
  number,
  label,
  active,
  current,
}: {
  number: number;
  label: string;
  active: boolean;
  current: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className={cn(
          "w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-colors",
          active ? "bg-[#DC2626] text-white" : "bg-slate-200 text-slate-500",
          current && "ring-4 ring-red-100",
        )}
      >
        {number}
      </div>
      <span
        className={cn(
          "text-sm font-bold",
          active ? "text-[#DC2626]" : "text-slate-400",
        )}
      >
        {label}
      </span>
    </div>
  );
}

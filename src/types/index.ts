export type FileStatus =
  | "uploading"
  | "pending"
  | "recognizing"
  | "success"
  | "duplicate"
  | "error";

export interface InvoiceData {
  id?: number;
  invoiceCode?: string;
  invoiceNumber: string;
  date: string;
  amount: number;
  tax: number;
  total: number;
  sellerName?: string;
  sellerTaxId?: string;
  buyerName?: string;
  buyerTaxId?: string;
  invoiceCategory?: string; // 发票分类
  invoiceType?: string;     // 发票类型
  invoiceItem?: string;     // 开票项目
  invoiceDetail?: string;   // 开票明细
  remark?: string;          // 备注信息
}

export interface InvoiceFile {
  id: string;
  file: File;
  progress: number;
  status: FileStatus;
  data?: InvoiceData;
  error?: string;
}

export interface User {
  userId: string;
  phone: string;
  nickname: string;
  token: string;
}

import { Router, Response } from 'express';
import upload from '../upload';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { recognizeInvoice } from '../volcengine';
import pool from '../db';
import { RowDataPacket } from 'mysql2';

const router = Router();

// 并发控制：最多允许 MAX_CONCURRENT 个请求同时处理
const MAX_CONCURRENT = parseInt(process.env.VOLC_OCR_CONCURRENT || '20');
let activeCount = 0;
const waitQueue: Array<() => void> = [];

async function acquireSemaphore(): Promise<void> {
  if (activeCount < MAX_CONCURRENT) {
    activeCount++;
    return;
  }
  await new Promise<void>((resolve) => waitQueue.push(resolve));
  activeCount++;
}

function releaseSemaphore(): void {
  activeCount--;
  if (waitQueue.length > 0) {
    const next = waitQueue.shift()!;
    next();
  }
}

/**
 * POST /api/ocr/recognize
 * 识别单张发票：上传文件 → OCR识别 → 去重检测 → 存库 → 返回结果
 */
router.post(
  '/recognize',
  authMiddleware,
  upload.single('file'),
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId!;
      const batchId = req.body.batchId || '';

      if (!req.file) {
        return res.status(400).json({ error: '请上传文件' });
      }

      const file = req.file;
      const fileName = file.originalname;

      // 将文件转为 base64
      let imageBase64: string;

      if (file.mimetype === 'application/pdf') {
        // PDF 直接用 base64 传递，火山引擎部分API支持PDF
        // 如果不支持，后续可加 pdf-to-image 转换
        imageBase64 = file.buffer.toString('base64');
      } else {
        // 图片直接转 base64
        imageBase64 = file.buffer.toString('base64');
      }

      // 并发控制
      await acquireSemaphore();

      let ocrResult;
      try {
        // 调用火山引擎 OCR
        console.log(`🔍 开始识别: ${fileName} (用户: ${userId})`);
        ocrResult = await recognizeInvoice(imageBase64);
      } finally {
        releaseSemaphore();
      }

      if (!ocrResult.success) {
        return res.status(422).json({
          error: `识别失败: ${ocrResult.error}`,
          fileName,
          rawJson: ocrResult.rawJson,
        });
      }

      const data = ocrResult.data!;

      // 去重检测：用 发票代码+发票号码 查询（本用户的历史记录）
      let isDuplicate = false;
      if (data.invoiceNumber) {
        const [existing] = await pool.query<RowDataPacket[]>(
          `SELECT id FROM invoices 
           WHERE user_id = ? 
           AND invoice_number = ? 
           AND (invoice_code = ? OR (invoice_code IS NULL AND ? IS NULL))
           LIMIT 1`,
          [userId, data.invoiceNumber, data.invoiceCode || null, data.invoiceCode || null]
        );
        isDuplicate = existing.length > 0;
      }

      // 同一批次内去重
      if (!isDuplicate && data.invoiceNumber && batchId) {
        const [batchExisting] = await pool.query<RowDataPacket[]>(
          `SELECT id FROM invoices 
           WHERE user_id = ? 
           AND batch_id = ? 
           AND invoice_number = ? 
           AND (invoice_code = ? OR (invoice_code IS NULL AND ? IS NULL))
           LIMIT 1`,
          [userId, batchId, data.invoiceNumber, data.invoiceCode || null, data.invoiceCode || null]
        );
        isDuplicate = batchExisting.length > 0;
      }

      const status = isDuplicate ? 'duplicate' : 'normal';

      // 存入数据库
      const [insertResult] = await pool.query(
        `INSERT INTO invoices 
         (user_id, invoice_code, invoice_number, invoice_date, amount, tax, total, 
          seller_name, buyer_name, tax_id, file_name, status, raw_ocr_json, batch_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          userId,
          data.invoiceCode || null,
          data.invoiceNumber || null,
          data.invoiceDate || null,
          data.amount || 0,
          data.tax || 0,
          data.total || 0,
          data.sellerName || null,
          data.buyerName || null,
          data.sellerTaxId || null,
          fileName,
          status,
          JSON.stringify(ocrResult.rawJson),
          batchId || null,
        ]
      );

      console.log(`✅ 识别完成: ${fileName} → ${status}${isDuplicate ? ' ⚠️ 重复' : ''}`);

      res.json({
        success: true,
        data: {
          id: (insertResult as any).insertId,
          fileName,
          invoiceCode: data.invoiceCode || '',
          invoiceNumber: data.invoiceNumber || '',
          invoiceDate: data.invoiceDate || '',
          amount: data.amount || 0,
          tax: data.tax || 0,
          total: data.total || 0,
          sellerName: data.sellerName || '',
          sellerTaxId: data.sellerTaxId || '',
          buyerName: data.buyerName || '',
          buyerTaxId: data.buyerTaxId || '',
          invoiceCategory: data.invoiceCategory || '',
          invoiceType: data.invoiceType || '',
          invoiceItem: data.invoiceItem || '',
          invoiceDetail: data.invoiceDetail || '',
          remark: data.remark || '',
          status,
          isDuplicate,
        },
      });
    } catch (err: any) {
      console.error('❌ OCR 识别错误:', err);

      // 限流错误特殊处理
      if (err.message?.includes('429') || err.message?.includes('rate limit') || err.message?.includes('QPS')) {
        return res.status(429).json({
          error: '识别请求过于频繁，请稍后重试',
          retryAfter: 2,
        });
      }

      res.status(500).json({ error: `识别失败: ${err.message}` });
    }
  }
);

export default router;
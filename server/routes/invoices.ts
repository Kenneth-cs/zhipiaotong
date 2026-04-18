import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import pool from '../db';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

const router = Router();

// 所有路由都需要登录
router.use(authMiddleware);

/**
 * GET /api/invoices
 * 查询历史发票列表（分页+筛选+搜索）
 */
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 20));
    const offset = (page - 1) * pageSize;

    // 筛选参数
    const keyword = (req.query.keyword as string) || '';
    const status = (req.query.status as string) || '';
    const dateRange = (req.query.dateRange as string) || '';
    const startDate = (req.query.startDate as string) || '';
    const endDate = (req.query.endDate as string) || '';

    // 构建查询条件
    let where = 'WHERE user_id = ?';
    const params: any[] = [userId];

    // 关键词搜索：发票号码、销售方、文件名
    if (keyword) {
      where += ' AND (invoice_number LIKE ? OR seller_name LIKE ? OR file_name LIKE ? OR invoice_code LIKE ?)';
      const kw = `%${keyword}%`;
      params.push(kw, kw, kw, kw);
    }

    // 状态筛选
    if (status === 'normal' || status === 'duplicate') {
      where += ' AND status = ?';
      params.push(status);
    }

    // 日期范围
    if (dateRange === '30d') {
      where += ' AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)';
    } else if (dateRange === '90d') {
      where += ' AND created_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)';
    } else if (dateRange === '1y') {
      where += ' AND created_at >= DATE_SUB(NOW(), INTERVAL 1 YEAR)';
    } else if (startDate && endDate) {
      where += ' AND created_at >= ? AND created_at <= ?';
      params.push(startDate, endDate + ' 23:59:59');
    }

    // 查询总数
    const [countResult] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) as total FROM invoices ${where}`,
      params
    );
    const total = countResult[0].total;

    // 查询数据
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, invoice_code, invoice_number, invoice_date, amount, tax, total,
              seller_name, buyer_name, tax_id, file_name, status, batch_id, created_at
       FROM invoices ${where}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );

    // 统计摘要
    const [summary] = await pool.query<RowDataPacket[]>(
      `SELECT 
         COUNT(*) as totalCount,
         SUM(CASE WHEN status = 'duplicate' THEN 1 ELSE 0 END) as duplicateCount,
         SUM(CASE WHEN status = 'normal' THEN 1 ELSE 0 END) as normalCount,
         COALESCE(SUM(total), 0) as totalAmount
       FROM invoices WHERE user_id = ?`,
      [userId]
    );

    res.json({
      data: rows,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
      summary: summary[0],
    });
  } catch (err: any) {
    console.error('查询发票列表失败:', err);
    res.status(500).json({ error: '查询失败' });
  }
});

/**
 * GET /api/invoices/:id
 * 查询单条发票详情
 */
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM invoices WHERE id = ? AND user_id = ?`,
      [req.params.id, req.userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: '发票不存在' });
    }

    res.json({ data: rows[0] });
  } catch (err: any) {
    console.error('查询发票详情失败:', err);
    res.status(500).json({ error: '查询失败' });
  }
});

/**
 * PUT /api/invoices/:id
 * 手动修正识别结果
 */
router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { invoiceCode, invoiceNumber, invoiceDate, amount, tax, total, sellerName, buyerName, taxId } = req.body;

    // 验证发票属于当前用户
    const [existing] = await pool.query<RowDataPacket[]>(
      'SELECT id FROM invoices WHERE id = ? AND user_id = ?',
      [req.params.id, req.userId]
    );

    if (existing.length === 0) {
      return res.status(404).json({ error: '发票不存在' });
    }

    await pool.query(
      `UPDATE invoices SET
         invoice_code = COALESCE(?, invoice_code),
         invoice_number = COALESCE(?, invoice_number),
         invoice_date = COALESCE(?, invoice_date),
         amount = COALESCE(?, amount),
         tax = COALESCE(?, tax),
         total = COALESCE(?, total),
         seller_name = COALESCE(?, seller_name),
         buyer_name = COALESCE(?, buyer_name),
         tax_id = COALESCE(?, tax_id)
       WHERE id = ? AND user_id = ?`,
      [
        invoiceCode, invoiceNumber, invoiceDate,
        amount, tax, total,
        sellerName, buyerName, taxId,
        req.params.id, req.userId,
      ]
    );

    res.json({ message: '更新成功' });
  } catch (err: any) {
    console.error('更新发票失败:', err);
    res.status(500).json({ error: '更新失败' });
  }
});

/**
 * DELETE /api/invoices/:id
 * 删除单条发票
 */
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const [result] = await pool.query<ResultSetHeader>(
      'DELETE FROM invoices WHERE id = ? AND user_id = ?',
      [req.params.id, req.userId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: '发票不存在' });
    }

    res.json({ message: '删除成功' });
  } catch (err: any) {
    console.error('删除发票失败:', err);
    res.status(500).json({ error: '删除失败' });
  }
});

/**
 * POST /api/invoices/batch-delete
 * 批量删除
 */
router.post('/batch-delete', async (req: AuthRequest, res: Response) => {
  try {
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: '请选择要删除的发票' });
    }

    const placeholders = ids.map(() => '?').join(',');
    const [result] = await pool.query<ResultSetHeader>(
      `DELETE FROM invoices WHERE id IN (${placeholders}) AND user_id = ?`,
      [...ids, req.userId]
    );

    res.json({
      message: `成功删除 ${result.affectedRows} 条记录`,
      deletedCount: result.affectedRows,
    });
  } catch (err: any) {
    console.error('批量删除失败:', err);
    res.status(500).json({ error: '批量删除失败' });
  }
});

/**
 * GET /api/invoices/export/excel
 * 导出Excel（返回JSON数据，前端用xlsx库生成文件）
 */
router.get('/export/excel', async (req: AuthRequest, res: Response) => {
  try {
    const ids = req.query.ids as string;

    let query = `SELECT invoice_code, invoice_number, invoice_date, amount, tax, total,
                        seller_name, buyer_name, tax_id, file_name, status, created_at
                 FROM invoices WHERE user_id = ?`;
    const params: any[] = [req.userId];

    // 如果指定了ID列表，只导出选中的
    if (ids) {
      const idList = ids.split(',').map(Number).filter(Boolean);
      if (idList.length > 0) {
        const placeholders = idList.map(() => '?').join(',');
        query += ` AND id IN (${placeholders})`;
        params.push(...idList);
      }
    }

    query += ' ORDER BY created_at DESC';

    const [rows] = await pool.query<RowDataPacket[]>(query, params);

    res.json({ data: rows });
  } catch (err: any) {
    console.error('导出数据失败:', err);
    res.status(500).json({ error: '导出失败' });
  }
});

export default router;
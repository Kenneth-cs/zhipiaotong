import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import pool from '../db';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

const router = Router();

// 所有路由都需要登录
router.use(authMiddleware);

/**
 * GET /api/folders
 * 列出当前用户所有文件夹
 */
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT f.*, 
              (SELECT COUNT(*) FROM invoices WHERE folder_id = f.id AND user_id = ?) as invoice_count
       FROM invoice_folders f
       WHERE f.user_id = ?
       ORDER BY f.sort_order ASC, f.created_at ASC`,
      [req.userId, req.userId]
    );

    // 查询未归类发票数量
    const [uncategorized] = await pool.query<RowDataPacket[]>(
      'SELECT COUNT(*) as count FROM invoices WHERE user_id = ? AND folder_id IS NULL',
      [req.userId]
    );

    res.json({
      data: rows,
      uncategorizedCount: uncategorized[0].count,
    });
  } catch (err: any) {
    console.error('获取文件夹列表失败:', err);
    res.status(500).json({ error: '获取文件夹列表失败' });
  }
});

/**
 * POST /api/folders
 * 新建文件夹
 */
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: '文件夹名称不能为空' });
    }

    if (name.length > 50) {
      return res.status(400).json({ error: '文件夹名称不能超过50个字符' });
    }

    // 检查同名文件夹
    const [existing] = await pool.query<RowDataPacket[]>(
      'SELECT id FROM invoice_folders WHERE user_id = ? AND name = ?',
      [req.userId, name.trim()]
    );

    if (existing.length > 0) {
      return res.status(409).json({ error: '已存在同名文件夹' });
    }

    // 获取最大排序号
    const [maxOrder] = await pool.query<RowDataPacket[]>(
      'SELECT COALESCE(MAX(sort_order), 0) as max_order FROM invoice_folders WHERE user_id = ?',
      [req.userId]
    );

    const [result] = await pool.query<ResultSetHeader>(
      'INSERT INTO invoice_folders (user_id, name, sort_order) VALUES (?, ?, ?)',
      [req.userId, name.trim(), maxOrder[0].max_order + 1]
    );

    res.status(201).json({
      message: '创建成功',
      data: { id: result.insertId, name: name.trim(), sort_order: maxOrder[0].max_order + 1, invoice_count: 0 },
    });
  } catch (err: any) {
    console.error('创建文件夹失败:', err);
    res.status(500).json({ error: '创建文件夹失败' });
  }
});

/**
 * PUT /api/folders/:id
 * 重命名文件夹
 */
router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: '文件夹名称不能为空' });
    }

    // 验证文件夹属于当前用户
    const [existing] = await pool.query<RowDataPacket[]>(
      'SELECT id FROM invoice_folders WHERE id = ? AND user_id = ?',
      [req.params.id, req.userId]
    );

    if (existing.length === 0) {
      return res.status(404).json({ error: '文件夹不存在' });
    }

    // 检查同名
    const [duplicate] = await pool.query<RowDataPacket[]>(
      'SELECT id FROM invoice_folders WHERE user_id = ? AND name = ? AND id != ?',
      [req.userId, name.trim(), req.params.id]
    );

    if (duplicate.length > 0) {
      return res.status(409).json({ error: '已存在同名文件夹' });
    }

    await pool.query(
      'UPDATE invoice_folders SET name = ? WHERE id = ? AND user_id = ?',
      [name.trim(), req.params.id, req.userId]
    );

    res.json({ message: '重命名成功' });
  } catch (err: any) {
    console.error('重命名文件夹失败:', err);
    res.status(500).json({ error: '重命名文件夹失败' });
  }
});

/**
 * DELETE /api/folders/:id
 * 删除文件夹（文件夹内发票 folder_id 置 NULL）
 */
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    // 验证文件夹属于当前用户
    const [existing] = await pool.query<RowDataPacket[]>(
      'SELECT id FROM invoice_folders WHERE id = ? AND user_id = ?',
      [req.params.id, req.userId]
    );

    if (existing.length === 0) {
      return res.status(404).json({ error: '文件夹不存在' });
    }

    // 将文件夹内的发票移到未归类
    await pool.query(
      'UPDATE invoices SET folder_id = NULL WHERE folder_id = ? AND user_id = ?',
      [req.params.id, req.userId]
    );

    // 删除文件夹
    await pool.query(
      'DELETE FROM invoice_folders WHERE id = ? AND user_id = ?',
      [req.params.id, req.userId]
    );

    res.json({ message: '删除成功' });
  } catch (err: any) {
    console.error('删除文件夹失败:', err);
    res.status(500).json({ error: '删除文件夹失败' });
  }
});

export default router;
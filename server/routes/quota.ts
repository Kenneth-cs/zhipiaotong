import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import pool from '../db';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

const router = Router();

router.use(authMiddleware);

const DAILY_LIMIT = 5;

function localDate(d: Date | string = new Date()): string {
  const date = typeof d === 'string' ? new Date(d + 'T00:00:00') : d;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * GET /api/quota/status
 * 查询当前用户用量状态
 */
router.get('/status', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;

    // 确保 user_quota 行存在
    await pool.query(
      'INSERT IGNORE INTO user_quota (user_id, quota_balance, used_today, last_reset_date) VALUES (?, 0, 0, CURDATE())',
      [userId]
    );

    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT quota_balance, used_today, last_reset_date FROM user_quota WHERE user_id = ?',
      [userId]
    );

    const quota = rows[0];
    const today = localDate();
    const lastReset = quota.last_reset_date ? quota.last_reset_date as string : null;

    // 如果不是今天，重置 used_today
    let usedToday = quota.used_today;
    if (lastReset !== today) {
      usedToday = 0;
      await pool.query(
        'UPDATE user_quota SET used_today = 0, last_reset_date = CURDATE() WHERE user_id = ?',
        [userId]
      );
    }

    res.json({
      data: {
        usedToday,
        dailyLimit: DAILY_LIMIT,
        balance: quota.quota_balance,
      },
    });
  } catch (err: any) {
    console.error('查询用量状态失败:', err);
    res.status(500).json({ error: '查询用量状态失败' });
  }
});

/**
 * POST /api/quota/redeem
 * 兑换码兑换
 */
router.post('/redeem', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { code } = req.body;

    if (!code || !code.trim()) {
      return res.status(400).json({ error: '请输入兑换码' });
    }

    const trimmedCode = code.trim().toUpperCase();

    // 查找兑换码
    const [codes] = await pool.query<RowDataPacket[]>(
      'SELECT id, quota, status FROM redeem_codes WHERE code = ?',
      [trimmedCode]
    );

    if (codes.length === 0) {
      return res.status(404).json({ error: '兑换码不存在' });
    }

    const redeemCode = codes[0];

    if (redeemCode.status === 'used') {
      return res.status(400).json({ error: '该兑换码已被使用' });
    }

    // 开始事务
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // 标记兑换码为已使用
      await conn.query(
        'UPDATE redeem_codes SET status = ?, used_by = ?, used_at = NOW() WHERE id = ?',
        ['used', userId, redeemCode.id]
      );

      // 增加用户余额
      await conn.query(
        'UPDATE user_quota SET quota_balance = quota_balance + ? WHERE user_id = ?',
        [redeemCode.quota, userId]
      );

      await conn.commit();
      conn.release();

      res.json({
        message: `兑换成功，获得 ${redeemCode.quota} 张识别额度`,
        data: { addedQuota: redeemCode.quota },
      });
    } catch (txErr) {
      await conn.rollback();
      conn.release();
      throw txErr;
    }
  } catch (err: any) {
    console.error('兑换失败:', err);
    res.status(500).json({ error: '兑换失败，请稍后重试' });
  }
});

export default router;